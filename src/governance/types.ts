import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export const WorkloadIdentitySchema = z
  .object({
    actorId: z.string().trim().min(1).max(200),
    actorType: z.enum(["human", "service", "child"]),
    tenantId: z.string().trim().min(1).max(200),
    workspaceId: z.string().trim().min(1).max(300),
    sessionId: z.string().trim().min(1).max(200),
    credential: z
      .object({
        id: z.string().trim().min(1).max(200),
        expiresAt: z.string().datetime({ offset: true }),
        revokedAt: z.string().datetime({ offset: true }).optional(),
      })
      .strict(),
  })
  .strict();
export type WorkloadIdentity = z.infer<typeof WorkloadIdentitySchema>;

export const GovernanceActionSchema = z
  .object({
    operationId: z.string().uuid(),
    operation: z.string().trim().min(1).max(200),
    capability: z.enum([
      "read",
      "create",
      "modify",
      "delete",
      "execute",
      "external",
    ]),
    target: z.string().trim().min(1).max(4_000),
    tenantId: z.string().trim().min(1).max(200),
    workspaceId: z.string().trim().min(1).max(300),
    risk: z.enum(["normal", "high"]),
    consequence: z.string().trim().min(1).max(1_000),
  })
  .strict();
export type GovernanceAction = z.infer<typeof GovernanceActionSchema>;

export const PolicyRuleSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    effect: z.enum(["allow", "deny", "approval"]),
    capabilities: z
      .array(GovernanceActionSchema.shape.capability)
      .max(6)
      .optional(),
    operations: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    actorTypes: z
      .array(WorkloadIdentitySchema.shape.actorType)
      .max(3)
      .optional(),
    workspaceIds: z
      .array(z.string().trim().min(1).max(300))
      .max(100)
      .optional(),
    maxRisk: z.enum(["normal", "high"]).default("high"),
  })
  .strict();
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const PolicyDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    policyId: z.string().trim().min(1).max(200),
    organizationId: z.string().trim().min(1).max(200),
    version: z.number().int().positive(),
    issuer: z.string().trim().min(1).max(200),
    provenance: z
      .object({
        digest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    rules: z.array(PolicyRuleSchema).min(1).max(500),
  })
  .strict();
export type PolicyDocument = z.infer<typeof PolicyDocumentSchema>;
export type PolicyDocumentInput = z.input<typeof PolicyDocumentSchema>;

export type GovernanceDecision =
  "ALLOW" | "DENY" | "REQUIRES_APPROVAL" | "ERROR";

export type Approval = {
  approvalId: string;
  operationFingerprint: string;
  actorId: string;
  tenantId: string;
  workspaceId: string;
  expiresAt: string;
  revokedAt?: string;
};

export type GovernanceAuditEvent = {
  correlationId: string;
  at: string;
  actorId: string;
  tenantId: string;
  workspaceId: string;
  operation: string;
  capability: GovernanceAction["capability"];
  target: string;
  decision: GovernanceDecision;
  policyId: string;
  policyVersion: number;
  approvalId?: string;
  reason: string;
};

export type UnsignedPolicyDocument = Omit<
  z.input<typeof PolicyDocumentSchema>,
  "provenance"
>;

export function policyDigest(input: UnsignedPolicyDocument) {
  const canonical = {
    ...input,
    rules: input.rules.map((rule) => PolicyRuleSchema.parse(rule)),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function operationFingerprint(action: GovernanceAction) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        operation: action.operation,
        capability: action.capability,
        target: action.target,
        tenantId: action.tenantId,
        workspaceId: action.workspaceId,
        risk: action.risk,
      }),
    )
    .digest("hex");
}

export function newGovernanceAction(
  input: Omit<GovernanceAction, "operationId">,
): GovernanceAction {
  return GovernanceActionSchema.parse({ ...input, operationId: randomUUID() });
}
