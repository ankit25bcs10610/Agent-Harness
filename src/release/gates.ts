import { z } from "zod";

export const ReleaseGateStatusSchema = z.enum([
  "PASS",
  "FAIL",
  "BLOCKED",
  "NOT_RUN",
]);
export const ReleaseGateSchema = z
  .object({
    gate: z.string().min(1),
    status: ReleaseGateStatusSchema,
    evidence: z.array(z.string().min(1)).max(20),
    limitations: z.array(z.string().min(1)).max(20),
  })
  .superRefine((value, context) => {
    if (value.status === "PASS" && value.evidence.length === 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence"],
        message: "a passing release gate requires evidence",
      });
    if (
      (value.status === "FAIL" || value.status === "BLOCKED") &&
      value.limitations.length === 0
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["limitations"],
        message: "a failed or blocked release gate requires limitations",
      });
  });
export type ReleaseGate = z.infer<typeof ReleaseGateSchema>;

export const ReleaseDecisionSchema = z.enum(["GO", "NO_GO", "LIMITED_SCOPE"]);
export type ReleaseDecision = z.infer<typeof ReleaseDecisionSchema>;

export function evaluateReleaseGates(input: readonly ReleaseGate[]): {
  decision: ReleaseDecision;
  gates: ReleaseGate[];
  blockingGates: string[];
} {
  if (input.length === 0)
    throw new Error("at least one release gate is required for a decision");
  const gates = input.map((gate) => ReleaseGateSchema.parse(gate));
  const blockingGates = gates
    .filter((gate) => gate.status === "FAIL" || gate.status === "BLOCKED")
    .map((gate) => gate.gate);
  const hasUnverified = gates.some((gate) => gate.status === "NOT_RUN");
  const decision: ReleaseDecision = blockingGates.length
    ? "NO_GO"
    : hasUnverified
      ? "LIMITED_SCOPE"
      : "GO";
  return { decision, gates, blockingGates };
}
