import { randomUUID } from "node:crypto";
import { AgentCommunicationBus } from "./bus";
import { TaskDecomposer } from "./decompose";
import { TaskGraph } from "./graph";
import { AgentRegistry } from "./registry";
import { AgentRuntime, type AgentLaunchInput } from "./runtime";
import {
  MultiAgentScheduler,
  type AgentInputFactory,
  type MultiAgentSchedulerOptions,
} from "./scheduler";
import { saveAgentSession } from "./store";
import type { AgentSessionState } from "./types";
import { ReviewRepairLoop, type ReviewRepairOptions } from "./review";

export class MultiAgentCoordinator {
  readonly registry: AgentRegistry;
  readonly runtime: AgentRuntime;
  readonly bus: AgentCommunicationBus;
  private graph?: TaskGraph;
  private sessionId?: string;
  private rootTaskId?: string;
  private readonly scheduler: MultiAgentScheduler;

  constructor(
    registry: AgentRegistry,
    options: MultiAgentSchedulerOptions,
    private readonly sessionDirectory?: string,
  ) {
    this.registry = registry;
    this.runtime = new AgentRuntime(registry);
    this.bus = new AgentCommunicationBus();
    this.scheduler = new MultiAgentScheduler(registry, this.runtime, options);
  }

  async plan(
    input: string,
    decomposer: TaskDecomposer,
    sessionId = randomUUID(),
  ) {
    const graph = await decomposer.decompose(
      input,
      new AbortController().signal,
    );
    const first = graph.list()[0];
    if (!first) throw new Error("decomposition produced no tasks");
    this.graph = graph;
    this.sessionId = sessionId;
    this.rootTaskId = first.id;
    await this.persist();
    return graph;
  }

  restore(state: AgentSessionState) {
    this.graph = new TaskGraph(
      state.tasks.map((task) =>
        task.status === "running"
          ? { ...task, status: "blocked" as const }
          : task,
      ),
    );
    this.sessionId = state.sessionId;
    this.rootTaskId = state.rootTaskId;
    this.bus.restore(state.messages);
    return this.graph;
  }

  async run(factory: AgentInputFactory, signal: AbortSignal) {
    if (!this.graph || !this.sessionId)
      throw new Error("coordinator has no planned graph");
    const graph = this.graph;
    const sessionId = this.sessionId;
    const wrappedFactory: AgentInputFactory = (task, agentId, taskSignal) => {
      void this.bus.publish({
        sourceAgent: "coordinator",
        destination: agentId,
        taskId: task.id,
        type: "TASK_ASSIGNED",
        payload: { objective: task.objective, role: task.role },
      });
      const input = factory(task, agentId, taskSignal);
      return input;
    };
    const result = await this.scheduler.run(
      graph,
      sessionId,
      wrappedFactory,
      signal,
    );
    await this.persist();
    return result;
  }

  cancel(taskId?: string) {
    this.scheduler.cancel(taskId);
  }

  async resume(taskId: string) {
    if (!this.graph) throw new Error("coordinator has no planned graph");
    const task = this.graph.get(taskId);
    if (
      task.status !== "blocked" &&
      task.status !== "cancelled" &&
      task.status !== "failed"
    )
      throw new Error(`task cannot be resumed from ${task.status}`);
    const resumed = this.graph.update(taskId, "pending");
    await this.persist();
    return resumed;
  }

  evidence(taskId: string) {
    return {
      task: this.graph?.get(taskId),
      executions: this.runtime
        .list()
        .filter((execution) => execution.taskId === taskId),
      messages: this.bus.list(taskId),
    };
  }

  async runWithReview(
    factory: AgentInputFactory,
    review: ReviewRepairOptions,
    signal: AbortSignal,
  ) {
    const graph = await this.run(factory, signal);
    const result = await new ReviewRepairLoop(review).run(signal);
    await this.persist();
    return { graph, review: result };
  }

  graphSnapshot() {
    return this.graph?.list() ?? [];
  }

  executionSnapshot() {
    return this.runtime.list();
  }

  schedulerSnapshot() {
    return this.scheduler.snapshot();
  }

  setParallelLimit(limit: number) {
    this.scheduler.setLimit(limit);
  }

  async persist() {
    if (!this.graph || !this.sessionId || !this.rootTaskId) return;
    const definitions = this.registry
      .list()
      .map(({ active: _active, ...definition }) => definition);
    const state: AgentSessionState = {
      version: 1,
      sessionId: this.sessionId,
      rootTaskId: this.rootTaskId,
      agents: definitions,
      tasks: this.graph.list(),
      executions: this.runtime.list(),
      messages: this.bus.list(),
      updatedAt: new Date().toISOString(),
    };
    await saveAgentSession(state, this.sessionDirectory);
  }
}
