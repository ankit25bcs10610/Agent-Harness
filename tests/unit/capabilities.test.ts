import { expect, test } from "bun:test";
import {
  capabilityReportMarkdown,
  validateCapabilityMatrix,
} from "../../src/evaluation";

const evidence = {
  id: "safe-edits",
  name: "Permission-gated edits",
  status: "VERIFIED" as const,
  evidence: [
    {
      source: "tests/unit/patch.test.ts",
      observation: "Patch paths are authorized independently before writing.",
    },
  ],
  limitations: ["No OS-level sandbox is provided by this distribution."],
  evaluatedAt: "2026-10-09T00:00:00.000Z",
};

test("capability evidence requires source-grounded proof for verified claims", () => {
  expect(validateCapabilityMatrix([evidence])).toHaveLength(1);
  expect(capabilityReportMarkdown([evidence])).toContain(
    "Permission-gated edits — VERIFIED",
  );
  expect(() =>
    validateCapabilityMatrix([{ ...evidence, evidence: [] }]),
  ).toThrow("requires evidence");
});

test("unknown capabilities require an explicit limitation and records cannot duplicate IDs", () => {
  expect(() =>
    validateCapabilityMatrix([
      { ...evidence, id: "air-gap", status: "UNKNOWN", limitations: [] },
    ]),
  ).toThrow("requires a limitation");
  expect(() => validateCapabilityMatrix([evidence, evidence])).toThrow(
    "duplicate capability",
  );
});
