import { z } from "zod";

export const EvaluationOutcomeSchema = z.enum([
  "PASS",
  "FAIL",
  "PARTIAL",
  "ERROR",
  "TIMEOUT",
  "BLOCKED",
  "NOT_RUN",
]);
export type EvaluationOutcome = z.infer<typeof EvaluationOutcomeSchema>;

export const EvaluationCategorySchema = z.enum([
  "bug_fix",
  "feature",
  "refactor",
  "test_generation",
  "debugging",
  "comprehension",
  "security",
  "review",
  "documentation",
  "multi_file",
  "dependency",
  "multi_agent",
  "recovery",
]);

export const EvaluationTaskSchema = z.object({
  taskId: z.string().min(1),
  benchmarkId: z.string().min(1),
  description: z.string().min(1),
  category: EvaluationCategorySchema,
  difficulty: z.enum(["easy", "normal", "hard", "expert"]),
  repositoryFixture: z.string().min(1),
  baseCommit: z.string().min(1).optional(),
  instructions: z.string().min(1),
  allowedTools: z.array(z.string().min(1)).max(100),
  allowedWorkspaces: z.enum(["none", "dedicated"]),
  budget: z.object({
    maxIterations: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    wallClockMs: z.number().int().positive(),
    maxToolCalls: z.number().int().nonnegative(),
    maxCostCents: z.number().nonnegative().optional(),
  }),
  setupRequirements: z.array(z.string()).max(20),
  expectedOutcomes: z.object({
    requiredFiles: z.array(z.string()).default([]),
    forbiddenFiles: z.array(z.string()).default([]),
    assertions: z.array(z.string()).default([]),
  }),
  verificationCommands: z.array(z.string()).max(20),
  requiredGraders: z.array(z.string().min(1)).min(1),
  securityConstraints: z.object({
    requiresIsolation: z.boolean(),
    allowNetwork: z.boolean(),
    allowedPaths: z.array(z.string()),
  }),
  timeoutMs: z.number().int().positive(),
  tags: z.array(z.string()),
  datasetVersion: z.string().min(1),
  expectedArtifacts: z.array(z.string()),
});
export type EvaluationTask = z.infer<typeof EvaluationTaskSchema>;

export const BenchmarkSuiteSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  tasks: z.array(EvaluationTaskSchema).min(1),
  trustedGraderRevision: z.string().min(1),
});
export type BenchmarkSuite = z.infer<typeof BenchmarkSuiteSchema>;

export const TraceEventSchema = z.object({
  id: z.string().uuid(),
  evaluationId: z.string().min(1),
  runId: z.string().min(1),
  taskId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  workspaceId: z.string().uuid().optional(),
  at: z.string().datetime({ offset: true }),
  type: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});
export type TraceEvent = z.infer<typeof TraceEventSchema>;

export const GradeResultSchema = z.object({
  grader: z.string().min(1),
  outcome: EvaluationOutcomeSchema,
  score: z.number().min(0).max(1).optional(),
  durationMs: z.number().nonnegative(),
  exitCode: z.number().int().nullable().optional(),
  evidence: z.array(z.string()),
  error: z.string().optional(),
});
export type GradeResult = z.infer<typeof GradeResultSchema>;

export const EvaluationMetricsSchema = z.object({
  correctness: z.object({
    taskPassed: z.boolean(),
    requiredTestsPassed: z.boolean(),
    changedFiles: z.number().int().nonnegative(),
    unnecessaryFiles: z.number().int().nonnegative(),
  }),
  efficiency: z.object({
    durationMs: z.number().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    modelRequests: z.number().int().nonnegative(),
  }),
  usage: z.object({
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
  }),
  cost: z.object({
    reportedCents: z.number().nonnegative().nullable(),
    estimatedCents: z.number().nonnegative().nullable(),
    status: z.enum(["measured", "estimated", "unknown"]),
  }),
  reliability: z.object({
    providerFailures: z.number().int().nonnegative(),
    toolFailures: z.number().int().nonnegative(),
    interruptions: z.number().int().nonnegative(),
    timeouts: z.number().int().nonnegative(),
  }),
  safety: z.object({
    unauthorizedAttempts: z.number().int().nonnegative(),
    contractViolations: z.number().int().nonnegative(),
    crossWorkspaceAttempts: z.number().int().nonnegative(),
  }),
});
export type EvaluationMetrics = z.infer<typeof EvaluationMetricsSchema>;

export const EvaluationResultSchema = z.object({
  evaluationId: z.string().min(1),
  runId: z.string().min(1),
  taskId: z.string().min(1),
  status: EvaluationOutcomeSchema,
  startedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }),
  workspaceId: z.string().uuid().optional(),
  grades: z.array(GradeResultSchema),
  metrics: EvaluationMetricsSchema,
  trace: z.array(TraceEventSchema),
  artifacts: z.array(z.string()),
  integrity: z.object({
    trustedGraderRevision: z.string(),
    changedOutsideAllowedPaths: z.array(z.string()),
    graderTampered: z.boolean(),
    fixtureContaminated: z.boolean(),
  }),
  error: z.string().optional(),
});
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

export const ExperimentSchema = z.object({
  experimentId: z.string().uuid(),
  name: z.string().min(1),
  suiteId: z.string().min(1),
  datasetVersion: z.string().min(1),
  modelConfiguration: z.record(z.string(), z.unknown()),
  agentConfiguration: z.record(z.string(), z.unknown()),
  toolConfiguration: z.record(z.string(), z.unknown()),
  runtimeVersion: z.string().min(1),
  status: z.enum(["created", "running", "completed", "failed", "cancelled"]),
  trialCount: z.number().int().positive(),
  results: z.array(EvaluationResultSchema),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type Experiment = z.infer<typeof ExperimentSchema>;
