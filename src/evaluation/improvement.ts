import { z } from "zod";
import type { EvaluationResult } from "./types";

export const ImprovementCandidateSchema = z.object({
  candidateId: z.string().min(1),
  hypothesis: z.string().min(1),
  evidenceTaskIds: z.array(z.string()).min(1),
  proposedChange: z.string().min(1),
  acceptanceCriteria: z.array(z.string()).min(1),
  status: z.enum(["proposed", "evaluated", "rejected", "accepted_for_review"]),
});
export type ImprovementCandidate = z.infer<typeof ImprovementCandidateSchema>;

export function proposeImprovements(
  results: readonly EvaluationResult[],
): ImprovementCandidate[] {
  const failures = results.filter((result) => result.status !== "PASS");
  const candidates: ImprovementCandidate[] = [];
  const provider = failures.filter(
    (result) => result.metrics.reliability.providerFailures > 0,
  );
  if (provider.length)
    candidates.push({
      candidateId: "provider-reliability",
      hypothesis: "Provider failures are preventing evaluation completion.",
      evidenceTaskIds: provider.map((result) => result.taskId),
      proposedChange:
        "Review provider timeout, retry, and model routing configuration.",
      acceptanceCriteria: [
        "Provider failure rate does not increase on the same fixture set.",
      ],
      status: "proposed",
    });
  const scope = failures.filter(
    (result) => result.metrics.correctness.unnecessaryFiles > 0,
  );
  if (scope.length)
    candidates.push({
      candidateId: "scope-control",
      hypothesis: "Tasks modify files outside their declared scope.",
      evidenceTaskIds: scope.map((result) => result.taskId),
      proposedChange:
        "Tighten task file-scope planning and permission boundaries.",
      acceptanceCriteria: [
        "No changed file falls outside the declared allowed paths.",
      ],
      status: "proposed",
    });
  return candidates;
}
