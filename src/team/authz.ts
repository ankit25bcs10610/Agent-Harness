import { z } from "zod";

export const TeamRoleSchema = z.enum([
  "OWNER",
  "ADMIN",
  "MEMBER",
  "BILLING_ADMIN",
]);
export type TeamRole = z.infer<typeof TeamRoleSchema>;
export const TeamActionSchema = z.enum([
  "org:read",
  "org:update",
  "members:read",
  "members:manage",
  "policy:read",
  "policy:manage",
  "billing:read",
  "billing:manage",
  "audit:read",
]);
export type TeamAction = z.infer<typeof TeamActionSchema>;
export const TeamMembershipSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  role: TeamRoleSchema,
  active: z.boolean(),
});
export type TeamMembership = z.infer<typeof TeamMembershipSchema>;

const permissions: Record<TeamRole, readonly TeamAction[]> = {
  OWNER: [
    "org:read",
    "org:update",
    "members:read",
    "members:manage",
    "policy:read",
    "policy:manage",
    "billing:read",
    "billing:manage",
    "audit:read",
  ],
  ADMIN: [
    "org:read",
    "members:read",
    "members:manage",
    "policy:read",
    "policy:manage",
    "audit:read",
  ],
  MEMBER: ["org:read", "members:read", "policy:read"],
  BILLING_ADMIN: ["org:read", "billing:read", "billing:manage"],
};

export type AuthorizationDecision =
  | {
      allowed: true;
      organizationId: string;
      userId: string;
      action: TeamAction;
    }
  | {
      allowed: false;
      reason:
        | "invalid_membership"
        | "inactive_membership"
        | "tenant_mismatch"
        | "role_denied";
      organizationId: string;
      userId: string;
      action: TeamAction;
    };

export function authorizeTeamAction(input: {
  membership: TeamMembership;
  requestedOrganizationId: string;
  action: TeamAction;
}): AuthorizationDecision {
  const membership = TeamMembershipSchema.safeParse(input.membership);
  const action = TeamActionSchema.safeParse(input.action);
  if (!membership.success || !action.success)
    return {
      allowed: false,
      reason: "invalid_membership",
      organizationId: input.requestedOrganizationId,
      userId: input.membership?.userId ?? "unknown",
      action: input.action,
    };
  const value = membership.data;
  if (!value.active)
    return {
      allowed: false,
      reason: "inactive_membership",
      organizationId: input.requestedOrganizationId,
      userId: value.userId,
      action: action.data,
    };
  if (value.organizationId !== input.requestedOrganizationId)
    return {
      allowed: false,
      reason: "tenant_mismatch",
      organizationId: input.requestedOrganizationId,
      userId: value.userId,
      action: action.data,
    };
  if (!permissions[value.role].includes(action.data))
    return {
      allowed: false,
      reason: "role_denied",
      organizationId: input.requestedOrganizationId,
      userId: value.userId,
      action: action.data,
    };
  return {
    allowed: true,
    organizationId: value.organizationId,
    userId: value.userId,
    action: action.data,
  };
}
