import { randomUUID } from "node:crypto";
import { TraceEventSchema, type TraceEvent } from "./types";

const SECRET_KEY =
  /(token|key|secret|password|credential|authorization|cookie)/i;
function safeData(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEY.test(key)
        ? "[REDACTED]"
        : typeof item === "string"
          ? item.slice(0, 4_000)
          : item,
    ]),
  );
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
    return event;
  }

  list() {
    return [...this.events];
  }
}
