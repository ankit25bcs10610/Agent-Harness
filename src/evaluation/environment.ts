import { platform, release, tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { WorkspaceManager } from "../workspace/manager";
import { discoverRepository, runGit } from "../workspace/git";
import { ProcessExecutor } from "../process/executor";
import { join } from "node:path";
import type { EvaluationTask } from "./types";

export type EvaluationEnvironment = {
  root: string;
  workspaceId?: string;
  baseCommit?: string;
  metadata: Record<string, string>;
  cleanup?: () => Promise<void>;
};

export class EvaluationEnvironmentManager {
  constructor(
    private readonly workspaces: WorkspaceManager,
    private readonly process = new ProcessExecutor(),
  ) {}

  async prepare(
    task: EvaluationTask,
    evaluationId: string,
    signal: AbortSignal,
  ): Promise<EvaluationEnvironment> {
    if (task.securityConstraints.requiresIsolation)
      throw new Error(
        "evaluation blocked: task requires an unavailable OS isolation backend",
      );
    const repository = await discoverRepository(task.repositoryFixture);
    if (!repository.isRepository)
      throw new Error("evaluation fixture is not a Git repository");
    if (task.baseCommit && task.baseCommit !== repository.head)
      throw new Error(
        `fixture base commit mismatch: expected ${task.baseCommit}, got ${repository.head ?? "unknown"}`,
      );
    if (task.allowedWorkspaces === "none") {
      return {
        root: repository.root,
        ...(task.baseCommit ? { baseCommit: task.baseCommit } : {}),
        metadata: {
          os: platform(),
          runtime: release(),
          git: repository.head ?? "unknown",
        },
      };
    }
    // Keep disposable evaluation worktrees outside the fixture. This prevents
    // the evaluated agent from seeing or modifying fixture-local evaluation
    // metadata and avoids treating that metadata as task output.
    const temporaryRoot = await mkdtemp(join(tmpdir(), "chiku-evaluation-"));
    const manager = new WorkspaceManager({
      repositoryRoot: task.repositoryFixture,
      workspaceDirectory: join(temporaryRoot, "workspaces"),
    });
    let workspace: Awaited<ReturnType<WorkspaceManager["create"]>> | undefined;
    const cleanup = async () => {
      if (workspace)
        await runGit(task.repositoryFixture, [
          "worktree",
          "remove",
          "--force",
          workspace.worktreePath,
        ]).catch(() => undefined);
      await rm(temporaryRoot, { recursive: true, force: true });
    };
    try {
      workspace = await manager.create({
        taskId: `evaluation-${evaluationId}`,
        sessionId: `evaluation-${evaluationId}`,
        ...(task.baseCommit ? { base: task.baseCommit } : {}),
      });
      for (const command of task.setupRequirements) {
        const result = await this.process.run(
          {
            command,
            cwd: workspace.worktreePath,
            workspaceRoot: workspace.worktreePath,
            timeoutMs: task.timeoutMs,
            maxOutputChars: 20_000,
          },
          signal,
        );
        if (result.failure || result.exitCode !== 0)
          throw new Error(`evaluation setup failed: ${command}`);
      }
    } catch (error) {
      await cleanup();
      throw error;
    }
    return {
      root: workspace.worktreePath,
      workspaceId: workspace.workspaceId,
      baseCommit: workspace.baseCommit,
      metadata: {
        os: platform(),
        runtime: release(),
        git: workspace.currentHead ?? "unknown",
      },
      cleanup,
    };
  }
}
