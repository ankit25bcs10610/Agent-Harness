import type { EvaluationResult, Experiment } from "./types";

export type Comparison = {
  taskId: string;
  before?: EvaluationResult;
  after?: EvaluationResult;
  outcome: "improved" | "regressed" | "unchanged" | "missing";
  durationDeltaMs?: number;
  tokenDelta?: number | null;
};

export function compareResults(
  before: readonly EvaluationResult[],
  after: readonly EvaluationResult[],
): Comparison[] {
  const left = new Map(before.map((result) => [result.taskId, result]));
  const right = new Map(after.map((result) => [result.taskId, result]));
  return [...new Set([...left.keys(), ...right.keys()])].map((taskId) => {
    const previous = left.get(taskId);
    const current = right.get(taskId);
    if (!previous || !current)
      return {
        taskId,
        ...(previous ? { before: previous } : {}),
        ...(current ? { after: current } : {}),
        outcome: "missing" as const,
      };
    const previousPass = previous.status === "PASS";
    const currentPass = current.status === "PASS";
    return {
      taskId,
      before: previous,
      after: current,
      outcome:
        currentPass && !previousPass
          ? "improved"
          : previousPass && !currentPass
            ? "regressed"
            : "unchanged",
      durationDeltaMs:
        current.metrics.efficiency.durationMs -
        previous.metrics.efficiency.durationMs,
      tokenDelta:
        current.metrics.usage.totalTokens === null ||
        previous.metrics.usage.totalTokens === null
          ? null
          : current.metrics.usage.totalTokens -
            previous.metrics.usage.totalTokens,
    };
  });
}

export type QualityGate = {
  name: string;
  minimumSampleSize: number;
  maxRegressionRate: number;
  securityBlocking: boolean;
};

export function evaluateQualityGate(
  comparisons: readonly Comparison[],
  gate: QualityGate,
) {
  const usable = comparisons.filter(
    (comparison) => comparison.before && comparison.after,
  );
  if (usable.length < gate.minimumSampleSize)
    return {
      outcome: "INSUFFICIENT_DATA" as const,
      regressions: [] as string[],
    };
  const regressions = usable
    .filter((comparison) => comparison.outcome === "regressed")
    .map((comparison) => comparison.taskId);
  const securityRegressions = usable
    .filter(
      (comparison) =>
        comparison.after?.metrics.safety.unauthorizedAttempts !== undefined &&
        (comparison.after.metrics.safety.unauthorizedAttempts >
          comparison.before!.metrics.safety.unauthorizedAttempts ||
          comparison.after.metrics.safety.contractViolations >
            comparison.before!.metrics.safety.contractViolations),
    )
    .map((comparison) => comparison.taskId);
  if (gate.securityBlocking && securityRegressions.length)
    return {
      outcome: "FAIL" as const,
      regressions: [...new Set([...regressions, ...securityRegressions])],
    };
  return {
    outcome:
      regressions.length / usable.length > gate.maxRegressionRate
        ? ("FAIL" as const)
        : regressions.length
          ? ("WARNING" as const)
          : ("PASS" as const),
    regressions,
  };
}

export function compareExperiments(before: Experiment, after: Experiment) {
  const configurationWarning =
    before.suiteId !== after.suiteId ||
    before.datasetVersion !== after.datasetVersion
      ? "Experiments use different suites or dataset versions."
      : undefined;
  return {
    ...(configurationWarning ? { configurationWarning } : {}),
    comparisons: compareResults(before.results, after.results),
  };
}
