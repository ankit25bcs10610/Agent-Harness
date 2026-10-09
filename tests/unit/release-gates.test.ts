import { expect, test } from "bun:test";
import { evaluateReleaseGates } from "../../src/release";

const gate = (status: "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN") => ({
  gate: "core-cli",
  status,
  evidence: status === "PASS" ? ["bun test"] : [],
  limitations: status === "PASS" ? [] : ["Platform evidence unavailable."],
});

test("release gates produce a go decision only when every supplied gate passes", () => {
  expect(evaluateReleaseGates([gate("PASS")])).toMatchObject({
    decision: "GO",
    blockingGates: [],
  });
  expect(evaluateReleaseGates([gate("NOT_RUN")]).decision).toBe(
    "LIMITED_SCOPE",
  );
  expect(evaluateReleaseGates([gate("BLOCKED")])).toMatchObject({
    decision: "NO_GO",
    blockingGates: ["core-cli"],
  });
});

test("release gate input is validated and preserves limitations", () => {
  const result = evaluateReleaseGates([
    {
      gate: "security",
      status: "PASS",
      evidence: ["security:check"],
      limitations: ["No independent audit or certification."],
    },
  ]);
  expect(result.gates[0]?.limitations).toEqual([
    "No independent audit or certification.",
  ]);
});

test("release decisions fail closed for empty or unsupported evidence", () => {
  expect(() => evaluateReleaseGates([])).toThrow("at least one release gate");
  expect(() =>
    evaluateReleaseGates([
      { gate: "security", status: "PASS", evidence: [], limitations: [] },
    ]),
  ).toThrow("requires evidence");
  expect(() =>
    evaluateReleaseGates([
      { gate: "security", status: "BLOCKED", evidence: [], limitations: [] },
    ]),
  ).toThrow("requires limitations");
});
