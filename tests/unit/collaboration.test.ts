import { expect, test } from "bun:test";
import { SharedTaskStore } from "../../src/collaboration";

const owner = {
  id: "human-1",
  kind: "human" as const,
  membership: {
    userId: "human-1",
    organizationId: "org-a",
    role: "OWNER" as const,
    active: true,
  },
};

test("shared tasks are tenant-scoped, versioned, and approval-gated", () => {
  const store = new SharedTaskStore();
  const task = store.create({
    organizationId: "org-a",
    title: "Add review",
    description: "Implement a reviewed change",
    repositoryId: "repo-a",
    baseRevision: "abc123",
    actor: owner,
  });
  expect(task.version).toBe(1);
  expect(() =>
    store.get(task.id, {
      ...owner,
      membership: { ...owner.membership, organizationId: "org-b" },
    }),
  ).toThrow("tenant_mismatch");
  const assigned = store.assign(task.id, owner, 1, {
    id: "agent-1",
    kind: "agent",
  });
  expect(assigned.assigneeKind).toBe("agent");
  expect(() =>
    store.approve(task.id, { id: "agent-1", kind: "agent" }, 2),
  ).toThrow("requires an authenticated human member");
  const verified = store.approve(task.id, owner, 2);
  expect(verified.status).toBe("verified");
  expect(store.listEvents(task.id, owner)).toHaveLength(3);
});

test("stale writers cannot overwrite a shared task", () => {
  const store = new SharedTaskStore();
  const task = store.create({
    organizationId: "org-a",
    title: "Concurrent task",
    description: "Detect stale edits",
    repositoryId: "repo-a",
    baseRevision: "abc123",
    actor: owner,
  });
  store.update(task.id, owner, 1, { status: "in_progress" });
  expect(() =>
    store.update(task.id, owner, 1, { title: "lost update" }),
  ).toThrow(/stale shared task version/);
});

test("agents cannot create or mutate shared tasks without a human grant", () => {
  const store = new SharedTaskStore();
  expect(() =>
    store.create({
      organizationId: "org-a",
      title: "Denied",
      description: "No anonymous task",
      repositoryId: "repo-a",
      baseRevision: "abc123",
      actor: { id: "agent-1", kind: "agent" },
    }),
  ).toThrow(/authenticated human member/);
});
