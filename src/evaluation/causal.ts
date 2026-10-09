import { randomUUID } from "node:crypto";
import { z } from "zod";

export const CausalHypothesisStatusSchema = z.enum([
  "PROPOSED",
  "SUPPORTED",
  "REJECTED",
  "INCONCLUSIVE",
]);
export type CausalHypothesisStatus = z.infer<
  typeof CausalHypothesisStatusSchema
>;

export const CausalHypothesisSchema = z.object({
  hypothesisId: z.string().uuid(),
  statement: z.string().trim().min(1).max(500),
  status: CausalHypothesisStatusSchema,
  supportingEvidence: z.array(z.string().trim().min(1).max(1_000)).max(50),
  contradictoryEvidence: z.array(z.string().trim().min(1).max(1_000)).max(50),
  validation: z
    .object({
      experiment: z.string().trim().min(1).max(500),
      outcome: z.enum(["confirmed", "rejected", "inconclusive"]),
      evidence: z.array(z.string().trim().min(1).max(1_000)).max(20),
    })
    .nullable(),
});
export type CausalHypothesis = z.infer<typeof CausalHypothesisSchema>;

export function createCausalHypothesis(statement: string): CausalHypothesis {
  return CausalHypothesisSchema.parse({
    hypothesisId: randomUUID(),
    statement,
    status: "PROPOSED",
    supportingEvidence: [],
    contradictoryEvidence: [],
    validation: null,
  });
}

export function addCausalEvidence(
  hypothesis: CausalHypothesis,
  input: { supporting?: string[]; contradictory?: string[] },
) {
  const current = CausalHypothesisSchema.parse(hypothesis);
  if (current.validation)
    throw new Error("validated causal hypotheses cannot be changed");
  return CausalHypothesisSchema.parse({
    ...current,
    supportingEvidence: [
      ...new Set([...current.supportingEvidence, ...(input.supporting ?? [])]),
    ],
    contradictoryEvidence: [
      ...new Set([
        ...current.contradictoryEvidence,
        ...(input.contradictory ?? []),
      ]),
    ],
  });
}

export function validateCausalHypothesis(
  hypothesis: CausalHypothesis,
  input: {
    experiment: string;
    outcome: "confirmed" | "rejected" | "inconclusive";
    evidence: string[];
  },
) {
  const current = CausalHypothesisSchema.parse(hypothesis);
  if (!input.evidence.length)
    throw new Error("causal validation requires evidence");
  return CausalHypothesisSchema.parse({
    ...current,
    status:
      input.outcome === "confirmed"
        ? "SUPPORTED"
        : input.outcome === "rejected"
          ? "REJECTED"
          : "INCONCLUSIVE",
    validation: input,
  });
}
