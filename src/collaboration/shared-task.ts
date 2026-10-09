import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  authorizeTeamAction,
  TeamMembershipSchema,
  type TeamAction,
  type TeamMembership,
} from "../team/authz";

export const CollaborationActorSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["human", "agent"]),
  membership: TeamMembershipSchema.optional(),
});
export type CollaborationActor = z.infer<typeof CollaborationActorSchema>;

export const SharedTaskStatusSchema = z.enum([
  "open",
  "assigned",
  "in_progress",
  "review",
  "verified",
  "blocked",
  "cancelled",
]);
export type SharedTaskStatus = z.infer<typeof SharedTaskStatusSchema>;

export const SharedTaskSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().min(1),
  title: z.string().min(1).max(240),
  description: z.string().min(1).max(20_000),
  repositoryId: z.string().min(1),
  baseRevision: z.string().min(1),
  status: SharedTaskStatusSchema,
  createdBy: z.string().min(1),
  assigneeId: z.string().min(1).nullable(),
  assigneeKind: z.enum(["human", "agent"]).nullable(),
  version: z.number().int().positive(),
  updatedAt: z.string().datetime({ offset: true }),
});
export type SharedTask = z.infer<typeof SharedTaskSchema>;

export const CollaborationEventSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().min(1),
  taskId: z.string().uuid(),
  version: z.number().int().positive(),
  type: z.enum([
    "created",
    "updated",
    "assigned",
    "status_changed",
    "approved",
  ]),
  actorId: z.string().min(1),
  actorKind: z.enum(["human", "agent"]),
  timestamp: z.string().datetime({ offset: true }),
});
export type CollaborationEvent = z.infer<typeof CollaborationEventSchema>;

type TaskPatch = {
  title?: string;
  description?: string;
  status?: SharedTaskStatus;
  baseRevision?: string;
};

function requireAction(
  actor: CollaborationActor,
  organizationId: string,
  action: TeamAction,
) {
  if (actor.kind !== "human" || !actor.membership) {
    throw new Error(
      `collaboration action ${action} requires an authenticated human member`,
    );
  }
  const decision = authorizeTeamAction({
    membership: actor.membership,
    requestedOrganizationId: organizationId,
    action,
  });
  if (!decision.allowed)
    throw new Error(`collaboration action denied: ${decision.reason}`);
}

/**
 * Local, tenant-scoped collaboration store. It deliberately does not imply a
 * hosted backend: callers must provide an authenticated membership for every
 * human operation and an explicit expected version for mutations.
 */
export class SharedTaskStore {
  private readonly tasks = new Map<string, SharedTask>();
  private readonly events = new Map<string, CollaborationEvent>();
  private readonly seenEventIds = new Set<string>();

  create(input: {
    organizationId: string;
    title: string;
    description: string;
    repositoryId: string;
    baseRevision: string;
    actor: CollaborationActor;
  }): SharedTask {
    requireAction(input.actor, input.organizationId, "tasks:write");
    const now = new Date().toISOString();
    const task = SharedTaskSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      title: input.title,
      description: input.description,
      repositoryId: input.repositoryId,
      baseRevision: input.baseRevision,
      status: "open",
      createdBy: input.actor.id,
      assigneeId: null,
      assigneeKind: null,
      version: 1,
      updatedAt: now,
    });
    this.tasks.set(task.id, task);
    this.record(task, "created", input.actor);
    return task;
  }

  get(taskId: string, actor: CollaborationActor): SharedTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("shared task not found");
    requireAction(actor, task.organizationId, "tasks:read");
    return task;
  }

  update(
    taskId: string,
    actor: CollaborationActor,
    expectedVersion: number,
    patch: TaskPatch,
  ): SharedTask {
    const current = this.get(taskId, actor);
    requireAction(actor, current.organizationId, "tasks:write");
    this.requireVersion(current, expectedVersion);
    const next = SharedTaskSchema.parse({
      ...current,
      ...patch,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    });
    this.tasks.set(taskId, next);
    this.record(next, patch.status ? "status_changed" : "updated", actor);
    return next;
  }

  assign(
    taskId: string,
    actor: CollaborationActor,
    expectedVersion: number,
    assignee: { id: string; kind: "human" | "agent" },
  ): SharedTask {
    const current = this.get(taskId, actor);
    requireAction(actor, current.organizationId, "tasks:assign");
    this.requireVersion(current, expectedVersion);
    const next = SharedTaskSchema.parse({
      ...current,
      assigneeId: assignee.id,
      assigneeKind: assignee.kind,
      status: "assigned",
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    });
    this.tasks.set(taskId, next);
    this.record(next, "assigned", actor);
    return next;
  }

  approve(taskId: string, actor: CollaborationActor, expectedVersion: number) {
    const current = this.get(taskId, actor);
    requireAction(actor, current.organizationId, "tasks:approve");
    this.requireVersion(current, expectedVersion);
    const next = SharedTaskSchema.parse({
      ...current,
      status: "verified",
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    });
    this.tasks.set(taskId, next);
    this.record(next, "approved", actor);
    return next;
  }

  listEvents(taskId: string, actor: CollaborationActor) {
    const task = this.get(taskId, actor);
    return [...this.events.values()].filter(
      (event) =>
        event.taskId === task.id &&
        event.organizationId === task.organizationId,
    );
  }

  private requireVersion(task: SharedTask, expectedVersion: number) {
    if (!Number.isInteger(expectedVersion) || expectedVersion !== task.version)
      throw new Error(
        `stale shared task version: expected ${expectedVersion}, current ${task.version}`,
      );
  }

  private record(
    task: SharedTask,
    type: CollaborationEvent["type"],
    actor: CollaborationActor,
  ) {
    const event = CollaborationEventSchema.parse({
      id: randomUUID(),
      organizationId: task.organizationId,
      taskId: task.id,
      version: task.version,
      type,
      actorId: actor.id,
      actorKind: actor.kind,
      timestamp: new Date().toISOString(),
    });
    if (this.seenEventIds.has(event.id)) return;
    this.seenEventIds.add(event.id);
    this.events.set(event.id, event);
  }
}
