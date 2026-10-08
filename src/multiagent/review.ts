import { z } from "zod";

export const ReviewFindingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["blocking", "advisory"]),
  message: z.string().min(1),
  files: z.array(z.string()),
  evidence: z.array(z.string()),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export type VerificationEvidence = {
  passed: boolean;
  checks: readonly {
    name: string;
    status: "passed" | "failed" | "untested";
    output?: string;
  }[];
};

export type ReviewAttempt = {
  verification: VerificationEvidence;
  findings: ReviewFinding[];
  repairAttempt: number;
};

export type ReviewRepairOptions = {
  maxRepairAttempts: number;
  verify: () => Promise<VerificationEvidence>;
  review: () => Promise<unknown>;
  repair: (
    findings: readonly ReviewFinding[],
    signal: AbortSignal,
  ) => Promise<boolean>;
};

export class ReviewRepairLoop {
  constructor(private readonly options: ReviewRepairOptions) {}

  async run(signal: AbortSignal): Promise<{
    accepted: boolean;
    attempts: ReviewAttempt[];
    remainingFindings: ReviewFinding[];
  }> {
    const attempts: ReviewAttempt[] = [];
    let remainingFindings: ReviewFinding[] = [];
    for (
      let repairAttempt = 0;
      repairAttempt <= this.options.maxRepairAttempts;
      repairAttempt++
    ) {
      if (signal.aborted) throw new Error("review loop cancelled");
      const verification = await this.options.verify();
      const findings = z
        .array(ReviewFindingSchema)
        .parse(await this.options.review());
      remainingFindings = findings;
      attempts.push({ verification, findings, repairAttempt });
      const blocking = findings.some(
        (finding) => finding.severity === "blocking",
      );
      if (verification.passed && !blocking)
        return { accepted: true, attempts, remainingFindings: findings };
      if (repairAttempt === this.options.maxRepairAttempts) break;
      if (!(await this.options.repair(findings, signal))) break;
    }
    return { accepted: false, attempts, remainingFindings };
  }
}
