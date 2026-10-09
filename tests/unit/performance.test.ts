import { expect, test } from "bun:test";
import { PerformanceInstrumentation } from "../../src/performance";

test("performance instrumentation measures monotonic spans without private content", async () => {
  let now = 100;
  const instrumentation = new PerformanceInstrumentation(
    () => now,
    2,
    crypto.randomUUID(),
  );
  const span = instrumentation.start("context.retrieval", {
    files: 3,
    prompt: "private",
  });
  now += 12.5;
  const result = span.end("ok", { cacheHit: true, source: "index" });
  expect(result.durationMs).toBe(12.5);
  expect(result.attributes).toMatchObject({
    files: 3,
    prompt: "[REDACTED]",
    cacheHit: true,
  });
  expect(instrumentation.list()).toHaveLength(1);
});

test("performance instrumentation bounds retained spans and records failures", async () => {
  let now = 0;
  const instrumentation = new PerformanceInstrumentation(() => now, 2);
  for (const status of ["ok", "error", "cancelled"] as const) {
    const span = instrumentation.start(status);
    now += 1;
    span.end(status);
  }
  expect(instrumentation.list().map((span) => span.name)).toEqual([
    "error",
    "cancelled",
  ]);
  await expect(
    instrumentation.measure("failure", async () => {
      throw new Error("fixture");
    }),
  ).rejects.toThrow("fixture");
  expect(instrumentation.list().at(-1)?.status).toBe("error");
});
