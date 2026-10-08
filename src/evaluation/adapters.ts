import { runLoop } from "../loop/loop";
import type { AgentEvent, LoopInput, LoopOutput } from "../loop/types";
import type { EvaluationAdapter, EvaluationExecution } from "./engine";

export type LoopEvaluationAdapterOptions = {
  createInput: (
    task: Parameters<EvaluationAdapter>[0],
    root: string,
    signal: AbortSignal,
  ) => LoopInput | Promise<LoopInput>;
  changedFiles?: (
    output: LoopOutput,
    root: string,
  ) => Promise<string[]> | string[];
};

/** Connects the real loop to evaluation without changing loop behavior. */
export function createLoopEvaluationAdapter(
  options: LoopEvaluationAdapterOptions,
): EvaluationAdapter {
  return async (
    task,
    environment,
    trace,
    signal,
  ): Promise<EvaluationExecution> => {
    const input = await options.createInput(task, environment.root, signal);
    const events = {
      ...input.events,
      onEvent: (event: AgentEvent) => {
        trace.record({
          taskId: task.taskId,
          workspaceId: environment.workspaceId,
          type: `LOOP_${event.type.toUpperCase()}`,
          data: event,
        });
        input.events?.onEvent?.(event);
      },
    };
    const output = await runLoop({
      ...input,
      ctx: { ...input.ctx, signal },
      events,
    });
    const changedFiles = options.changedFiles
      ? await options.changedFiles(output, environment.root)
      : [];
    return {
      ...(environment.workspaceId
        ? { workspaceId: environment.workspaceId }
        : {}),
      execution: output.execution,
      changedFiles,
      ...(output.stopReason === "stop"
        ? {}
        : { runtimeFailure: output.stopReason }),
    };
  };
}

/** Adapter boundary for an existing multi-agent coordinator or test harness. */
export function createMultiAgentEvaluationAdapter(
  execute: (
    task: Parameters<EvaluationAdapter>[0],
    root: string,
    signal: AbortSignal,
    trace: Parameters<EvaluationAdapter>[2],
  ) => Promise<EvaluationExecution>,
): EvaluationAdapter {
  return (task, environment, trace, signal) =>
    execute(task, environment.root, signal, trace);
}
