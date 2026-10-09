import { z } from "zod";

export const EngineeringTaskStateSchema = z.enum([
  "CREATED",
  "UNDERSTANDING",
  "INVESTIGATING",
  "PLANNING",
  "AWAITING_APPROVAL",
  "IMPLEMENTING",
  "VERIFYING",
  "REPAIRING",
  "REVIEWING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "BLOCKED",
  "RECOVERABLE",
]);
export type EngineeringTaskState = z.infer<typeof EngineeringTaskStateSchema>;

export const EngineeringTaskStepSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  state: z.enum(["pending", "running", "completed", "failed", "blocked"]),
  completedAt: z.string().datetime({ offset: true }).optional(),
  evidenceIds: z.array(z.string().min(1)),
});

export const EngineeringTaskSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: z.string().uuid(),
  objective: z.string().min(1),
  constraints: z.array(z.string()),
  state: EngineeringTaskStateSchema,
  workspace: z.string().min(1),
  sourceRevision: z.string().min(1),
  relevantFiles: z.array(z.string()),
  dependencies: z.array(z.string().uuid()),
  plan: z.array(EngineeringTaskStepSchema),
  authorizationIds: z.array(z.string().min(1)),
  verificationEvidenceIds: z.array(z.string().min(1)),
  checkpoint: z.object({
    stepId: z.string().min(1).nullable(),
    safeToResume: z.boolean(),
    note: z.string().min(1),
    updatedAt: z.string().datetime({ offset: true }),
  }),
  budget: z.object({
    maxSteps: z.number().int().positive(),
    maxRepairAttempts: z.number().int().nonnegative(),
    wallClockMs: z.number().int().positive(),
  }),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type EngineeringTask = z.infer<typeof EngineeringTaskSchema>;

export const TASK_TRANSITIONS: Readonly<
  Record<EngineeringTaskState, readonly EngineeringTaskState[]>
> = {
  CREATED: ["UNDERSTANDING", "CANCELLED"],
  UNDERSTANDING: ["INVESTIGATING", "PLANNING", "BLOCKED", "CANCELLED"],
  INVESTIGATING: ["PLANNING", "BLOCKED", "CANCELLED"],
  PLANNING: ["AWAITING_APPROVAL", "IMPLEMENTING", "BLOCKED", "CANCELLED"],
  AWAITING_APPROVAL: ["IMPLEMENTING", "CANCELLED", "BLOCKED"],
  IMPLEMENTING: ["VERIFYING", "RECOVERABLE", "FAILED", "CANCELLED"],
  VERIFYING: ["REPAIRING", "REVIEWING", "COMPLETED", "FAILED", "RECOVERABLE"],
  REPAIRING: ["IMPLEMENTING", "VERIFYING", "FAILED", "RECOVERABLE"],
  REVIEWING: ["COMPLETED", "IMPLEMENTING", "FAILED", "RECOVERABLE"],
  COMPLETED: [],
  FAILED: ["RECOVERABLE"],
  CANCELLED: [],
  BLOCKED: ["UNDERSTANDING", "RECOVERABLE", "CANCELLED"],
  RECOVERABLE: [
    "UNDERSTANDING",
    "INVESTIGATING",
    "PLANNING",
    "IMPLEMENTING",
    "VERIFYING",
    "CANCELLED",
  ],
};
