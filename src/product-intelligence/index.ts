import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export const ProductEvidenceKindSchema = z.enum([
  "user_problem",
  "product_defect",
  "coding_benchmark_failure",
  "support_incident",
  "onboarding_problem",
  "feature_request",
  "security_concern",
  "performance_regression",
]);
export const ProductEvidenceOriginSchema = z.enum(["real", "synthetic"]);
export const ProductEvidenceSchema = z.object({
  version: z.literal(1),
  evidenceId: z.string().uuid(),
  kind: ProductEvidenceKindSchema,
  origin: ProductEvidenceOriginSchema,
  tenantId: z.string().trim().min(1).max(200),
  source: z.object({
    sourceId: z.string().trim().min(1).max(300),
    capturedAt: z.string().datetime({ offset: true }),
    productVersion: z.string().trim().min(1).max(100),
    consent: z.enum(["granted", "not_required"]),
    visibility: z.enum(["internal", "tenant"]),
  }),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  summary: z.string().trim().min(1).max(1000),
  failureCategory: z
    .enum([
      "wrong_file",
      "incorrect_patch",
      "tests_not_executed",
      "permission_friction",
      "provider_failure",
      "session_corruption",
      "installation_friction",
      "performance_regression",
      "unknown",
    ])
    .optional(),
  evidenceRefs: z.array(z.string().trim().min(1).max(300)).max(20),
});
export type ProductEvidence = z.infer<typeof ProductEvidenceSchema>;

export const ProductActorSchema = z.object({
  actorId: z.string().trim().min(1).max(200),
  role: z.enum(["product-analyst", "security-reviewer", "engineer"]),
  tenantId: z.string().trim().min(1).max(200),
});
export type ProductActor = z.infer<typeof ProductActorSchema>;

