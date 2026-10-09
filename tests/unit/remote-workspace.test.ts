import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildSnapshotManifest,
  RemoteWorkspaceManager,
  redactTransferPath,
  snapshotDigest,
} from "../../src/remote";

const quota = {
  cpuMillis: 1000,
  memoryBytes: 64 * 1024 * 1024,
  diskBytes: 512 * 1024 * 1024,
  processCount: 32,
  wallClockMs: 60_000,
  allowNetwork: false,
};

test("requires consent and isolates workspace ownership", async () => {
  const manager = new RemoteWorkspaceManager();
  await expect(
    manager.request({
      organizationId: "org-a",
      ownerId: "user-a",
      repositoryIdentity: "repo",
      sourceRevision: "abc",
      runtimeImage: "local-fixture",
      quota,
      sourceTransferConsent: false,
      ttlMs: 1000,
    }),
  ).rejects.toThrow("consent");
  const workspace = await manager.request({
    organizationId: "org-a",
    ownerId: "user-a",
    repositoryIdentity: "repo",
    sourceRevision: "abc",
    runtimeImage: "local-fixture",
    quota,
    sourceTransferConsent: true,
    ttlMs: 1000,
  });
  await expect(
    manager.transition(workspace.workspaceId, "PROVISIONING", {
      organizationId: "org-b",
      userId: "user-b",
    }),
  ).rejects.toThrow("access denied");
});

test("persists lifecycle state atomically and enforces transitions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chiku-remote-"));
  const manager = new RemoteWorkspaceManager(directory);
  const workspace = await manager.request({
    organizationId: "org",
    ownerId: "user",
    repositoryIdentity: "repo",
    sourceRevision: "abc",
    runtimeImage: "local-fixture",
    quota,
    sourceTransferConsent: true,
    ttlMs: 1000,
  });
  await manager.transition(workspace.workspaceId, "PROVISIONING", {
    organizationId: "org",
    userId: "user",
  });
  await manager.transition(workspace.workspaceId, "READY", {
    organizationId: "org",
    userId: "user",
  });
  await expect(
    manager.transition(workspace.workspaceId, "STOPPED", {
      organizationId: "org",
      userId: "user",
    }),
  ).rejects.toThrow("illegal");
});

test("lease acquisition is idempotent and expiry marks side effects uncertain", async () => {
  const manager = new RemoteWorkspaceManager();
  const workspace = await manager.request({
    organizationId: "org",
    ownerId: "user",
    repositoryIdentity: "repo",
    sourceRevision: "abc",
    runtimeImage: "local-fixture",
    quota,
    sourceTransferConsent: true,
    ttlMs: 1000,
  });
  const first = await manager.acquireLease({
    workspaceId: workspace.workspaceId,
    taskId: "task-1",
    workerId: "worker",
    organizationId: "org",
    userId: "user",
    ttlMs: 10,
  });
  const duplicate = await manager.acquireLease({
    workspaceId: workspace.workspaceId,
    taskId: "task-1",
    workerId: "worker-2",
    organizationId: "org",
    userId: "user",
    ttlMs: 10,
  });
  expect(first.duplicate).toBe(false);
  expect(duplicate.duplicate).toBe(true);
  expect(await manager.expire(new Date(Date.now() + 1000))).toEqual(["task-1"]);
  expect(manager.get(workspace.workspaceId)?.state).toBe("EXPIRED");
});

test("sensitive transfer paths are identified and snapshot digests are deterministic", () => {
  expect(redactTransferPath(".env")).toBe(true);
  expect(redactTransferPath("src/app.ts")).toBe(false);
  const files = [
    { path: "b", sha256: "2", bytes: 1 },
    { path: "a", sha256: "1", bytes: 1 },
  ];
  expect(snapshotDigest(files)).toBe(snapshotDigest([...files].reverse()));
});

test("builds a bounded consented manifest without transferring sensitive files", async () => {
  const root = await mkdtemp(join(tmpdir(), "chiku-snapshot-"));
  await Bun.write(join(root, "src.ts"), "source\n");
  await Bun.write(join(root, ".env"), "TOKEN=synthetic\n");
  const snapshot = await buildSnapshotManifest(
    root,
    { consent: true, include: ["."], exclude: [], maxBytes: 1000 },
    "workspace",
    "revision",
  );
  expect(snapshot.files.map((file) => file.path)).toEqual(["src.ts"]);
  expect(snapshot.totalBytes).toBe(7);
  await expect(
    buildSnapshotManifest(
      root,
      { consent: false, include: ["."], exclude: [], maxBytes: 1000 },
      "workspace",
      "revision",
    ),
  ).rejects.toThrow("consent");
});
