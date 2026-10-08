import type { LoopOutput } from "../loop/types";
import {
  EvaluationMetricsSchema,
  type EvaluationMetrics,
  type EvaluationOutcome,
  type GradeResult,
} from "./types";

export function aggregateMetrics(input: {
  grades: readonly GradeResult[];
  durationMs: number;
  changedFiles: readonly string[];
  allowedPaths?: readonly string[];
  execution?: LoopOutput["execution"];
  unauthorizedAttempts?: number;
  contractViolations?: number;
  crossWorkspaceAttempts?: number;
  providerFailures?: number;
  toolFailures?: number;
  interruptions?: number;
  timeouts?: number;
  reportedCostCents?: number;
  estimatedCostCents?: number;
}): EvaluationMetrics {
  const taskPassed =
    input.grades.length > 0 &&
    input.grades.every((grade) => grade.outcome === "PASS");
  const requiredTestsPassed = input.grades
    .filter((grade) => /test|typecheck|build/i.test(grade.grader))
    .every((grade) => grade.outcome === "PASS");
  const unnecessaryFiles = input.allowedPaths
    ? input.changedFiles.filter(
        (file) =>
          !input.allowedPaths!.some(
            (allowed) => file === allowed || file.startsWith(`${allowed}/`),
          ),
      ).length
    : 0;
  const execution = input.execution;
  return EvaluationMetricsSchema.parse({
    correctness: {
      taskPassed,
      requiredTestsPassed,
      changedFiles: input.changedFiles.length,
      unnecessaryFiles,
    },
    efficiency: {
      durationMs: input.durationMs,
      toolCalls: execution?.toolCalls ?? 0,
      modelRequests: execution?.modelRequests ?? 0,
    },
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: execution?.usageIncomplete
        ? null
        : (execution?.tokensUsed ?? null),
    },
    cost: {
      reportedCents: input.reportedCostCents ?? null,
      estimatedCents: input.estimatedCostCents ?? null,
      status:
        input.reportedCostCents !== undefined
          ? "measured"
          : input.estimatedCostCents !== undefined
            ? "estimated"
            : "unknown",
    },
    reliability: {
      providerFailures: input.providerFailures ?? 0,
      toolFailures: input.toolFailures ?? 0,
      interruptions: input.interruptions ?? 0,
      timeouts: input.timeouts ?? 0,
    },
    safety: {
      unauthorizedAttempts: input.unauthorizedAttempts ?? 0,
      contractViolations: input.contractViolations ?? 0,
      crossWorkspaceAttempts: input.crossWorkspaceAttempts ?? 0,
    },
  });
}

export function outcomeFromGrades(
  grades: readonly GradeResult[],
): EvaluationOutcome {
  if (!grades.length) return "NOT_RUN";
  if (grades.some((grade) => grade.outcome === "BLOCKED")) return "BLOCKED";
  if (grades.some((grade) => grade.outcome === "TIMEOUT")) return "TIMEOUT";
  if (grades.some((grade) => grade.outcome === "ERROR")) return "ERROR";
  if (grades.every((grade) => grade.outcome === "PASS")) return "PASS";
  if (grades.some((grade) => grade.outcome === "PASS")) return "PARTIAL";
  return "FAIL";
}
