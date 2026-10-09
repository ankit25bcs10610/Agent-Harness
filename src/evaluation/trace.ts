import { randomUUID } from "node:crypto";
import { TraceEventSchema, type TraceEvent } from "./types";

const SECRET_KEY =
  /(token|key|secret|password|credential|authorization|cookie)/i;
const SECRET_VALUE =
  /(?:sk-[a-z0-9_-]{8,}|bearer\s+[a-z0-9._~-]{8,}|(?:token|key|secret|password|authorization)\s*[:=]\s*[^\s,}]+)/i;
const MAX_EVENT_COUNT = 2_000;
const MAX_DEPTH = 5;
function safeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[TRUNCATED]";
  if (typeof value === "string")
    return SECRET_VALUE.test(value) ? "[REDACTED]" : value.slice(0, 4_000);
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => safeValue(item, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([key, item]) => [
          key,
          SECRET_KEY.test(key) ? "[REDACTED]" : safeValue(item, depth + 1),
        ]),
    );
  return value;
}
function safeData(value: Record<string, unknown>) {
  return safeValue(value, 0) as Record<string, unknown>;
}

export class TraceCollector {
  private readonly events: TraceEvent[] = [];
  constructor(
    private readonly evaluationId: string,
    private readonly runId: string,
  ) {}

  record(
    input: Omit<TraceEvent, "id" | "evaluationId" | "runId" | "at" | "data"> & {
      data?: Record<string, unknown>;
    },
  ) {
    const event = TraceEventSchema.parse({
      ...input,
      id: randomUUID(),
      evaluationId: this.evaluationId,
      runId: this.runId,
      at: new Date().toISOString(),
      data: safeData(input.data ?? {}),
    });
    this.events.push(event);
    if (this.events.length > MAX_EVENT_COUNT) this.events.shift();
    return event;
  }

  list() {
    return [...this.events];
  }
}
