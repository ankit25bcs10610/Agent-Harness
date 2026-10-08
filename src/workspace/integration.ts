import { realpath } from "node:fs/promises";
import { WorkspaceManager } from "./manager";
import { runGit } from "./git";
import type { ConflictReport, IntegrationResult } from "./types";

async function runGitWithInput(cwd: string, args: string[], input: string) {
  const child = Bun.spawn(["git", "-C", cwd, ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (child.stdin) {
    child.stdin.write(input.endsWith("\n") ? input : `${input}\n`);
    child.stdin.end();
  }
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

function statusPaths(status: string) {
  return status
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ""));
}

function untrackedPaths(status: string) {
  return status
    .split("\n")
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ""));
}

export async function inspectIntegration(
  manager: WorkspaceManager,
  workspaceId: string,
  targetRoot: string,
): Promise<{
  diff: string;
  changedFiles: string[];
  conflict?: ConflictReport;
}> {
  const workspace = await manager.require(workspaceId);
  const sourceRoot = await realpath(workspace.worktreePath);
  const target = await realpath(targetRoot);
  const targetHead = await runGit(target, ["rev-parse", "HEAD"]);
  if (targetHead !== workspace.baseCommit) {
    return {
      diff: "",
      changedFiles: [],
      conflict: {
        workspaceId,
        target,
        category: "stale_base",
        files: [],
        sourceBase: workspace.baseCommit,
        targetHead,
        details:
          "Integration target advanced since the workspace was created; rebase or review before applying changes.",
        options: ["cancel", "review", "resolve"],
      },
    };
  }
  const targetStatus = await runGit(target, [
    "status",
    "--short",
    "--untracked-files=all",
    "--",
    ".",
    ":!.chiku",
  ]);
  if (targetStatus) {
    return {
      diff: "",
      changedFiles: [],
      conflict: {
        workspaceId,
        target,
        category: "dirty_target",
        files: statusPaths(targetStatus),
        sourceBase: workspace.baseCommit,
        targetHead,
        details:
          "Integration target contains uncommitted or untracked changes.",
        options: ["cancel", "review", "resolve"],
      },
    };
  }
  const sourceStatus = await runGit(sourceRoot, [
    "status",
    "--short",
    "--untracked-files=all",
    "--",
    ".",
    ":!.chiku",
  ]);
  const untracked = untrackedPaths(sourceStatus);
  const diff = await runGit(sourceRoot, [
    "diff",
    "--binary",
    workspace.baseCommit,
  ]);
  const changedFiles = (
    await runGit(sourceRoot, ["diff", "--name-only", workspace.baseCommit])
  )
    .split("\n")
    .filter(Boolean);
  if (untracked.length) {
    return {
      diff,
      changedFiles,
      conflict: {
        workspaceId,
        target,
        category: "untracked",
        files: untracked,
        sourceBase: workspace.baseCommit,
        targetHead,
        details:
          "Untracked source files are not silently included in integration.",
        options: ["cancel", "review", "resolve"],
      },
    };
  }
  const check = await runGitWithInput(
    target,
    ["apply", "--check", "--binary", "-"],
    diff,
  );
  if (check.code !== 0) {
    return {
      diff,
      changedFiles,
      conflict: {
        workspaceId,
        target,
        category: "apply_check",
        files: changedFiles,
        sourceBase: workspace.baseCommit,
        targetHead,
        details:
          check.stderr.trim() || "Git rejected the patch during preflight.",
        options: ["cancel", "review", "resolve"],
      },
    };
  }
  return { diff, changedFiles };
}

export async function integrateWorkspace(
  manager: WorkspaceManager,
  workspaceId: string,
  targetRoot: string,
  approved: boolean,
): Promise<IntegrationResult> {
  if (!approved) throw new Error("integration requires explicit approval");
  const workspace = await manager.require(workspaceId);
  const inspection = await inspectIntegration(manager, workspaceId, targetRoot);
  if (inspection.conflict) {
    await manager.transition(workspaceId, "CONFLICTED");
    return {
      workspaceId,
      target: targetRoot,
      applied: false,
      changedFiles: inspection.changedFiles,
      conflict: inspection.conflict,
      verificationRequired: false,
    };
  }
  await manager.transition(workspaceId, "INTEGRATING");
  const target = await realpath(targetRoot);
  const applied = await runGitWithInput(
    target,
    ["apply", "--binary", "-"],
    inspection.diff,
  );
  if (applied.code !== 0) {
    await manager.transition(workspaceId, "RECOVERY_REQUIRED");
    throw new Error(
      applied.stderr.trim() || "integration failed after preflight",
    );
  }
  await manager.transition(workspaceId, "INTEGRATED");
  return {
    workspaceId,
    target,
    applied: true,
    changedFiles: inspection.changedFiles,
    verificationRequired: true,
  };
}
