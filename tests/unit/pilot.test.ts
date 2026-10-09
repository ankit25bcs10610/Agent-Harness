import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  assertPilotAccess,
  assertPilotRequestAccess,
  createPilotRequest,
  transitionPilot,
  transitionPilotRequest,
  type PilotEvaluation,
} from "../../src/pilot";
import type { TeamMembership } from "../../src/team";

function actor(
  role: TeamMembership["role"] = "OWNER",
  organizationId = "org-a",
): { membership: TeamMembership } {
  return {
    membership: {
      userId: `${role.toLowerCase()}-user`,
      organizationId,
      role,
      active: true,
    },
  };
}

function evaluation(organizationId = "org-a"): PilotEvaluation {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    evaluationId: randomUUID(),
    organizationId,
    productVersion: "1.0.0",
    status: "draft",
    requirements: [],
    supportedModels: [],
    authorizedRepositories: [],
    taskIds: [],
    verification: [],
    issueIds: [],
    costs: { providerCents: null, softwareCents: null, status: "unknown" },
    feedbackDraftIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe("pilot evaluation lifecycle", () => {
  test("requires authorization before activation", () => {
    const authorized = transitionPilot(evaluation(), "authorized", actor());
    expect(transitionPilot(authorized, "active", actor()).status).toBe(
      "active",
    );
    expect(() => transitionPilot(evaluation(), "active", actor())).toThrow(
      "invalid pilot transition",
    );
  });
  test("enforces tenant ownership", () => {
    expect(() => assertPilotAccess(evaluation("org-a"), "org-b")).toThrow(
      "another organization",
    );
  });
  test("does not turn unknown cost data into a zero", () => {
    expect(evaluation().costs.providerCents).toBeNull();
    expect(evaluation().costs.status).toBe("unknown");
  });
});

describe("pilot request lifecycle", () => {
  test("requires qualification and security review before approval", () => {
    const request = createPilotRequest(
      {
        organizationId: "org-a",
        requestedBy: "owner-a",
      },
      new Date("2026-01-01T00:00:00.000Z"),
    );
    const qualified = transitionPilotRequest(request, "QUALIFICATION", actor());
    const reviewed = transitionPilotRequest(
      qualified,
      "SECURITY_REVIEW",
      actor(),
    );
    const approved = transitionPilotRequest(reviewed, "APPROVED", actor());
    expect(approved.status).toBe("APPROVED");
    expect(() => transitionPilotRequest(request, "APPROVED", actor())).toThrow(
      "invalid pilot request transition",
    );
  });

  test("enforces tenant access and supports onboarding, pause, and completion", () => {
    let request = createPilotRequest({
      organizationId: "org-a",
      requestedBy: "owner-a",
    });
    expect(() => assertPilotRequestAccess(request, "org-b")).toThrow(
      "another organization",
    );
    for (const status of [
      "QUALIFICATION",
      "SECURITY_REVIEW",
      "APPROVED",
      "ONBOARDING",
      "ACTIVE",
    ] as const)
      request = transitionPilotRequest(request, status, actor());
    request = transitionPilotRequest(request, "PAUSED", actor());
    request = transitionPilotRequest(request, "ACTIVE", actor());
    expect(transitionPilotRequest(request, "COMPLETED", actor()).status).toBe(
      "COMPLETED",
    );
  });

  test("same-tenant members cannot approve or authorize a pilot", () => {
    const request = createPilotRequest({
      organizationId: "org-a",
      requestedBy: "member-a",
    });
    expect(() =>
      transitionPilotRequest(request, "APPROVED", actor("MEMBER")),
    ).toThrow("role_denied");
    expect(() =>
      transitionPilotRequest(request, "SECURITY_REVIEW", actor("MEMBER")),
    ).toThrow("role_denied");
  });
});
