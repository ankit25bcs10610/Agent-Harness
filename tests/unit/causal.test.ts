import { expect, test } from "bun:test";
import {
  addCausalEvidence,
  createCausalHypothesis,
  validateCausalHypothesis,
} from "../../src/evaluation";

test("causal debugging keeps hypotheses unconfirmed until evidence validates them", () => {
  const initial = createCausalHypothesis(
    "provider timeout caused the task failure",
  );
  const evidenced = addCausalEvidence(initial, {
    supporting: ["request exceeded configured timeout"],
    contradictory: ["local fixture also fails without provider access"],
  });
  expect(evidenced.status).toBe("PROPOSED");
  const rejected = validateCausalHypothesis(evidenced, {
    experiment: "run the fixture with a deterministic provider",
    outcome: "rejected",
    evidence: ["fixture failed with the provider stub too"],
  });
  expect(rejected.status).toBe("REJECTED");
  expect(() =>
    addCausalEvidence(rejected, { supporting: ["late evidence"] }),
  ).toThrow("cannot be changed");
});

test("causal validation cannot claim a result without evidence", () => {
  const hypothesis = createCausalHypothesis(
    "patch conflict caused verification failure",
  );
  expect(() =>
    validateCausalHypothesis(hypothesis, {
      experiment: "re-run verification after a clean patch",
      outcome: "confirmed",
      evidence: [],
    }),
  ).toThrow("requires evidence");
});
