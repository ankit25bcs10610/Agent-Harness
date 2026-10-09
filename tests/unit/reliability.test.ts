import { expect, test } from "bun:test";
import {
  InvariantChecker,
  RuntimeMetricsCollector,
} from "../../src/reliability";

test("runtime metrics are bounded and withhold unsupported percentiles", () => {
  const metrics = new RuntimeMetricsCollector(3);
  metrics.record({ operation: "tool", durationMs: 30, status: "ok" });
  metrics.record({ operation: "tool", durationMs: 10, status: "error" });
  metrics.record({ operation: "tool", durationMs: 20, status: "cancelled" });
  metrics.record({ operation: "tool", durationMs: 40, status: "ok" });
  expect(metrics.summarize("tool")).toMatchObject({
    sampleSize: 3,
    completed: 1,
    failed: 1,
    cancelled: 1,
    p50Ms: 20,
    p95Ms: null,
    p99Ms: null,
  });
});

test("invariant checker reports failures instead of claiming readiness", () => {
  const checker = new InvariantChecker();
  checker.check({
    id: "no-unauthorized-tools",
    description: "No unauthorized tool calls execute",
    passed: true,
    evidence: ["tests/unit/tool-registry.test.ts"],
  });
  checker.check({
    id: "sandbox",
    description: "OS isolation is enforced",
    passed: false,
    evidence: ["No cross-platform isolation backend is installed"],
  });
  expect(checker.passed()).toBe(false);
  expect(checker.failures().map((result) => result.id)).toEqual(["sandbox"]);
});
