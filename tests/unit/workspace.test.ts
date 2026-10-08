import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  WorkspaceManager,
  acquireWorkspaceLock,
  discoverRepository,
  releaseWorkspaceLock,
  TaskScheduler,
  WorkspaceTaskRunner,
  detectEnvironment,
  inspectIntegration,
  integrateWorkspace,
} from "../../src/workspace";
import { detectAgentConflicts } from "../../src/multiagent";
import { runTool } from "../../src/tool/registry";
import type { ToolContext } from "../../src/tool/types";

let root = "";
function portablePath(value: string) {
  return value
    .replaceAll("\\", "/")
    .replace(/^\/(\w)\//, "$1:/")
    .toLowerCase();
}
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function git(args: string[]) {
  const process = Bun.spawn(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  if (code !== 0) throw new Error(stderr);
}

async function repository() {
  root = await mkdtemp(join(tmpdir(), "chiku-workspace-"));
  await writeFile(join(root, "README.md"), "base\n");
  await git(["init"]);
  await git(["config", "user.email", "test@example.invalid"]);
  await git(["config", "user.name", "Test"]);
  await git(["add", "."]);
  await git(["commit", "-m", "initial"]);
}

test("discovers repository metadata without changing Git state", async () => {
  await repository();
  const metadata = await discoverRepository(root);
  expect(metadata.isRepository).toBe(true);
  expect(metadata.root.replaceAll("\\", "/")).toBe(
    (await realpath(root)).replaceAll("\\", "/"),
  );
  expect(metadata.dirty).toBe(false);
  expect(metadata.head).toHaveLength(40);
  expect(metadata.worktrees.length).toBeGreaterThanOrEqual(1);
});

test("detects a bare Git repository without treating it as a normal checkout", async () => {
  root = await mkdtemp(join(tmpdir(), "chiku-bare-"));
  await git(["init", "--bare"]);
  const metadata = await discoverRepository(root);
  expect(metadata.isRepository).toBe(true);
  expect(metadata.root).toBe(await realpath(root));
  expect(metadata.branch).toBe("HEAD (bare)");
  expect(metadata.dirty).toBe(false);
});

test("creates an isolated real worktree and rejects illegal transitions", async () => {
  await repository();
  const directory = join(root, ".chiku", "workspaces");
  const manager = new WorkspaceManager({
    repositoryRoot: root,
    workspaceDirectory: directory,
  });
  const workspace = await manager.create({
    taskId: "Fix auth",
    sessionId: "session-1",
  });
  expect(workspace.status).toBe("READY");
  expect(workspace.branch).toContain("chiku/fix-auth-");
  expect(
    (
      await readFile(join(workspace.worktreePath, "README.md"), "utf8")
    ).replaceAll("\r\n", "\n"),
  ).toBe("base\n");
  await expect(
    manager.transition(workspace.workspaceId, "INTEGRATED"),
  ).rejects.toThrow("illegal workspace transition");
  const context = await manager.executionContext(
    workspace.workspaceId,
    new AbortController().signal,
  );
  expect(context.authorizedRoot).toBe(workspace.worktreePath);
});

test("locks are exclusive and scheduler respects concurrency and cancellation", async () => {
  root = await mkdtemp(join(tmpdir(), "chiku-locks-"));
  const first = await acquireWorkspaceLock("repository", root);
  await expect(acquireWorkspaceLock("repository", root)).rejects.toThrow(
    "already held",
  );
  await releaseWorkspaceLock(first);

  const scheduler = new TaskScheduler(1);
  let running = 0;
  let peak = 0;
  const wait = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("cancelled"));
        },
        { once: true },
      );
    });
  void scheduler.submit({
    taskId: "a",
    run: async (signal) => {
      peak = Math.max(peak, ++running);
      await wait(20, signal);
      running--;
    },
  });
  void scheduler.submit({
    taskId: "b",
    run: async (signal) => {
      peak = Math.max(peak, ++running);
      await wait(5, signal);
      running--;
    },
  });
  const cancelled = scheduler.submit({
    taskId: "cancelled",
    run: async (signal) => {
      await wait(100, signal);
    },
  });
  void cancelled.catch(() => undefined);
  scheduler.cancel("cancelled");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(peak).toBe(1);
  expect(
    scheduler.snapshot().every((item) => item.status === "completed"),
  ).toBe(false);
  expect(
    scheduler.snapshot().find((item) => item.taskId === "cancelled")?.status,
  ).toBe("cancelled");
});

test("workspace execution context prevents cross-workspace tool access", async () => {
  await repository();
  const directory = join(root, ".chiku", "workspaces");
  const manager = new WorkspaceManager({
    repositoryRoot: root,
    workspaceDirectory: directory,
  });
  const first = await manager.create({
    taskId: "first",
    sessionId: "session-1",
  });
  const second = await manager.create({
    taskId: "second",
    sessionId: "session-2",
  });
  await writeFile(join(second.worktreePath, "private.txt"), "second\n");
  const controller = new AbortController();
  const workspace = await manager.executionContext(
    first.workspaceId,
    controller.signal,
  );
  const context: ToolContext = {
    permissions: {
      projectRoot: workspace.authorizedRoot,
      grants: [],
      audit: [],
    },
    asker: async () => "allow-once",
    signal: controller.signal,
    maxOutputChars: 1000,
    workspace,
  };
  const denied = await runTool(
    "read_file",
    JSON.stringify({ path: join(second.worktreePath, "private.txt") }),
    context,
  );
  expect(denied).toContain("Not allowed");
  const output = await runTool(
    "bash",
    JSON.stringify({ command: "pwd" }),
    context,
  );
  expect(portablePath(output)).toContain(portablePath(first.worktreePath));
});

