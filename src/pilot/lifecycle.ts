import {
  PilotEvaluationSchema,
  type PilotEvaluation,
  type PilotStatus,
} from "./types";
import {
  authorizeTeamAction,
  type TeamAction,
  type TeamMembership,
} from "../team/authz";

type PilotActor = { membership: TeamMembership };

function actionForTransition(next: PilotStatus): TeamAction {
  if (next === "authorized") return "tasks:approve";
  return "tasks:write";
}

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
  actor: PilotActor,
): PilotEvaluation {
  const current = PilotEvaluationSchema.parse(evaluation);
  const decision = authorizeTeamAction({
    membership: actor.membership,
    requestedOrganizationId: current.organizationId,
    action: actionForTransition(next),
  });
  if (!decision.allowed)
    throw new Error(`pilot transition denied: ${decision.reason}`);
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
