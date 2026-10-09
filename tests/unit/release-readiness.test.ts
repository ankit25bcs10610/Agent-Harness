import { expect, test } from "bun:test";
import { assessProductBaseline, assessReleaseScope } from "../../src/release";

test("a package version is not treated as proof of a public release", () => {
  const baseline = assessProductBaseline({
    packageVersion: "1.0.0",
    published: false,
    artifactVerified: false,
    releaseEvidence: [],
  });
  expect(baseline.state).toBe("VERSIONED_UNRELEASED");
  expect(baseline.limitations.join(" ")).toContain("does not prove");
});

test("release scope does not transfer local evidence to hosted products", () => {
  const baseline = assessProductBaseline({
    packageVersion: "1.0.0",
    published: false,
    artifactVerified: false,
    releaseEvidence: [],
  });
  expect(
    assessReleaseScope({
      scope: "HOSTED_TEAM_SERVICES",
      baseline,
      gates: [{ status: "PASS" }],
      candidateArtifactVerified: true,
      installedWorkflowVerified: true,
      humanApproval: false,
    }),
  ).toMatchObject({ decision: "INSUFFICIENT_EVIDENCE" });
});

test("local CLI candidate remains human-approval gated after technical evidence", () => {
  const baseline = assessProductBaseline({
    packageVersion: "1.0.0",
    published: false,
    artifactVerified: false,
    releaseEvidence: [],
  });
  expect(
    assessReleaseScope({
      scope: "LOCAL_CLI_1_1",
      baseline,
      gates: [{ status: "PASS" }],
      candidateArtifactVerified: true,
      installedWorkflowVerified: true,
      humanApproval: false,
    }),
  ).toMatchObject({ decision: "READY_FOR_APPROVAL" });
});

test("failed release gates make the candidate not ready", () => {
  const baseline = assessProductBaseline({
    packageVersion: "1.0.0",
    published: false,
    artifactVerified: false,
    releaseEvidence: [],
  });
  expect(
    assessReleaseScope({
      scope: "LOCAL_CLI_1_1",
      baseline,
      gates: [{ status: "FAIL" }],
      candidateArtifactVerified: true,
      installedWorkflowVerified: true,
      humanApproval: false,
    }),
  ).toMatchObject({ decision: "NOT_READY" });
});
