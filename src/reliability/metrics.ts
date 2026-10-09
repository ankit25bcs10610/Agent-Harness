import { z } from "zod";
import type { PerformanceSpan } from "../performance";

export const ReliabilitySampleSchema = z.object({
  operation: z.string().min(1),
  durationMs: z.number().finite().nonnegative(),
  status: z.enum(["ok", "error", "cancelled"]),
});
export type ReliabilitySample = z.infer<typeof ReliabilitySampleSchema>;

export type ReliabilitySummary = {
  operation: string;
  sampleSize: number;
  completed: number;
  failed: number;
  cancelled: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
};

function percentile(
  values: readonly number[],
  percentileValue: number,
  minimumSample: number,
) {
  if (values.length < minimumSample) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percentileValue / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)] ?? null;
}

export class RuntimeMetricsCollector {
  private readonly samples: ReliabilitySample[] = [];

  constructor(private readonly maxSamples = 10_000) {
    if (!Number.isInteger(maxSamples) || maxSamples < 1)
      throw new Error("maximum reliability samples must be positive");
  }

  record(value: ReliabilitySample) {
    const sample = ReliabilitySampleSchema.parse(value);
    if (this.samples.length >= this.maxSamples) this.samples.shift();
    this.samples.push(sample);
    return sample;
  }

  recordSpan(span: PerformanceSpan) {
    if (span.durationMs === undefined || span.status === "running") return;
    return this.record({
      operation: span.name,
      durationMs: span.durationMs,
      status: span.status,
    });
  }

  samplesFor(operation?: string) {
    return this.samples.filter(
      (sample) => !operation || sample.operation === operation,
    );
  }

  summarize(operation: string): ReliabilitySummary {
    const samples = this.samplesFor(operation);
    const durations = samples.map((sample) => sample.durationMs);
    return {
      operation,
      sampleSize: samples.length,
      completed: samples.filter((sample) => sample.status === "ok").length,
      failed: samples.filter((sample) => sample.status === "error").length,
      cancelled: samples.filter((sample) => sample.status === "cancelled")
        .length,
      // p95/p99 are withheld until the sample is large enough to be meaningful.
      p50Ms: percentile(durations, 50, 1),
      p95Ms: percentile(durations, 95, 20),
      p99Ms: percentile(durations, 99, 100),
    };
  }

  clear() {
    this.samples.length = 0;
  }
}
