import { randomUUID } from "node:crypto";
import { z } from "zod";

export const PerformanceSpanSchema = z.object({
  spanId: z.string().uuid(),
  traceId: z.string().uuid(),
  name: z.string().min(1),
  startedAtMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative().optional(),
  status: z.enum(["running", "ok", "error", "cancelled"]),
  attributes: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()]),
  ),
});
export type PerformanceSpan = z.infer<typeof PerformanceSpanSchema>;

const PRIVATE_KEY =
  /(token|key|secret|password|credential|authorization|prompt|content|source)/i;

function safeAttributes(attributes: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(attributes).flatMap(([key, value]) => {
      if (PRIVATE_KEY.test(key)) return [[key, "[REDACTED]"]];
      if (["string", "number", "boolean"].includes(typeof value))
        return [[key, value as string | number | boolean]];
      return [];
    }),
  );
}

export type PerformanceClock = () => number;

export class PerformanceInstrumentation {
  private readonly spans: PerformanceSpan[] = [];
  constructor(
    private readonly clock: PerformanceClock = () => performance.now(),
    private readonly maxSpans = 2_000,
    private readonly traceId = randomUUID(),
  ) {}

  start(name: string, attributes: Record<string, unknown> = {}) {
    const span: PerformanceSpan = {
      spanId: randomUUID(),
      traceId: this.traceId,
      name,
      startedAtMs: this.clock(),
      status: "running",
      attributes: safeAttributes(attributes),
    };
    return {
      spanId: span.spanId,
      end: (
        status: "ok" | "error" | "cancelled" = "ok",
        extra: Record<string, unknown> = {},
      ) => {
        const ended = PerformanceSpanSchema.parse({
          ...span,
          durationMs: Math.max(0, this.clock() - span.startedAtMs),
          status,
          attributes: { ...span.attributes, ...safeAttributes(extra) },
        });
        if (this.spans.length >= this.maxSpans) this.spans.shift();
        this.spans.push(ended);
        return ended;
      },
    };
  }

  async measure<T>(
    name: string,
    operation: () => Promise<T>,
    attributes: Record<string, unknown> = {},
  ) {
    const span = this.start(name, attributes);
    try {
      const value = await operation();
      span.end("ok");
      return value;
    } catch (error) {
      span.end(
        error instanceof Error && error.name === "AbortError"
          ? "cancelled"
          : "error",
      );
      throw error;
    }
  }

  list() {
    return [...this.spans];
  }

  clear() {
    this.spans.length = 0;
  }
}
