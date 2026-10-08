import { AgentRegistry } from "./registry";
import { AgentRuntime, type AgentHandle } from "./runtime";
import { TaskGraph } from "./graph";
import type { AgentTask } from "./types";
import type { AgentWorkspaceAllocator } from "./workspace";

export type MultiAgentSchedulerOptions = {
  maxActiveAgents: number;
  perRoleLimit?: Partial<Record<AgentTask["role"], number>>;
  workspaceAllocator?: AgentWorkspaceAllocator;
};

export type AgentInputFactory = (
  task: AgentTask,
  agentId: string,
  signal: AbortSignal,
) =>
  | Omit<
      import("./runtime").AgentLaunchInput,
      "task" | "agentId" | "parentSignal"
    >
  | Promise<
      Omit<
        import("./runtime").AgentLaunchInput,
        "task" | "agentId" | "parentSignal"
      >
    >;

export class MultiAgentScheduler {
  private readonly active = new Map<
    string,
    { task: AgentTask; handle: AgentHandle }
  >();
  private stopped = false;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly runtime: AgentRuntime,
    private readonly options: MultiAgentSchedulerOptions,
  ) {
    if (
      !Number.isInteger(options.maxActiveAgents) ||
      options.maxActiveAgents < 1
    )
      throw new Error("maximum active agents must be at least one");
  }

  async run(
    graph: TaskGraph,
    sessionId: string,
    factory: AgentInputFactory,
    signal: AbortSignal,
  ) {
    const abort = () => this.cancelAll();
    signal.addEventListener("abort", abort, { once: true });
    try {
      while (!graph.isComplete() && !this.stopped) {
        await this.startReady(graph, sessionId, factory, signal);
        if (!this.active.size) {
          if (!graph.isComplete())
            throw new Error("task graph has no runnable tasks");
          break;
        }
        await Promise.race(
          [...this.active.values()].map(({ handle }) => handle.promise),
        );
        await this.collect(graph);
      }
      if (signal.aborted) throw new Error("multi-agent schedule cancelled");
      return graph;
    } finally {
      signal.removeEventListener("abort", abort);
      this.cancelAll(false);
    }
  }

  cancel(taskId?: string) {
    if (taskId) {
      const active = this.active.get(taskId);
      active?.handle.cancel();
      return;
    }
    this.cancelAll(true);
  }

  snapshot() {
    return [...this.active.values()].map(({ task, handle }) => ({
      taskId: task.id,
      executionId: handle.executionId,
      role: task.role,
    }));
  }

  setLimit(limit: number) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error("maximum active agents must be at least one");
    this.options.maxActiveAgents = limit;
  }

  private async startReady(
    graph: TaskGraph,
    sessionId: string,
    factory: AgentInputFactory,
    signal: AbortSignal,
  ) {
    const roleCounts = new Map<string, number>();
    for (const { task } of this.active.values())
      roleCounts.set(task.role, (roleCounts.get(task.role) ?? 0) + 1);
    for (const task of graph.ready()) {
      if (this.active.size >= this.options.maxActiveAgents) break;
      const roleLimit =
        this.options.perRoleLimit?.[task.role] ?? this.options.maxActiveAgents;
      if ((roleCounts.get(task.role) ?? 0) >= roleLimit) continue;
      const agent = this.registry.select(task);
      try {
        const allocation = await this.options.workspaceAllocator?.allocate(
          task,
          agent.id,
          sessionId,
          signal,
        );
        const input = await factory(task, agent.id, signal);
        const context = allocation
          ? {
              ...input.context,
              workspace: allocation.context,
              permissions: {
                ...input.context.permissions,
                projectRoot: allocation.context.authorizedRoot,
              },
            }
          : input.context;
        graph.attempt(task.id);
        const handle = this.runtime.launch({
          ...input,
          context,
          task,
          agentId: agent.id,
          parentSignal: signal,
          sessionId,
        });
        this.active.set(task.id, { task, handle });
        roleCounts.set(task.role, (roleCounts.get(task.role) ?? 0) + 1);
      } catch {
        graph.update(task.id, "failed");
      }
    }
  }

  private async collect(graph: TaskGraph) {
    for (const [taskId, item] of this.active) {
      const execution = this.runtime.get(item.handle.executionId);
      if (["created", "running", "suspended"].includes(execution.status))
        continue;
      if (
        execution.status === "completed" &&
        execution.result?.stopReason === "stop"
      )
        graph.update(taskId, "succeeded");
      else if (execution.status === "cancelled")
        graph.update(taskId, "cancelled");
      else graph.update(taskId, "failed");
      this.active.delete(taskId);
    }
  }

  private cancelAll(stop = true) {
    this.stopped = stop;
    for (const { handle } of this.active.values()) handle.cancel();
  }
}
