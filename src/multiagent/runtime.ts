import { randomUUID } from "node:crypto";
import { runLoop } from "../loop/loop";
import type { LoopInput, LoopOutput } from "../loop/types";
import { AgentRegistry } from "./registry";
import type {
  AgentDefinition,
  AgentExecution,
  AgentTask,
  AgentRuntimeContext,
} from "./types";

export type AgentLaunchInput = {
  task: AgentTask;
  agentId: string;
  sessionId: string;
  loop: LoopInput;
  context: AgentRuntimeContext;
  parentSignal?: AbortSignal;
};

export type AgentHandle = {
  executionId: string;
  promise: Promise<AgentExecution>;
  cancel: () => void;
};

export class AgentRuntime {
  private readonly executions = new Map<string, AgentExecution>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly registry: AgentRegistry) {}

  launch(input: AgentLaunchInput): AgentHandle {
    const definition = this.registry.get(input.agentId);
    this.validate(definition, input);
    const executionId = randomUUID();
    const controller = new AbortController();
    const abortParent = () => controller.abort();
    input.parentSignal?.addEventListener("abort", abortParent, { once: true });
    const execution: AgentExecution = {
      executionId,
      agentId: definition.id,
      role: definition.role,
      taskId: input.task.id,
      parentTaskId: input.task.parentTaskId,
      sessionId: input.sessionId,
      status: "created",
      startedAt: new Date().toISOString(),
      ...(input.context.workspace
        ? { workspaceId: input.context.workspace.workspaceId }
        : {}),
    };
    this.executions.set(executionId, execution);
    this.controllers.set(executionId, controller);
    const promise = this.execute(
      executionId,
      definition,
      input,
      controller.signal,
    ).finally(() => {
      input.parentSignal?.removeEventListener("abort", abortParent);
      this.controllers.delete(executionId);
    });
    return { executionId, promise, cancel: () => controller.abort() };
  }

  cancel(executionId: string) {
    this.controllers.get(executionId)?.abort();
  }

  get(executionId: string) {
    const execution = this.executions.get(executionId);
    if (!execution)
      throw new Error(`agent execution not found: ${executionId}`);
    return execution;
  }

  list() {
    return [...this.executions.values()];
  }

  private async execute(
    executionId: string,
    definition: AgentDefinition,
    input: AgentLaunchInput,
    signal: AbortSignal,
  ) {
    const current = this.get(executionId);
    const controller = this.controllers.get(executionId);
    current.status = "running";
    const toolCalls = { count: 0 };
    const loop: LoopInput = {
      ...input.loop,
      config: {
        ...input.loop.config,
        maxIterations: Math.min(
          input.loop.config.maxIterations,
          input.task.budget.maxIterations,
          definition.budget.maxIterations,
        ),
        maxTokens: Math.min(
          input.loop.config.maxTokens,
          input.task.budget.maxTokens,
          definition.budget.maxTokens,
        ),
        contextWindow: Math.min(
          input.loop.config.contextWindow,
          definition.model.contextWindow,
        ),
        wallClockMs: Math.min(
          input.loop.config.wallClockMs ?? Number.MAX_SAFE_INTEGER,
          input.task.budget.wallClockMs,
          definition.budget.wallClockMs,
        ),
      },
      ctx: {
        ...input.context,
        signal,
        allowedTools: definition.allowedTools,
        ...(input.task.contractId
          ? { requiredContractId: input.task.contractId }
          : {}),
      },
      events: {
        ...input.loop.events,
        onToolStart: (call) => {
          toolCalls.count++;
          input.loop.events?.onToolStart?.(call);
          if (toolCalls.count >= definition.budget.maxToolCalls)
            controller?.abort();
        },
      },
    };
    try {
      const result = await runLoop(loop);
      current.status =
        result.stopReason === "interrupted"
          ? "cancelled"
          : result.stopReason === "stop"
            ? "completed"
            : "failed";
      current.finishedAt = new Date().toISOString();
      current.usage = result.execution;
      current.result = result;
      return current;
    } catch (error) {
      current.status = signal.aborted ? "cancelled" : "failed";
      current.finishedAt = new Date().toISOString();
      current.error = error instanceof Error ? error.message : String(error);
      return current;
    }
  }

  private validate(definition: AgentDefinition, input: AgentLaunchInput) {
    if (definition.model.contextWindow < input.loop.config.contextWindow)
      throw new Error(
        `model context window is too small for agent ${definition.id}`,
      );
    if (
      definition.model.supportsTools === false &&
      definition.allowedTools.length
    )
      throw new Error(`agent model does not support tools: ${definition.id}`);
    if (input.task.workspaceRequired && !input.context.workspace)
      throw new Error(`workspace is required for task ${input.task.id}`);
    if (definition.workspacePolicy === "none" && input.context.workspace)
      throw new Error(`agent ${definition.id} cannot receive a workspace`);
  }
}
