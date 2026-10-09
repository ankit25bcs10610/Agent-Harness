import { randomUUID } from "node:crypto";
import { z } from "zod";

export const SecurityCaseSeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "unknown",
]);

export const SecurityCaseStatusSchema = z.enum([
  "RECEIVED",
  "TRIAGED",
  "INVESTIGATING",
  "REMEDIATING",
  "AWAITING_DISCLOSURE_APPROVAL",
  "CLOSED",
]);

export const SecurityCaseRoleSchema = z.enum([
  "security-reviewer",
  "security-engineer",
  "operator",
]);

export const SecurityActorSchema = z.object({
  actorId: z.string().min(1).max(200),
  role: SecurityCaseRoleSchema,
  tenantId: z.string().min(1).max(200).optional(),
});

const SecurityCaseHistorySchema = z.object({
  eventId: z.string().uuid(),
  action: z.string().min(1).max(100),
  from: SecurityCaseStatusSchema.optional(),
  to: SecurityCaseStatusSchema.optional(),
  actorId: z.string().min(1).max(200),
  actorRole: SecurityCaseRoleSchema,
  evidenceRefs: z.array(z.string().min(1).max(300)).max(20),
  occurredAt: z.string().datetime(),
});

const RemediationSchema = z.object({
  sourceRevision: z.string().min(1).max(200),
  regressionTestRefs: z.array(z.string().min(1).max(300)).min(1).max(20),
  linkedAt: z.string().datetime(),
  linkedBy: z.string().min(1).max(200),
});

export const SecurityCaseSchema = z.object({
  caseId: z.string().uuid(),
  tenantId: z.string().min(1).max(200),
  confidentiality: z.literal("restricted"),
  title: z.string().min(1).max(240),
  summary: z.string().min(1).max(4000),
  severity: SecurityCaseSeveritySchema,
  status: SecurityCaseStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  evidenceRefs: z.array(z.string().min(1).max(300)).max(20),
  affectedVersions: z.array(z.string().min(1).max(100)).max(20),
  remediation: RemediationSchema.optional(),
  history: z.array(SecurityCaseHistorySchema).max(100),
});

export type SecurityActor = z.infer<typeof SecurityActorSchema>;
export type SecurityCase = z.infer<typeof SecurityCaseSchema>;
export type SecurityCaseStatus = z.infer<typeof SecurityCaseStatusSchema>;

export type SecurityDisclosureDraft = {
  caseId: string;
  severity: SecurityCase["severity"];
  affectedVersions: string[];
  fixedRevision: string;
  regressionTestRefs: string[];
  approvedForSending: false;
  generatedAt: string;
};

const transitions: Record<SecurityCaseStatus, readonly SecurityCaseStatus[]> = {
  RECEIVED: ["TRIAGED"],
  TRIAGED: ["INVESTIGATING", "CLOSED"],
  INVESTIGATING: ["REMEDIATING", "CLOSED"],
  REMEDIATING: ["INVESTIGATING", "AWAITING_DISCLOSURE_APPROVAL"],
  AWAITING_DISCLOSURE_APPROVAL: ["REMEDIATING", "CLOSED"],
  CLOSED: [],
};

const transitionRoles: Record<
  SecurityCaseStatus,
  readonly SecurityActor["role"][]
> = {
  TRIAGED: ["security-reviewer", "operator"],
  INVESTIGATING: ["security-reviewer", "security-engineer", "operator"],
  REMEDIATING: ["security-reviewer", "security-engineer"],
  AWAITING_DISCLOSURE_APPROVAL: ["security-reviewer"],
  CLOSED: ["security-reviewer"],
  RECEIVED: [],
};

function assertNoCredential(value: string) {
  if (/(?:api[_-]?key|secret|token|authorization)\s*[:=]/i.test(value))
    throw new Error("security case contains a credential-like value");
}

function assertActor(actor: SecurityActor) {
  return SecurityActorSchema.parse(actor);
}

function canAccess(item: SecurityCase, actor: SecurityActor) {
  if (actor.role === "security-reviewer" || actor.role === "operator")
    return item.tenantId === "internal" || item.tenantId === actor.tenantId;
  return item.tenantId !== "internal" && item.tenantId === actor.tenantId;
}

export class SecurityCaseRegistry {
  private readonly cases = new Map<string, SecurityCase>();

  constructor(
    private readonly clock: () => Date = () => new Date(),
    private readonly idFactory: () => string = randomUUID,
  ) {}

