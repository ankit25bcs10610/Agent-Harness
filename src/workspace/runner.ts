import { runLoop } from "../loop/loop";
import type { LoopInput, LoopOutput } from "../loop/types";
import { WorkspaceManager } from "./manager";
import { TaskScheduler } from "./scheduler";

export class WorkspaceTaskRunner {
  constructor(
    private readonly manager: WorkspaceManager,
    private readonly scheduler: TaskScheduler,
  ) {}

  queue(workspaceId: string, input: LoopInput): Promise<LoopOutput> {
    return this.manager.transition(workspaceId, "QUEUED").then(() =>
      this.scheduler.submit({
        taskId: workspaceId,
        run: (signal) => this.execute(workspaceId, input, signal),
      }),
    );
  }

  cancel(workspaceId: string) {
    this.scheduler.cancel(workspaceId);
  }

  private async execute(
    workspaceId: string,
    input: LoopInput,
    signal: AbortSignal,
  ): Promise<LoopOutput> {
    await this.manager.transition(workspaceId, "RUNNING");
    const context = await this.manager.executionContext(workspaceId, signal);
    const permissions = {
      ...input.ctx.permissions,
      projectRoot: context.authorizedRoot,
    };
    try {
      const output = await runLoop({
        ...input,
        ctx: { ...input.ctx, permissions, signal, workspace: context },
      });
      await this.manager.transition(
        workspaceId,
        output.stopReason === "stop" ? "COMPLETED" : "FAILED",
      );
      return output;
    } catch (error) {
      await this.manager
        .transition(workspaceId, "FAILED")
        .catch(() => undefined);
      throw error;
    }
  }
}
