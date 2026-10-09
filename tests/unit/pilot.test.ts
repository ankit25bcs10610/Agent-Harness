import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  assertPilotAccess,
  transitionPilot,
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
