import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import {
  RemoteWorkspaceSchema,
  TaskLeaseSchema,
  type RemoteWorkspace,
  type ResourceQuota,
  type SnapshotFile,
  type SourceTransferPolicy,
  type TaskLease,
  type WorkspaceSnapshot,
} from "./types";

const transitions: Record<
  RemoteWorkspace["state"],
  readonly RemoteWorkspace["state"][]
> = {
  REQUESTED: ["PROVISIONING", "FAILED"],
  PROVISIONING: ["READY", "FAILED"],
  READY: ["RUNNING", "PAUSED", "STOPPING", "EXPIRED"],
  RUNNING: ["READY", "PAUSED", "FAILED", "STOPPING", "EXPIRED"],
  PAUSED: ["READY", "RUNNING", "STOPPING", "EXPIRED"],
  FAILED: ["PROVISIONING", "STOPPING", "EXPIRED"],
  STOPPING: ["STOPPED"],
  STOPPED: [],
  EXPIRED: [],
};

const sensitive =
  /(?:^|\/)(?:\.env(?:\.|$)|\.ssh(?:\/|$)|.*\.(?:pem|key|p12|pfx))|(?:token|password|secret|credential)/i;

export class RemoteWorkspaceManager {
  private readonly workspaces = new Map<string, RemoteWorkspace>();
  private readonly leases = new Map<string, TaskLease>();
  private readonly taskKeys = new Map<string, string>();

  constructor(private readonly directory?: string) {}

  async request(input: {
    organizationId: string;
    ownerId: string;
    repositoryIdentity: string;
    sourceRevision: string;
    runtimeImage: string;
    quota: ResourceQuota;
    sourceTransferConsent: boolean;
    ttlMs: number;
  }) {
    if (!input.organizationId || !input.ownerId)
      throw new Error("workspace identity is required");
    if (!input.sourceTransferConsent)
      throw new Error("remote source transfer requires explicit consent");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/.test(input.runtimeImage))
      throw new Error("runtime image identifier is invalid");
    if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1)
      throw new Error("workspace TTL must be positive");
    const now = new Date();
    const workspace = RemoteWorkspaceSchema.parse({
      version: 1,
      workspaceId: randomUUID(),
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      repositoryIdentity: input.repositoryIdentity,
      sourceRevision: input.sourceRevision,
      runtimeImage: input.runtimeImage,
      state: "REQUESTED",
      quota: input.quota,
      sourceTransferConsent: true,
      createdAt: now.toISOString(),
      lastActivityAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + input.ttlMs).toISOString(),
      activeLeaseId: null,
    });
    this.workspaces.set(workspace.workspaceId, workspace);
    await this.persist();
    return workspace;
  }

  async transition(
    workspaceId: string,
    state: RemoteWorkspace["state"],
    actor: { organizationId: string; userId: string },
  ) {
    const workspace = this.require(workspaceId);
    this.authorize(workspace, actor);
    if (!transitions[workspace.state].includes(state))
      throw new Error(
        `illegal remote workspace transition ${workspace.state} -> ${state}`,
      );
    const next = RemoteWorkspaceSchema.parse({
      ...workspace,
      state,
      lastActivityAt: new Date().toISOString(),
    });
    this.workspaces.set(workspaceId, next);
    await this.persist();
    return next;
  }

  async acquireLease(input: {
    workspaceId: string;
    taskId: string;
    workerId: string;
    organizationId: string;
    userId: string;
    ttlMs: number;
  }) {
    const workspace = this.require(input.workspaceId);
    this.authorize(workspace, {
      organizationId: input.organizationId,
      userId: input.userId,
    });
    if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1)
      throw new Error("lease TTL must be positive");
    const existingTask = this.taskKeys.get(input.taskId);
    if (existingTask) {
      const existing = this.leases.get(existingTask);
      if (existing && Date.parse(existing.expiresAt) > Date.now())
        return { lease: existing, duplicate: true };
      this.taskKeys.delete(input.taskId);
    }
    if (workspace.activeLeaseId) {
      const current = this.leases.get(workspace.activeLeaseId);
      if (current && Date.parse(current.expiresAt) > Date.now())
        throw new Error("workspace already has an active lease");
    }
    const lease = TaskLeaseSchema.parse({
      leaseId: randomUUID(),
      workspaceId: workspace.workspaceId,
      taskId: input.taskId,
      workerId: input.workerId,
      expiresAt: new Date(Date.now() + input.ttlMs).toISOString(),
      attempt: 1,
      sideEffectsUncertain: false,
    });
    this.leases.set(lease.leaseId, lease);
    this.taskKeys.set(lease.taskId, lease.leaseId);
    this.workspaces.set(
      workspace.workspaceId,
      RemoteWorkspaceSchema.parse({
        ...workspace,
        activeLeaseId: lease.leaseId,
        state: "RUNNING",
        lastActivityAt: new Date().toISOString(),
      }),
    );
    await this.persist();
    return { lease, duplicate: false };
  }

  async expire(now = new Date()) {
    const expired: string[] = [];
    for (const [id, lease] of this.leases)
      if (Date.parse(lease.expiresAt) <= now.getTime()) {
        this.leases.set(id, { ...lease, sideEffectsUncertain: true });
        const workspace = this.workspaces.get(lease.workspaceId);
        if (
          workspace &&
          workspace.state !== "STOPPED" &&
          workspace.state !== "EXPIRED"
        )
          this.workspaces.set(
            workspace.workspaceId,
            RemoteWorkspaceSchema.parse({
              ...workspace,
              state: "EXPIRED",
              activeLeaseId: null,
              lastActivityAt: now.toISOString(),
            }),
          );
        expired.push(lease.taskId);
      }
    if (expired.length) await this.persist();
    return expired;
  }

  get(workspaceId: string) {
    return this.workspaces.get(workspaceId);
  }
  list(organizationId: string, userId: string) {
    return [...this.workspaces.values()].filter(
      (workspace) =>
        workspace.organizationId === organizationId &&
        workspace.ownerId === userId,
    );
  }
  capability() {
    return {
      mode: "local-control-plane",
      remoteExecution: false,
      reason:
        "No authenticated remote runner or OS/container backend is configured",
    } as const;
  }

  private require(id: string) {
    const workspace = this.workspaces.get(id);
    if (!workspace) throw new Error("remote workspace not found");
    return workspace;
  }
  private authorize(
    workspace: RemoteWorkspace,
    actor: { organizationId: string; userId: string },
  ) {
    if (
      workspace.organizationId !== actor.organizationId ||
      workspace.ownerId !== actor.userId
    )
      throw new Error("remote workspace access denied");
  }
  private async persist() {
    if (!this.directory) return;
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, "remote-workspaces.json");
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify({
        workspaces: [...this.workspaces.values()],
        leases: [...this.leases.values()],
      }) + "\n",
      { mode: 0o600 },
    );
    await rename(temporary, path);
  }
}

