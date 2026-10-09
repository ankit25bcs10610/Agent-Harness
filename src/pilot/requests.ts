import { randomUUID } from "node:crypto";
import {
  PilotRequestSchema,
  PilotRequestStatusSchema,
  type PilotRequest,
  type PilotRequestStatus,
} from "./types";

const transitions: Record<PilotRequestStatus, readonly PilotRequestStatus[]> = {
  REQUESTED: ["QUALIFICATION", "REJECTED"],
  QUALIFICATION: ["SECURITY_REVIEW", "REJECTED"],
  SECURITY_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["ONBOARDING", "REJECTED"],
  ONBOARDING: ["ACTIVE", "PAUSED", "REJECTED"],
  ACTIVE: ["PAUSED", "COMPLETED"],
  PAUSED: ["ONBOARDING", "ACTIVE", "COMPLETED"],
  COMPLETED: [],
  REJECTED: [],
};

export function createPilotRequest(
  input: {
    organizationId: string;
    requestedBy: string;
    approvedRepositories?: string[];
    approvedModels?: string[];
  },
  now = new Date(),
): PilotRequest {
  return PilotRequestSchema.parse({
    schemaVersion: 1,
    requestId: randomUUID(),
    organizationId: input.organizationId,
    requestedBy: input.requestedBy,
    status: "REQUESTED",
    approvedRepositories: input.approvedRepositories ?? [],
    approvedModels: input.approvedModels ?? [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
}

export function transitionPilotRequest(
  request: PilotRequest,
  next: PilotRequestStatus,
  actorOrganizationId: string,
): PilotRequest {
  const current = PilotRequestSchema.parse(request);
  const target = PilotRequestStatusSchema.parse(next);
  if (current.organizationId !== actorOrganizationId)
    throw new Error("pilot request belongs to another organization");
  if (!transitions[current.status].includes(target))
    throw new Error(
      `invalid pilot request transition: ${current.status} -> ${target}`,
    );
  return PilotRequestSchema.parse({
    ...current,
    status: target,
    updatedAt: new Date().toISOString(),
  });
}

export function assertPilotRequestAccess(
  request: PilotRequest,
  actorOrganizationId: string,
) {
  const current = PilotRequestSchema.parse(request);
  if (current.organizationId !== actorOrganizationId)
    throw new Error("pilot request belongs to another organization");
  return current;
}
