import { z } from "zod";
import type { LoopInput, LoopOutput } from "../loop/types";
import type { ToolContext } from "../tool/types";
import type { WorkspaceExecutionContext } from "../workspace/types";

export const AgentRoleSchema = z.enum([
  "coordinator",
  "explorer",
  "planner",
  "implementer",
  "tester",
  "reviewer",
]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const WorkspacePolicySchema = z.enum(["none", "read", "write"]);
export type WorkspacePolicy = z.infer<typeof WorkspacePolicySchema>;

export const AgentBudgetSchema = z.object({
  maxIterations: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  wallClockMs: z.number().int().positive(),
  maxToolCalls: z.number().int().nonnegative(),
});
export type AgentBudget = z.infer<typeof AgentBudgetSchema>;

export const AgentDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9._-]{1,63}$/),
  role: AgentRoleSchema,
  description: z.string().min(1),
  model: z.object({
    id: z.string().min(1),
    provider: z.string().min(1),
    contextWindow: z.number().int().positive(),
    supportsTools: z.boolean(),
    externalApproved: z.boolean(),
  }),
  allowedTools: z.array(z.string().min(1)).max(100),
  deniedCapabilities: z.array(z.string().min(1)).max(30),
  requiredSkills: z.array(z.string().min(1)).max(30),
  context: z.object({
    maxMessages: z.number().int().positive(),
    maxArtifactChars: z.number().int().positive(),
  }),
  budget: AgentBudgetSchema,
  canDelegate: z.boolean(),
  workspacePolicy: WorkspacePolicySchema,
  retry: z.object({ maxAttempts: z.number().int().min(1).max(3) }),
});
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

export const AgentTaskStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "blocked",
]);
export type AgentTaskStatus = z.infer<typeof AgentTaskStatusSchema>;

export const AgentTaskSchema = z.object({
  id: z.string().uuid(),
  parentTaskId: z.string().uuid().nullable(),
  objective: z.string().min(1),
  role: AgentRoleSchema,
  dependencies: z.array(z.string().uuid()),
  inputRequirements: z.array(z.string()),
  expectedOutput: z.string().min(1),
  acceptanceCriteria: z.array(z.string()).min(1),
  risk: z.enum(["low", "normal", "high"]),
  requiredCapabilities: z.array(z.string()),
  workspaceRequired: z.boolean(),
  contractId: z.string().uuid().nullable(),
  budget: AgentBudgetSchema,
  status: AgentTaskStatusSchema,
  attempts: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type AgentTask = z.infer<typeof AgentTaskSchema>;

export const AgentMessageTypeSchema = z.enum([
  "TASK_ASSIGNED",
  "TASK_STARTED",
  "FINDINGS_READY",
  "PLAN_READY",
  "PATCH_PROPOSED",
  "VERIFICATION_RESULT",
  "REVIEW_FINDINGS",
  "REVISION_REQUESTED",
  "TASK_COMPLETED",
  "TASK_FAILED",
  "TASK_CANCELLED",
  "APPROVAL_REQUIRED",
]);
export type AgentMessageType = z.infer<typeof AgentMessageTypeSchema>;

export const AgentMessageSchema = z.object({
  id: z.string().uuid(),
  sourceAgent: z.string().min(1),
  destination: z.string().min(1),
  taskId: z.string().uuid(),
  correlationId: z.string().uuid(),
  type: AgentMessageTypeSchema,
  schemaVersion: z.literal(1),
  timestamp: z.string().datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()),
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export type AgentHandoff = {
  taskId: string;
  sourceAgent: string;
  destinationAgent: string;
  findings: readonly string[];
  artifactRefs: readonly string[];
  acceptanceEvidence: readonly string[];
};

export type AgentExecution = {
  executionId: string;
  agentId: string;
  role: AgentRole;
  taskId: string;
  parentTaskId: string | null;
  sessionId: string;
  status:
    "created" | "running" | "suspended" | "completed" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  workspaceId?: string;
  usage?: LoopOutput["execution"];
  result?: LoopOutput;
  error?: string;
};

export const AgentExecutionSchema = z.object({
  executionId: z.string().uuid(),
  agentId: z.string().min(1),
  role: AgentRoleSchema,
  taskId: z.string().uuid(),
  parentTaskId: z.string().uuid().nullable(),
  sessionId: z.string().min(1),
  status: z.enum([
    "created",
    "running",
    "suspended",
    "completed",
    "failed",
    "cancelled",
  ]),
  startedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }).optional(),
  workspaceId: z.string().uuid().optional(),
  usage: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export const AgentSessionSchema = z.object({
  version: z.literal(1),
  sessionId: z.string().min(1),
  rootTaskId: z.string().uuid(),
  agents: z.array(AgentDefinitionSchema),
  tasks: z.array(AgentTaskSchema),
  executions: z.array(AgentExecutionSchema),
  messages: z.array(AgentMessageSchema),
  updatedAt: z.string().datetime({ offset: true }),
});

export type AgentRuntimeInput = {
  loop: LoopInput;
  sessionId: string;
  parentTaskId: string | null;
};

export type AgentRuntimeContext = ToolContext & {
  workspace?: WorkspaceExecutionContext;
};

export type AgentSessionState = {
  version: 1;
  sessionId: string;
  rootTaskId: string;
  agents: AgentDefinition[];
  tasks: AgentTask[];
  executions: AgentExecution[];
  messages: AgentMessage[];
  updatedAt: string;
};
