import { mkdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../config";
import { discoverRepository, runGit } from "./git";
import {
  acquireWorkspaceLock,
  releaseWorkspaceLock,
  type WorkspaceLock,
} from "./lock";
import {
  listWorkspaces,
  loadWorkspace,
  removeWorkspaceRecord,
  saveWorkspace,
} from "./store";
import {
  WorkspaceSchema,
  type Workspace,
  type WorkspaceDiff,
  type WorkspaceExecutionContext,
} from "./types";

const transitions: Record<Workspace["status"], Workspace["status"][]> = {
  CREATING: ["READY", "FAILED", "RECOVERY_REQUIRED"],
  READY: [
    "QUEUED",
    "RUNNING",
    "SUSPENDED",
    "INTEGRATING",
    "REMOVAL_PENDING",
    "FAILED",
    "CONFLICTED",
  ],
  QUEUED: ["RUNNING", "SUSPENDED", "FAILED"],
  RUNNING: [
    "WAITING_FOR_APPROVAL",
    "VERIFYING",
    "COMPLETED",
    "FAILED",
    "SUSPENDED",
    "RECOVERY_REQUIRED",
  ],
  WAITING_FOR_APPROVAL: ["RUNNING", "FAILED", "SUSPENDED"],
  VERIFYING: ["COMPLETED", "FAILED", "SUSPENDED", "RECOVERY_REQUIRED"],
  COMPLETED: ["INTEGRATING", "REMOVAL_PENDING", "SUSPENDED"],
  FAILED: ["RECOVERY_REQUIRED", "SUSPENDED", "REMOVAL_PENDING"],
  SUSPENDED: [
    "READY",
    "QUEUED",
    "RUNNING",
    "REMOVAL_PENDING",
    "RECOVERY_REQUIRED",
  ],
  INTEGRATING: ["INTEGRATED", "CONFLICTED", "FAILED", "RECOVERY_REQUIRED"],
  INTEGRATED: ["REMOVAL_PENDING"],
  CONFLICTED: ["SUSPENDED", "INTEGRATING", "REMOVAL_PENDING"],
  RECOVERY_REQUIRED: ["READY", "SUSPENDED", "REMOVAL_PENDING", "FAILED"],
  REMOVAL_PENDING: ["REMOVED", "SUSPENDED"],
  REMOVED: [],
};

function safeName(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, fortyEight()) || "task";
}
function fortyEight() {
  return 48;
}

export class WorkspaceManager {
  constructor(
    private readonly options: {
      repositoryRoot?: string;
      workspaceDirectory?: string;
      lockDirectory?: string;
    } = {},
  ) {}

  async create(input: {
    taskId: string;
    sessionId: string;
    base?: string;
    detached?: boolean;
  }): Promise<Workspace> {
    const repository = await discoverRepository(this.options.repositoryRoot);
    if (!repository.isRepository || !repository.head)
      throw new Error(
        "workspace creation requires a Git repository with an initial commit",
      );
    const workspaceId = randomUUID();
    const directory = this.options.workspaceDirectory ?? PATHS.workspacesDir;
    const path = join(directory, workspaceId);
    const branch = input.detached
      ? null
      : `chiku/${safeName(input.taskId)}-${workspaceId.slice(0, 8)}`;
    const base = input.base ?? repository.head;
    const lock = await acquireWorkspaceLock(
      repository.identity,
      this.options.lockDirectory,
    );
    const now = new Date().toISOString();
    const record: Workspace = {
      workspaceId,
      repositoryIdentity: repository.identity,
      taskId: input.taskId,
      sessionId: input.sessionId,
      worktreePath: path,
      branch,
      detached: Boolean(input.detached),
      baseCommit: base,
      currentHead: null,
      status: "CREATING",
      createdAt: now,
      lastActivityAt: now,
      contractIds: [],
      verification: [],
      approval: "not_requested",
    };
    try {
      await mkdir(directory, { recursive: true });
      await stat(path)
        .then(() => {
          throw new Error(`workspace path already exists: ${path}`);
        })
        .catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
      const args = input.detached
        ? ["worktree", "add", "--detach", path, base]
        : ["worktree", "add", "-b", branch!, path, base];
      await runGit(repository.root, args);
      const actualRoot = await realpath(path);
      const actualHead = await runGit(actualRoot, ["rev-parse", "HEAD"]);
      if (actualHead !== base && input.detached)
        throw new Error("created worktree HEAD does not match requested base");
      record.worktreePath = actualRoot;
      record.currentHead = actualHead;
      record.status = "READY";
      await saveWorkspace(record, directory);
      return record;
    } catch (error) {
      record.status = "FAILED";
      await saveWorkspace(record, directory).catch(() => undefined);
      throw error;
    } finally {
      await releaseWorkspaceLock(lock).catch(() => undefined);
    }
  }

  async get(id: string) {
    return loadWorkspace(id, this.options.workspaceDirectory);
  }
  async list() {
    return listWorkspaces(this.options.workspaceDirectory);
  }

