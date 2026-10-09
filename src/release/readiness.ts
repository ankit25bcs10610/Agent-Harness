import { z } from "zod";
import type { ReleaseManifest } from "./manifest";

export const ProductBaselineStateSchema = z.enum([
  "VERIFIED_RELEASE",
  "VERSIONED_UNRELEASED",
  "UNKNOWN",
]);
export type ProductBaselineState = z.infer<typeof ProductBaselineStateSchema>;

export const ReleaseScopeSchema = z.enum([
  "LOCAL_CLI_1_1",
  "ADVANCED_CODING_FEATURES",
  "IDE_INTEGRATIONS",
  "PLUGIN_SDK",
  "HOSTED_TEAM_SERVICES",
  "ENTERPRISE_EDITION",
]);
export type ReleaseScope = z.infer<typeof ReleaseScopeSchema>;

export const ScopeDecisionSchema = z.enum([
  "READY_FOR_APPROVAL",
  "CONDITIONAL_READY",
  "NOT_READY",
  "INSUFFICIENT_EVIDENCE",
]);
export type ScopeDecision = z.infer<typeof ScopeDecisionSchema>;

export type BaselineAssessment = {
  packageVersion: string;
  state: ProductBaselineState;
  evidence: string[];
  limitations: string[];
};

export function assessProductBaseline(input: {
  packageVersion: string;
  manifest?: ReleaseManifest;
  published: boolean;
  artifactVerified: boolean;
  releaseEvidence: readonly string[];
}): BaselineAssessment {
  const versioned = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(
    input.packageVersion,
  );
  if (!versioned)
    return {
      packageVersion: input.packageVersion,
      state: "UNKNOWN",
      evidence: [],
      limitations: ["package version is not valid semver"],
    };
  const verifiedRelease =
    input.published &&
    input.artifactVerified &&
    input.releaseEvidence.length > 0 &&
    input.manifest?.version === input.packageVersion &&
    input.manifest.channel === "stable" &&
    input.manifest.sourceState === "clean" &&
    input.manifest.sourceRevision !== "unknown";
  if (verifiedRelease)
    return {
      packageVersion: input.packageVersion,
      state: "VERIFIED_RELEASE",
      evidence: [...input.releaseEvidence],
      limitations: [
        "Manifest integrity is verified; signing and independent release review remain separate controls.",
      ],
    };
  return {
    packageVersion: input.packageVersion,
    state: "VERSIONED_UNRELEASED",
    evidence: [],
    limitations: [
      "A package version alone does not prove that a public release occurred.",
      "Publication, artifact verification, or release evidence is incomplete.",
    ],
  };
}

export function assessReleaseScope(input: {
  scope: ReleaseScope;
  baseline: BaselineAssessment;
  gates: readonly { status: "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN" }[];
  candidateArtifactVerified: boolean;
  installedWorkflowVerified: boolean;
  humanApproval: boolean;
}): { scope: ReleaseScope; decision: ScopeDecision; reasons: string[] } {
  const reasons: string[] = [];
  if (
    input.gates.some(
      (gate) => gate.status === "FAIL" || gate.status === "BLOCKED",
    )
  )
    return {
      scope: input.scope,
      decision: "NOT_READY",
      reasons: ["one or more supplied release gates failed or are blocked"],
    };
  if (input.scope !== "LOCAL_CLI_1_1")
    return {
      scope: input.scope,
      decision: "INSUFFICIENT_EVIDENCE",
      reasons: [
        "this local release assessment does not establish hosted, IDE, plugin, or enterprise readiness",
      ],
    };
  if (input.baseline.state === "UNKNOWN")
    reasons.push("current product baseline is unknown");
  if (!input.candidateArtifactVerified)
    reasons.push("candidate artifact has not been verified");
  if (!input.installedWorkflowVerified)
    reasons.push(
      "clean installation and developer workflow have not been verified",
    );
  if (reasons.length > 0)
    return { scope: input.scope, decision: "CONDITIONAL_READY", reasons };
  if (!input.humanApproval)
    return {
      scope: input.scope,
      decision: "READY_FOR_APPROVAL",
      reasons: [
        "technical evidence is present; human release approval is still required",
      ],
    };
  return {
    scope: input.scope,
    decision: "READY_FOR_APPROVAL",
    reasons: [
      "release publication remains a separate explicitly authorized action",
    ],
  };
}
