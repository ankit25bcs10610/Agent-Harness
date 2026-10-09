import { describe, expect, test } from "bun:test";
import { authorizeTeamAction } from "../../src/team";

describe("team authorization boundary", () => {
  const membership = {
    userId: "user-1",
    organizationId: "org-a",
    role: "MEMBER" as const,
    active: true,
  };
  test("denies cross-tenant access before role evaluation", () => {
    const decision = authorizeTeamAction({
      membership,
      requestedOrganizationId: "org-b",
      action: "org:read",
    });
    expect(decision).toMatchObject({
      allowed: false,
      reason: "tenant_mismatch",
    });
  });
  test("denies member billing administration", () => {
    const decision = authorizeTeamAction({
      membership,
      requestedOrganizationId: "org-a",
      action: "billing:manage",
    });
    expect(decision).toMatchObject({ allowed: false, reason: "role_denied" });
  });
  test("allows owner policy administration only for the matching tenant", () => {
    const decision = authorizeTeamAction({
      membership: { ...membership, role: "OWNER" },
      requestedOrganizationId: "org-a",
      action: "policy:manage",
    });
    expect(decision.allowed).toBe(true);
  });
  test("denies inactive memberships", () => {
    const decision = authorizeTeamAction({
      membership: { ...membership, active: false },
      requestedOrganizationId: "org-a",
      action: "org:read",
    });
    expect(decision).toMatchObject({
      allowed: false,
      reason: "inactive_membership",
    });
  });
});