  async transition(id: string, next: Workspace["status"]): Promise<Workspace> {
    const workspace = await this.require(id);
    if (!transitions[workspace.status].includes(next))
      throw new Error(
        `illegal workspace transition ${workspace.status} -> ${next}`,
      );
    const updated = WorkspaceSchema.parse({
      ...workspace,
      status: next,
      lastActivityAt: new Date().toISOString(),
    });
    await saveWorkspace(updated, this.options.workspaceDirectory);
    return updated;
  }

  async require(id: string): Promise<Workspace> {
    const workspace = await this.get(id);
    if (!workspace) throw new Error(`workspace not found: ${id}`);
    return workspace;
  }

  async executionContext(
    id: string,
    signal: AbortSignal,
  ): Promise<WorkspaceExecutionContext> {
    const workspace = await this.require(id);
    const root = await realpath(workspace.worktreePath).catch(() => {
      throw new Error("workspace worktree no longer exists");
    });
    if (root !== workspace.worktreePath)
      throw new Error("workspace identity changed");
    return {
      workspaceId: workspace.workspaceId,
      repositoryIdentity: workspace.repositoryIdentity,
      authorizedRoot: root,
      cwd: root,
      sessionId: workspace.sessionId,
      taskId: workspace.taskId,
      signal,
      executionLimits: {},
      contractIds: workspace.contractIds,
    };
  }

  async diff(id: string): Promise<WorkspaceDiff> {
    const workspace = await this.require(id);
    const status = await runGit(workspace.worktreePath, [
      "status",
      "--short",
      "--untracked-files=all",
      "--",
      ".",
      ":!.chiku",
    ]);
    const diff = await runGit(workspace.worktreePath, [
      "diff",
      "--binary",
      workspace.baseCommit,
    ]);
    const statusLines = status ? status.split("\n") : [];
    const pathFromStatus = (line: string) =>
      line.startsWith("?? ") ? line.slice(3) : line.slice(2).trimStart();
    const changedFiles = statusLines
      .filter((line) => !line.startsWith("?? "))
      .map(pathFromStatus);
    const untrackedFiles = statusLines
      .filter((line) => line.startsWith("?? "))
      .map(pathFromStatus);
    return {
      workspaceId: id,
      status,
      diff,
      changedFiles,
      untrackedFiles,
      additions: (diff.match(/^\+(?!\+\+)/gm) ?? []).length,
      deletions: (diff.match(/^-(?!-{2})/gm) ?? []).length,
    };
  }

  async reconcile(): Promise<Workspace[]> {
    const workspaces = await this.list();
    const reconciled: Workspace[] = [];
    for (const workspace of workspaces) {
      if (workspace.status === "REMOVED") {
        reconciled.push(workspace);
        continue;
      }
      const actualRoot = await realpath(workspace.worktreePath).catch(
        () => undefined,
      );
      let updated = workspace;
      if (!actualRoot) {
        updated = { ...workspace, status: "RECOVERY_REQUIRED" };
      } else {
        const repository = await discoverRepository(actualRoot).catch(
          () => undefined,
        );
        if (
          !repository?.isRepository ||
          repository.identity !== workspace.repositoryIdentity
        ) {
          updated = { ...workspace, status: "RECOVERY_REQUIRED" };
        } else if (
          repository.head &&
          repository.head !== workspace.currentHead
        ) {
          updated = { ...workspace, currentHead: repository.head };
        }
      }
      if (updated !== workspace) {
        updated = WorkspaceSchema.parse({
          ...updated,
          lastActivityAt: new Date().toISOString(),
        });
        await saveWorkspace(updated, this.options.workspaceDirectory);
      }
      reconciled.push(updated);
    }
    return reconciled;
  }

  async requestRemoval(id: string) {
    return this.transition(id, "REMOVAL_PENDING");
  }

  async remove(id: string, approved = false): Promise<void> {
    if (!approved)
      throw new Error("workspace removal requires explicit approval");
    const workspace = await this.require(id);
    if (workspace.status !== "REMOVAL_PENDING")
      throw new Error("workspace must be marked removal pending first");
    const repository = await discoverRepository(workspace.worktreePath);
    const status = await runGit(workspace.worktreePath, [
      "status",
      "--short",
      "--untracked-files=all",
      "--",
      ".",
      ":!.chiku",
    ]);
    if (status)
      throw new Error(
        "workspace is dirty; review or clean changes before removal",
      );
    const lock = await acquireWorkspaceLock(
      workspace.repositoryIdentity,
      this.options.lockDirectory,
    );
    try {
      await runGit(repository.root, [
        "worktree",
        "remove",
        workspace.worktreePath,
      ]);
      const removed = {
        ...workspace,
        status: "REMOVED" as const,
        lastActivityAt: new Date().toISOString(),
      };
      await saveWorkspace(removed, this.options.workspaceDirectory);
    } finally {
      await releaseWorkspaceLock(lock).catch(() => undefined);
    }
  }
}
