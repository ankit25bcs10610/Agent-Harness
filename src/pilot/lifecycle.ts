import {
  PilotEvaluationSchema,
  type PilotEvaluation,
  type PilotStatus,
} from "./types";

const transitions: Record<PilotStatus, readonly PilotStatus[]> = {
  draft: ["authorized"],
  authorized: ["active", "paused", "closed"],
  active: ["paused", "closed"],
  paused: ["active", "closed"],
  closed: [],
};

export function transitionPilot(
  evaluation: PilotEvaluation,
  next: PilotStatus,
  actorOrganizationId: string,
): PilotEvaluation {
  const current = PilotEvaluationSchema.parse(evaluation);
  if (current.organizationId !== actorOrganizationId)
    throw new Error("pilot belongs to another organization");
  if (!transitions[current.status].includes(next))
    throw new Error(`invalid pilot transition: ${current.status} -> ${next}`);
  return PilotEvaluationSchema.parse({
    ...current,
    status: next,
    updatedAt: new Date().toISOString(),
  });
}

export function assertPilotAccess(
  evaluation: PilotEvaluation,
  actorOrganizationId: string,
) {
  const current = PilotEvaluationSchema.parse(evaluation);
  if (current.organizationId !== actorOrganizationId)
    throw new Error("pilot belongs to another organization");
  return current;
}
