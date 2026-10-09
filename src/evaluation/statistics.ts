import type { EvaluationOutcome, EvaluationResult } from "./types";

export type BenchmarkStatistics = {
  trials: number;
  passCount: number;
  failCount: number;
  blockedCount: number;
  timeoutCount: number;
  errorCount: number;
  notRunCount: number;
  successRate: number | null;
  successRate95Ci: { low: number; high: number } | null;
  meanDurationMs: number | null;
  medianDurationMs: number | null;
  measuredTokenTrials: number;
  measuredCostTrials: number;
  limitations: string[];
};

function wilson(successes: number, trials: number) {
  if (!trials) return null;
  const z = 1.959963984540054;
  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denominator;
  const spread =
    (z / denominator) *
    Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  return {
    low: Math.max(0, center - spread),
    high: Math.min(1, center + spread),
  };
}

function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

export function summarizeEvaluationResults(
  results: readonly EvaluationResult[],
): BenchmarkStatistics {
  const counts = new Map<EvaluationOutcome, number>();
  for (const result of results)
    counts.set(result.status, (counts.get(result.status) ?? 0) + 1);
  const passCount = counts.get("PASS") ?? 0;
  const blockedCount = counts.get("BLOCKED") ?? 0;
  const notRunCount = counts.get("NOT_RUN") ?? 0;
  const denominator = results.length - blockedCount - notRunCount;
  const durations = results.map(
    (result) => result.metrics.efficiency.durationMs,
  );
  const measuredTokenTrials = results.filter(
    (result) => result.metrics.usage.totalTokens !== null,
  ).length;
  const measuredCostTrials = results.filter(
    (result) => result.metrics.cost.status === "measured",
  ).length;
  const limitations: string[] = [];
  if (results.length < 30)
    limitations.push("small sample: confidence intervals are descriptive only");
  if (measuredTokenTrials < results.length)
    limitations.push("token usage is unavailable for some trials");
  if (measuredCostTrials < results.length)
    limitations.push("cost is unavailable or estimated for some trials");
  if (blockedCount || notRunCount)
    limitations.push(
      "blocked or not-run trials are excluded from success-rate denominator",
    );
  return {
    trials: results.length,
    passCount,
    failCount: counts.get("FAIL") ?? 0,
    blockedCount,
    timeoutCount: counts.get("TIMEOUT") ?? 0,
    errorCount: counts.get("ERROR") ?? 0,
    notRunCount,
    successRate: denominator > 0 ? passCount / denominator : null,
    successRate95Ci: denominator > 0 ? wilson(passCount, denominator) : null,
    meanDurationMs: durations.length
      ? durations.reduce((sum, duration) => sum + duration, 0) /
        durations.length
      : null,
    medianDurationMs: median(durations),
    measuredTokenTrials,
    measuredCostTrials,
    limitations,
  };
}
