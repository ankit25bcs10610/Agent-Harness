import { expect, test } from "bun:test";
import {
  ProductEvidenceRegistry,
  classifyFailure,
  createOpportunity,
  scoreOpportunity,
  validateExperiment,
} from "../../src/product-intelligence";

const analyst = {
  actorId: "analyst",
  role: "product-analyst" as const,
  tenantId: "acme",
};

function evidence(summary: string, origin: "real" | "synthetic" = "real") {
  return {
    kind: "coding_benchmark_failure" as const,
    origin,
    tenantId: "acme",
    source: {
      sourceId: origin === "real" ? "support-1" : "fixture-1",
      capturedAt: "2026-10-09T00:00:00.000Z",
      productVersion: "1.0.0",
      consent:
        origin === "real" ? ("granted" as const) : ("not_required" as const),
      visibility: "tenant" as const,
    },
    summary,
    evidenceRefs: ["test:fixture"],
    actor: analyst,
  };
}

test("evidence preserves provenance, separates synthetic fixtures, and deduplicates by fingerprint", () => {
  const registry = new ProductEvidenceRegistry();
  registry.ingest(evidence("Provider timeout during coding task"));
  registry.ingest(evidence("Provider timeout during coding task", "synthetic"));
  const patterns = registry.patterns(analyst);
  expect(patterns).toHaveLength(1);
  expect(patterns[0]).toMatchObject({
    category: "provider_failure",
    realCount: 1,
    syntheticCount: 1,
    distinctSources: 2,
  });
  expect(registry.duplicates(analyst)).toHaveLength(1);
});

test("real evidence requires consent and tenants cannot read another tenant", () => {
  const registry = new ProductEvidenceRegistry();
  expect(() =>
    registry.ingest({
      ...evidence("Installation friction"),
      source: {
        ...evidence("Installation friction").source,
        consent: "not_required",
      },
    }),
  ).toThrow("consent");
  registry.ingest(evidence("Installation friction"));
  expect(registry.list({ ...analyst, tenantId: "other" })).toHaveLength(0);
});

test("unknown causes remain hypotheses and scoring exposes uncertainty", () => {
  expect(
    classifyFailure("The task did not produce the expected result"),
  ).toEqual({
    category: "unknown",
    confidence: "hypothesis",
  });
  expect(
    scoreOpportunity({
      impactValue: 10,
      frequency: 3,
      confidence: 0.5,
      effort: null,
      securityCritical: false,
    }),
  ).toBeNull();
  const security = createOpportunity({
    tenantId: "acme",
    problemStatement: "A verified security boundary defect",
    evidenceRefs: ["00000000-0000-4000-8000-000000000001"],
    affectedWorkflows: ["tool execution"],
    impact: {
      value: 1,
      frequency: 1,
      confidence: 0.5,
      assumptions: ["synthetic fixture"],
    },
    effort: 10,
    securityCritical: true,
    dependencies: [],
    risks: ["Requires independent verification"],
    successCriteria: ["Regression test passes"],
    status: "NEEDS_VALIDATION",
  });
  expect(security.score).toBe(Number.MAX_SAFE_INTEGER);
});

test("experiments require guardrails, cannot disable security, and flag insufficient samples", () => {
  const base = {
    version: 1 as const,
    experimentId: "00000000-0000-4000-8000-000000000002",
    opportunityId: "00000000-0000-4000-8000-000000000001",
    environment: "fixture" as const,
    baseline: "Existing test suite",
    treatment: "Candidate implementation",
    primaryMetric: "verified task pass rate",
    guardrails: ["no permission changes"],
    sampleRequirement: 1,
    allowSecurityControlChanges: false as const,
    abortConditions: ["security regression"],
    status: "PLANNED" as const,
  };
  expect(validateExperiment(base)).toMatchObject({ status: "BLOCKED" });
  expect(() =>
    validateExperiment({
      ...base,
      sampleRequirement: 2,
      allowSecurityControlChanges: true as unknown as false,
    }),
  ).toThrow();
});