  create(input: {
    tenantId: string;
    title: string;
    summary: string;
    severity: SecurityCase["severity"];
    affectedVersions?: string[];
    evidenceRefs?: string[];
    actor: SecurityActor;
  }) {
    const actor = assertActor(input.actor);
    if (actor.role !== "security-reviewer" && actor.role !== "operator")
      throw new Error("only security reviewers or operators may receive cases");
    if (input.tenantId === "internal" && actor.role !== "security-reviewer")
      throw new Error("only security reviewers may create internal cases");
    assertNoCredential(input.title);
    assertNoCredential(input.summary);
    if (
      actor.tenantId !== undefined &&
      actor.tenantId !== input.tenantId &&
      input.tenantId !== "internal"
    )
      throw new Error("actor is outside the case tenant");
    const now = this.clock().toISOString();
    const item = SecurityCaseSchema.parse({
      caseId: this.idFactory(),
      tenantId: input.tenantId,
      confidentiality: "restricted",
      title: input.title,
      summary: input.summary,
      severity: input.severity,
      status: "RECEIVED",
      createdAt: now,
      updatedAt: now,
      evidenceRefs: input.evidenceRefs ?? [],
      affectedVersions: input.affectedVersions ?? [],
      history: [
        {
          eventId: randomUUID(),
          action: "CASE_RECEIVED",
          actorId: actor.actorId,
          actorRole: actor.role,
          evidenceRefs: input.evidenceRefs ?? [],
          occurredAt: now,
        },
      ],
    });
    this.cases.set(item.caseId, item);
    return structuredClone(item);
  }

  get(caseId: string, actorInput: SecurityActor) {
    const actor = assertActor(actorInput);
    const item = this.cases.get(caseId);
    if (!item || !canAccess(item, actor))
      throw new Error("security case not accessible");
    return structuredClone(item);
  }

  list(actorInput: SecurityActor) {
    const actor = assertActor(actorInput);
    return [...this.cases.values()]
      .filter((item) => canAccess(item, actor))
      .map((item) => structuredClone(item));
  }

  transition(
    caseId: string,
    next: SecurityCaseStatus,
    actorInput: SecurityActor,
    evidenceRefs: string[] = [],
  ) {
    const actor = assertActor(actorInput);
    const item = this.require(caseId, actor);
    if (!transitions[item.status].includes(next))
      throw new Error(
        `invalid security case transition: ${item.status} -> ${next}`,
      );
    if (!transitionRoles[next].includes(actor.role))
      throw new Error(`role ${actor.role} cannot perform ${next}`);
    if (evidenceRefs.length === 0)
      throw new Error("security case transitions require evidence references");
    const now = this.clock().toISOString();
    const updated = SecurityCaseSchema.parse({
      ...item,
      status: next,
      updatedAt: now,
      evidenceRefs: [...new Set([...item.evidenceRefs, ...evidenceRefs])].slice(
        -20,
      ),
      history: [
        ...item.history,
        {
          eventId: randomUUID(),
          action: "STATUS_CHANGED",
          from: item.status,
          to: next,
          actorId: actor.actorId,
          actorRole: actor.role,
          evidenceRefs,
          occurredAt: now,
        },
      ],
    });
    this.cases.set(caseId, updated);
    return structuredClone(updated);
  }

  linkRemediation(
    caseId: string,
    input: { sourceRevision: string; regressionTestRefs: string[] },
    actorInput: SecurityActor,
  ) {
    const actor = assertActor(actorInput);
    const item = this.require(caseId, actor);
    if (
      actor.role !== "security-reviewer" &&
      actor.role !== "security-engineer"
    )
      throw new Error("only security engineers may link remediation");
    if (item.status !== "REMEDIATING")
      throw new Error("remediation can only be linked while remediating");
    const now = this.clock().toISOString();
    const updated = SecurityCaseSchema.parse({
      ...item,
      updatedAt: now,
      remediation: { ...input, linkedAt: now, linkedBy: actor.actorId },
      history: [
        ...item.history,
        {
          eventId: randomUUID(),
          action: "REMEDIATION_LINKED",
          actorId: actor.actorId,
          actorRole: actor.role,
          evidenceRefs: input.regressionTestRefs,
          occurredAt: now,
        },
      ],
    });
    this.cases.set(caseId, updated);
    return structuredClone(updated);
  }

  draftDisclosure(
    caseId: string,
    actorInput: SecurityActor,
  ): SecurityDisclosureDraft {
    const actor = assertActor(actorInput);
    const item = this.require(caseId, actor);
    if (actor.role !== "security-reviewer")
      throw new Error("disclosure requires a security reviewer");
    if (item.status !== "AWAITING_DISCLOSURE_APPROVAL" || !item.remediation)
      throw new Error("disclosure requires approved remediation state");
    return {
      caseId: item.caseId,
      severity: item.severity,
      affectedVersions: [...item.affectedVersions],
      fixedRevision: item.remediation.sourceRevision,
      regressionTestRefs: [...item.remediation.regressionTestRefs],
      approvedForSending: false,
      generatedAt: this.clock().toISOString(),
    };
  }

  publicSummary(caseId: string, actorInput: SecurityActor) {
    const item = this.get(caseId, actorInput);
    return {
      status: item.status,
      severity: item.severity,
      updatedAt: item.updatedAt,
    };
  }

  private require(caseId: string, actor: SecurityActor) {
    const item = this.cases.get(caseId);
    if (!item || !canAccess(item, actor))
      throw new Error("security case not accessible");
    return item;
  }
}