export function redactTransferPath(path: string) {
  return sensitive.test(path);
}
export function snapshotDigest(
  files: readonly { path: string; sha256: string; bytes: number }[],
) {
  return createHash("sha256")
    .update(
      JSON.stringify([...files].sort((a, b) => a.path.localeCompare(b.path))),
    )
    .digest("hex");
}

export async function buildSnapshotManifest(
  root: string,
  policy: SourceTransferPolicy,
  workspaceId: string,
  sourceRevision: string,
): Promise<WorkspaceSnapshot> {
  if (!policy.consent)
    throw new Error("source snapshot requires explicit consent");
  if (!Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 1)
    throw new Error("snapshot byte limit must be positive");
  const files: SnapshotFile[] = [];
  let totalBytes = 0;
  const included = (path: string) =>
    policy.include.length === 0 ||
    policy.include.some(
      (prefix) =>
        prefix === "." || path === prefix || path.startsWith(`${prefix}/`),
    );
  const excluded = (path: string) =>
    policy.exclude.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).replaceAll("\\", "/");
      if (excluded(path) || redactTransferPath(path) || entry.isSymbolicLink())
        continue;
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile() || !included(path)) continue;
      const metadata = await lstat(absolute);
      if (totalBytes + metadata.size > policy.maxBytes)
        throw new Error("source snapshot exceeds configured byte limit");
      const content = await readFile(absolute);
      files.push({
        path,
        bytes: metadata.size,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
      totalBytes += metadata.size;
    }
  }
  await visit(root);
  return {
    workspaceId,
    sourceRevision,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    totalBytes,
    digest: snapshotDigest(files),
  };
}
