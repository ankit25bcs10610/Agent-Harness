import { randomUUID } from "node:crypto";
import {
  GovernanceActionSchema,
  PolicyDocumentSchema,
  WorkloadIdentitySchema,
  operationFingerprint,
  policyDigest,
  type Approval,
  type GovernanceAction,
  type GovernanceAuditEvent,
  type GovernanceDecision,
  type PolicyDocument,
  type PolicyDocumentInput,
  type WorkloadIdentity,
} from "./types";

const now = () => new Date().toISOString();

function validIdentity(identity: WorkloadIdentity, at = Date.now()) {
  const parsed = WorkloadIdentitySchema.parse(identity);
  return (
    !parsed.credential.revokedAt && Date.parse(parsed.credential.expiresAt) > at
  );
}

function matches(
  rule: PolicyDocument["rules"][number],
  action: GovernanceAction,
  identity: WorkloadIdentity,
) {
  return (
    (!rule.capabilities || rule.capabilities.includes(action.capability)) &&
    (!rule.operations || rule.operations.includes(action.operation)) &&
    (!rule.actorTypes || rule.actorTypes.includes(identity.actorType)) &&
    (!rule.workspaceIds || rule.workspaceIds.includes(action.workspaceId)) &&
    (rule.maxRisk === "high" || action.risk === "normal")
  );
}

export class GovernanceBroker {
  readonly audit: GovernanceAuditEvent[] = [];
  readonly policy: PolicyDocument;
  private approvals = new Map<string, Approval>();

  constructor(
    readonly identity: WorkloadIdentity,
    policy: PolicyDocumentInput,
    private readonly systemDeny: readonly GovernanceAction["capability"][] = [],
  ) {
    WorkloadIdentitySchema.parse(identity);
    const parsedPolicy = PolicyDocumentSchema.parse(policy);
    this.policy = parsedPolicy;
    const { provenance, ...unsignedPolicy } = parsedPolicy;
    if (policyDigest(unsignedPolicy) !== provenance.digest)
      throw new Error("policy provenance digest mismatch");
    if (identity.tenantId !== policy.organizationId)
      throw new Error("governance identity and policy tenant mismatch");
    if (!validIdentity(identity))
      throw new Error("workload credential is expired or revoked");
  }

  authorize(input: GovernanceAction, at = Date.now()): GovernanceDecision {
    const action = GovernanceActionSchema.parse(input);
    let decision: GovernanceDecision = "ERROR";
    let reason = "policy evaluation failed";
    try {
      if (!validIdentity(this.identity, at)) {
        reason = "workload credential is expired or revoked";
        decision = "DENY";
      } else if (
        action.tenantId !== this.identity.tenantId ||
        action.workspaceId !== this.identity.workspaceId
      ) {
        reason = "identity scope mismatch";
        decision = "DENY";
      } else if (this.systemDeny.includes(action.capability)) {
        reason = "system safety policy denies capability";
        decision = "DENY";
      } else {
        const matching = this.policy.rules.filter((rule) =>
          matches(rule, action, this.identity),
        );
        const deny = matching.find((rule) => rule.effect === "deny");
        const approval = matching.find((rule) => rule.effect === "approval");
        const allow = matching.find((rule) => rule.effect === "allow");
        if (deny) {
          reason = `policy rule ${deny.id} denies operation`;
          decision = "DENY";
        } else if (approval) {
          reason = `policy rule ${approval.id} requires human approval`;
          decision = "REQUIRES_APPROVAL";
        } else if (allow) {
          reason = `policy rule ${allow.id} allows operation`;
          decision = "ALLOW";
        }
      }
    } catch (error) {
      reason =
        error instanceof Error ? error.message : "policy evaluation failed";
    }
    this.audit.push({
      correlationId: action.operationId,
      at: new Date(at).toISOString(),
      actorId: this.identity.actorId,
      tenantId: this.identity.tenantId,
      workspaceId: this.identity.workspaceId,
      operation: action.operation,
      capability: action.capability,
      target: action.target,
      decision,
      policyId: this.policy.policyId,
      policyVersion: this.policy.version,
      reason,
    });
    return decision;
  }

  requestApproval(action: GovernanceAction, ttlMs = 5 * 60_000): Approval {
    if (this.identity.actorType !== "human")
      throw new Error("only a human identity may approve an operation");
    if (this.authorize(action) !== "REQUIRES_APPROVAL")
      throw new Error(
        "operation does not require approval under the current policy",
      );
    const approval: Approval = {
      approvalId: randomUUID(),
      operationFingerprint: operationFingerprint(action),
      actorId: this.identity.actorId,
      tenantId: this.identity.tenantId,
      workspaceId: this.identity.workspaceId,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    };
    this.approvals.set(approval.approvalId, approval);
    return approval;
  }

  approve(approvalId: string) {
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new Error("approval not found");
    return approval;
  }

  revokeApproval(approvalId: string) {
    const approval = this.approvals.get(approvalId);
    if (approval) approval.revokedAt = now();
  }

  authorizeApproved(
    action: GovernanceAction,
    approvalId: string,
    at = Date.now(),
  ) {
    const approval = this.approvals.get(approvalId);
    if (!approval || approval.revokedAt || Date.parse(approval.expiresAt) <= at)
      return false;
    return (
      approval.actorId === this.identity.actorId &&
      approval.tenantId === action.tenantId &&
      approval.workspaceId === action.workspaceId &&
      operationFingerprint(action) === approval.operationFingerprint
    );
  }

  authorizeWithApproval(
    action: GovernanceAction,
    approvalId: string,
    at = Date.now(),
  ) {
    const decision = this.authorize(action, at);
    if (
      decision !== "REQUIRES_APPROVAL" ||
      !this.authorizeApproved(action, approvalId, at)
    )
      return false;
    const event = this.audit.at(-1);
    if (event) {
      event.decision = "ALLOW";
      event.approvalId = approvalId;
      event.reason = "exact human approval matched";
    }
    return true;
  }
}