test("reviews and integrates an exact clean workspace diff without overwriting the target", async () => {
  await repository();
  const directory = join(root, ".chiku", "workspaces");
  const manager = new WorkspaceManager({
    repositoryRoot: root,
    workspaceDirectory: directory,
  });
  const workspace = await manager.create({
    taskId: "integrate",
    sessionId: "session-1",
  });
  await writeFile(join(workspace.worktreePath, "README.md"), "integrated\n");
  const inspection = await inspectIntegration(
    manager,
    workspace.workspaceId,
    root,
  );
  expect(inspection.conflict).toBeUndefined();
  expect(inspection.changedFiles).toEqual(["README.md"]);
  const result = await integrateWorkspace(
    manager,
    workspace.workspaceId,
    root,
    true,
  );
  expect(result.applied).toBe(true);
  expect(
    (await readFile(join(root, "README.md"), "utf8")).replaceAll("\r\n", "\n"),
  ).toBe("integrated\n");
  expect((await manager.require(workspace.workspaceId)).status).toBe(
    "INTEGRATED",
  );
});

test("reports dirty-target conflicts and detects lockfile-driven environment setup", async () => {
  await repository();
  await writeFile(join(root, "bun.lock"), "lock\n");
  const environment = await detectEnvironment(root);
  expect(environment.packageManager).toBe("bun");
  const directory = join(root, ".chiku", "workspaces");
  const manager = new WorkspaceManager({
    repositoryRoot: root,
    workspaceDirectory: directory,
  });
  const workspace = await manager.create({
    taskId: "conflict",
    sessionId: "session-1",
  });
  await writeFile(join(workspace.worktreePath, "README.md"), "workspace\n");
  await writeFile(join(root, "README.md"), "user-change\n");
  const inspection = await inspectIntegration(
    manager,
    workspace.workspaceId,
    root,
  );
  expect(inspection.conflict?.category).toBe("dirty_target");
  const result = await integrateWorkspace(
    manager,
    workspace.workspaceId,
    root,
    true,
  );
  expect(result.applied).toBe(false);
  expect((await manager.require(workspace.workspaceId)).status).toBe(
    "CONFLICTED",
  );
});

test("reconciles a missing worktree into recovery-required state", async () => {
  await repository();
  const manager = new WorkspaceManager({
    repositoryRoot: root,
    workspaceDirectory: join(root, ".chiku", "workspaces"),
  });
  const workspace = await manager.create({
    taskId: "recover",
    sessionId: "session-1",
  });
  await rm(workspace.worktreePath, { recursive: true, force: true });
  const [reconciled] = await manager.reconcile();
  expect(reconciled).toBeDefined();
  if (!reconciled) throw new Error("reconciliation returned no workspace");
  expect(reconciled.status).toBe("RECOVERY_REQUIRED");
  expect((await manager.require(workspace.workspaceId)).status).toBe(
    "RECOVERY_REQUIRED",
  );
});

test("runs a model turn inside the isolated workspace and records completion", async () => {
  await repository();
  const manager = new WorkspaceManager({
    repositoryRoot: root,
    workspaceDirectory: join(root, ".chiku", "workspaces"),
  });
  const workspace = await manager.create({
    taskId: "run",
    sessionId: "session-1",
  });
  const runner = new WorkspaceTaskRunner(manager, new TaskScheduler(1));
  const result = await runner.queue(workspace.workspaceId, {
    messages: [{ type: "user", content: "hello" }],
    systemPrompt: { type: "system", content: "test" },
    complete: async () => ({
      message: { type: "assistant", content: "done" },
      finishReason: "stop",
      stats: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }),
    config: {
      maxIterations: 2,
      maxTokens: 10,
      contextWindow: 1000,
      pruneRatio: 0.5,
      maxPruneAllowanceRatio: 0.1,
      compactionRatio: 0.9,
      compactionModel: "mock",
      loopModel: "mock",
      transcriptCapChars: 2000,
    },
    ctx: {
      permissions: { projectRoot: root, grants: [], audit: [] },
      asker: async () => "allow-once",
      signal: new AbortController().signal,
      maxOutputChars: 1000,
    },
  });
  expect(result.stopReason).toBe("stop");
  expect((await manager.require(workspace.workspaceId)).status).toBe(
    "COMPLETED",
  );
});

test("detects overlapping files between independent agent workspaces", async () => {
  await repository();
  const manager = new WorkspaceManager({
    repositoryRoot: root,
    workspaceDirectory: join(root, ".chiku", "workspaces"),
  });
  const first = await manager.create({ taskId: "one", sessionId: "session-1" });
  const second = await manager.create({
    taskId: "two",
    sessionId: "session-1",
  });
  await writeFile(join(first.worktreePath, "README.md"), "first\n");
  await writeFile(join(second.worktreePath, "README.md"), "second\n");
  const conflicts = await detectAgentConflicts(manager, [
    first.workspaceId,
    second.workspaceId,
  ]);
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0]?.files).toEqual(["README.md"]);
});
