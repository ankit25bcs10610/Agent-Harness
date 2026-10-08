import { WorkspaceManager } from "../workspace/manager";
import type { WorkspaceExecutionContext } from "../workspace/types";
import type { AgentTask } from "./types";

export type AgentWorkspaceAllocation = {
  workspaceId: string;
  context: WorkspaceExecutionContext;
};

export class AgentWorkspaceAllocator {
  constructor(private readonly manager: WorkspaceManager) {}

  async allocate(
    task: AgentTask,
    agentId: string,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<AgentWorkspaceAllocation | undefined> {
    if (!task.workspaceRequired) return undefined;
    const workspace = await this.manager.create({
      taskId: `${agentId}-${task.id}`,
      sessionId,
    });
    return {
      workspaceId: workspace.workspaceId,
      context: await this.manager.executionContext(
        workspace.workspaceId,
        signal,
      ),
    };
  }

  async requestRelease(workspaceId: string) {
    // Release is intentionally two-phase: dirty workspaces require review and
    // explicit approval in WorkspaceManager.remove().
    return this.manager.requestRemoval(workspaceId);
  }
}