export const OpportunityStatusSchema = z.enum([
  "READY_FOR_ENGINEERING",
  "NEEDS_VALIDATION",
  "BLOCKED",
  "DEFERRED",
  "REJECTED",
  "COMPLETED_AND_VERIFIED",
]);
export const OpportunitySchema = z.object({
  version: z.literal(1),
  opportunityId: z.string().uuid(),
  tenantId: z.string().min(1),
  problemStatement: z.string().min(1).max(1000),
  evidenceRefs: z.array(z.string().uuid()).min(1).max(50),
  affectedWorkflows: z.array(z.string().min(1).max(200)).min(1).max(20),
  impact: z.object({
    value: z.number().nonnegative(),
    frequency: z.number().nonnegative(),
    confidence: z.number().min(0).max(1),
    assumptions: z.array(z.string().min(1).max(500)).min(1).max(20),
  }),
  effort: z.number().positive().nullable(),
  securityCritical: z.boolean(),
  dependencies: z.array(z.string().min(1).max(200)).max(20),
  risks: z.array(z.string().min(1).max(500)).max(20),
  successCriteria: z.array(z.string().min(1).max(500)).min(1).max(20),
  score: z.number().nonnegative().nullable(),
  status: OpportunityStatusSchema,
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

export const ExperimentSpecSchema = z
  .object({
    version: z.literal(1),
    experimentId: z.string().uuid(),
    opportunityId: z.string().uuid(),
    environment: z.enum(["fixture", "authorized"]),
    baseline: z.string().min(1).max(1000),
    treatment: z.string().min(1).max(1000),
    primaryMetric: z.string().min(1).max(300),
    guardrails: z.array(z.string().min(1).max(300)).min(1).max(20),
    sampleRequirement: z.number().int().positive(),
    allowSecurityControlChanges: z.literal(false),
    abortConditions: z.array(z.string().min(1).max(500)).min(1).max(20),
    status: z.enum(["PLANNED", "RUNNING", "PASSED", "FAILED", "BLOCKED"]),
  })
  .strict();
export type ExperimentSpec = z.infer<typeof ExperimentSpecSchema>;

export type EvidencePattern = {
  tenantId: string;
  category: NonNullable<ProductEvidence["failureCategory"]>;
  realCount: number;
  syntheticCount: number;
  distinctSources: number;
  evidenceIds: string[];
};

type EvidenceIngestInput = Omit<
  ProductEvidence,
  "version" | "evidenceId" | "fingerprint"
> & { evidenceId?: string; fingerprint?: string; actor: ProductActor };

function fingerprint(input: string) {
  return createHash("sha256")
    .update(input.trim().toLowerCase().replace(/\s+/g, " "))
    .digest("hex");
}

function canAccess(item: { tenantId: string }, actor: ProductActor) {
  return item.tenantId === actor.tenantId;
}

export function classifyFailure(summary: string): {
  category: NonNullable<ProductEvidence["failureCategory"]>;
  confidence: "grounded" | "hypothesis";
} {
  const value = summary.toLowerCase();
  const known: Array<
    [NonNullable<ProductEvidence["failureCategory"]>, RegExp]
  > = [
    ["wrong_file", /wrong|incorrect|selected.*file|target.*file/],
    ["incorrect_patch", /patch|edit|diff|replacement/],
    ["tests_not_executed", /test.*not|did not run|unverified/],
    ["permission_friction", /permission|approval|denied/],
    ["provider_failure", /provider|model|rate.?limit|timeout/],
    ["session_corruption", /session|corrupt|resume/],
    ["installation_friction", /install|package|setup/],
    ["performance_regression", /slow|latency|performance|regression/],
  ];
  const match = known.find(([, pattern]) => pattern.test(value));
  return match
    ? { category: match[0], confidence: "grounded" }
    : { category: "unknown", confidence: "hypothesis" };
}

export class ProductEvidenceRegistry {
  private readonly records = new Map<string, ProductEvidence>();

  ingest(input: EvidenceIngestInput) {
    const actor = ProductActorSchema.parse(input.actor);
    if (actor.role !== "product-analyst" && actor.role !== "security-reviewer")
      throw new Error(
        "only product analysts or security reviewers may ingest evidence",
      );
    if (actor.tenantId !== input.tenantId)
      throw new Error("evidence tenant is not authorized");
    if (input.source.consent !== "granted" && input.origin === "real")
      throw new Error("real product evidence requires consent");
    if (
      input.origin === "real" &&
      input.source.visibility === "tenant" &&
      !canAccess(input, actor)
    )
      throw new Error("evidence tenant is not authorized");
    const value = ProductEvidenceSchema.parse({
      version: 1,
      evidenceId: input.evidenceId ?? randomUUID(),
      fingerprint: input.fingerprint ?? fingerprint(input.summary),
      ...input,
    });
    if (this.records.has(value.evidenceId))
      throw new Error("duplicate product evidence identifier");
    this.records.set(value.evidenceId, value);
    return structuredClone(value);
  }

  list(actorInput: ProductActor) {
    const actor = ProductActorSchema.parse(actorInput);
    return [...this.records.values()]
      .filter((item) => canAccess(item, actor))
      .map((item) => structuredClone(item));
  }

  patterns(actorInput: ProductActor): EvidencePattern[] {
    const records = this.list(actorInput);
    const groups = new Map<string, ProductEvidence[]>();
    for (const item of records) {
      const category =
        item.failureCategory ?? classifyFailure(item.summary).category;
      const key = `${item.tenantId}:${category}:${item.fingerprint}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.values()].map((items) => ({
      tenantId: items[0]!.tenantId,
      category:
        items[0]!.failureCategory ??
        classifyFailure(items[0]!.summary).category,
      realCount: items.filter((item) => item.origin === "real").length,
      syntheticCount: items.filter((item) => item.origin === "synthetic")
        .length,
      distinctSources: new Set(items.map((item) => item.source.sourceId)).size,
      evidenceIds: items.map((item) => item.evidenceId),
    }));
  }

  duplicates(actorInput: ProductActor) {
    const records = this.list(actorInput);
    const groups = new Map<string, ProductEvidence[]>();
    for (const item of records) {
      const key = `${item.tenantId}:${item.fingerprint}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.values()]
      .filter((items) => items.length > 1)
      .map((items) => ({
        fingerprint: items[0]!.fingerprint,
        evidenceIds: items.map((item) => item.evidenceId),
        realSourceCount: new Set(
          items
            .filter((item) => item.origin === "real")
            .map((item) => item.source.sourceId),
        ).size,
        syntheticCount: items.filter((item) => item.origin === "synthetic")
          .length,
      }));
  }
}

export function scoreOpportunity(input: {
  impactValue: number;
  frequency: number;
  confidence: number;
  effort: number | null;
  securityCritical: boolean;
}) {
  for (const value of [input.impactValue, input.frequency, input.confidence])
    if (!Number.isFinite(value) || value < 0)
      throw new Error("score inputs must be finite and non-negative");
  if (input.confidence > 1)
    throw new Error("confidence must be between 0 and 1");
  if (
    input.effort !== null &&
    (!Number.isFinite(input.effort) || input.effort <= 0)
  )
    throw new Error("effort must be positive or unknown");
  if (input.securityCritical) return Number.MAX_SAFE_INTEGER;
  return input.effort === null
    ? null
    : (input.impactValue * input.frequency * input.confidence) / input.effort;
}

export function createOpportunity(
  input: Omit<Opportunity, "version" | "opportunityId" | "score">,
) {
  return OpportunitySchema.parse({
    version: 1,
    opportunityId: randomUUID(),
    score: scoreOpportunity({
      impactValue: input.impact.value,
      frequency: input.impact.frequency,
      confidence: input.impact.confidence,
      effort: input.effort,
      securityCritical: input.securityCritical,
    }),
    ...input,
  });
}

export function validateExperiment(input: ExperimentSpec) {
  const experiment = ExperimentSpecSchema.parse(input);
  if (experiment.sampleRequirement < 2)
    return {
      experiment,
      status: "BLOCKED" as const,
      reason: "sample requirement is too small",
    };
  return { experiment, status: experiment.status, reason: undefined };
}
