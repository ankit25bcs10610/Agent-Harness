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
    const authorized = transitionPilot(evaluation(), "authorized", "org-a");
    expect(transitionPilot(authorized, "active", "org-a").status).toBe(
      "active",
    );
    expect(() => transitionPilot(evaluation(), "active", "org-a")).toThrow(
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
    const qualified = transitionPilotRequest(request, "QUALIFICATION", "org-a");
    const reviewed = transitionPilotRequest(
      qualified,
      "SECURITY_REVIEW",
      "org-a",
    );
    const approved = transitionPilotRequest(reviewed, "APPROVED", "org-a");
    expect(approved.status).toBe("APPROVED");
    expect(() => transitionPilotRequest(request, "APPROVED", "org-a")).toThrow(
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
      request = transitionPilotRequest(request, status, "org-a");
    request = transitionPilotRequest(request, "PAUSED", "org-a");
    request = transitionPilotRequest(request, "ACTIVE", "org-a");
    expect(transitionPilotRequest(request, "COMPLETED", "org-a").status).toBe(
      "COMPLETED",
    );
  });
});
