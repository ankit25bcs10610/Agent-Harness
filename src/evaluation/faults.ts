import type { EvaluationAdapter } from "./engine";

export type EvaluationFault =
  | "provider_timeout"
  | "provider_failure"
  | "malformed_response"
  | "tool_failure"
  | "verification_failure"
  | "workspace_deleted";

/** Test-only fault injection at the evaluation boundary; never enabled by production defaults. */
export function withEvaluationFault(
  adapter: EvaluationAdapter,
  fault: EvaluationFault,
  trigger: "before" | "after" = "before",
): EvaluationAdapter {
  return async (task, environment, trace, signal) => {
    if (trigger === "before") {
      trace.record({
        taskId: task.taskId,
        type: "FAULT_INJECTED",
        data: { fault },
      });
      return { runtimeFailure: fault };
    }
    const result = await adapter(task, environment, trace, signal);
    trace.record({
      taskId: task.taskId,
      type: "FAULT_INJECTED",
      data: { fault },
    });
    return { ...result, runtimeFailure: fault };
  };
}
