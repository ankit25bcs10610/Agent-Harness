import { expect, test } from "bun:test";
import { SecurityCaseRegistry } from "../../src/security";

const reviewer = {
  actorId: "reviewer",
  role: "security-reviewer" as const,
  tenantId: "acme",
};
const engineer = {
  actorId: "engineer",
  role: "security-engineer" as const,
  tenantId: "acme",
};

test("restricted cases enforce lifecycle roles, remediation evidence, and no auto-disclosure", () => {
  const registry = new SecurityCaseRegistry(
    () => new Date("2026-10-09T00:00:00.000Z"),
  );
  const received = registry.create({
    tenantId: "acme",
    title: "Path boundary report",
    summary: "A synthetic fixture needs investigation.",
    severity: "high",
    actor: reviewer,
  });
  expect(() =>
    registry.transition(received.caseId, "TRIAGED", reviewer, []),
  ).toThrow("evidence references");
  registry.transition(received.caseId, "TRIAGED", reviewer, ["fixture:triage"]);
  registry.transition(received.caseId, "INVESTIGATING", engineer, [
    "test:reproduce",
  ]);
  registry.transition(received.caseId, "REMEDIATING", engineer, [
    "test:regression",
  ]);
  registry.linkRemediation(
    received.caseId,
    { sourceRevision: "local-revision", regressionTestRefs: ["test:security"] },
    engineer,
  );
  registry.transition(
    received.caseId,
    "AWAITING_DISCLOSURE_APPROVAL",
    reviewer,
    ["evidence:fix"],
  );
  const draft = registry.draftDisclosure(received.caseId, reviewer);
  expect(draft.approvedForSending).toBe(false);
  expect(JSON.stringify(draft)).not.toContain("A synthetic");
  expect(registry.publicSummary(received.caseId, reviewer)).toEqual({
    status: "AWAITING_DISCLOSURE_APPROVAL",
    severity: "high",
    updatedAt: "2026-10-09T00:00:00.000Z",
  });
});

test("tenant isolation prevents cross-tenant and internal case access", () => {
  const registry = new SecurityCaseRegistry();
  const tenantCase = registry.create({
    tenantId: "acme",
    title: "Tenant report",
    summary: "Restricted fixture report.",
    severity: "medium",
    actor: { ...reviewer, tenantId: "acme" },
  });
  expect(() =>
    registry.get(tenantCase.caseId, { ...engineer, tenantId: "other" }),
  ).toThrow("not accessible");
  const internalCase = registry.create({
    tenantId: "internal",
    title: "Internal report",
    summary: "Restricted internal fixture.",
    severity: "low",
    actor: reviewer,
  });
  expect(() => registry.get(internalCase.caseId, engineer)).toThrow(
    "not accessible",
  );
  expect(registry.list(engineer)).toHaveLength(1);
});

test("credential-like report content is rejected before persistence", () => {
  const registry = new SecurityCaseRegistry();
  expect(() =>
    registry.create({
      tenantId: "acme",
      title: "Credential report",
      summary: "api_key=synthetic-secret-value",
      severity: "critical",
      actor: { ...reviewer, tenantId: "acme" },
    }),
  ).toThrow("credential-like");
});
