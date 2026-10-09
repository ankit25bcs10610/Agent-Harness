import { z } from "zod";
import type { AgentTask } from "./types";

export const ExecutionModeSchema = z.enum([
  "single_agent",
  "parallel_specialists",
  "reviewer_assisted",
]);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export type RoutingDecision = {
  mode: ExecutionMode;
  reason: string;
  parallelTaskIds: string[];
  requiresReview: boolean;
};

function declaredPaths(task: AgentTask) {
  return task.inputRequirements
    .filter((value) => value.includes("/") || value.includes("\\"))
    .map((value) => value.replaceAll("\\", "/"));
}

/**
 * Selects an execution shape from declared task metadata only. It never
 * increases permissions, budgets, or concurrency; the scheduler remains the
 * enforcement point for actual execution.
 */
export function chooseExecutionMode(
  tasks: readonly AgentTask[],
): RoutingDecision {
  const active = tasks.filter(
    (task) => task.status !== "succeeded" && task.status !== "cancelled",
  );
  if (active.length <= 1) {
    return {
      mode: "single_agent",
      reason: "one executable task",
      parallelTaskIds: [],
      requiresReview: false,
    };
  }

  const highRisk = active.some(
    (task) => task.risk === "high" || task.workspaceRequired,
  );
  const paths = active.map((task) => declaredPaths(task));
  const overlaps = paths.some((left, index) =>
    paths
      .slice(index + 1)
      .some((right) =>
        left.some((path) =>
          right.some(
            (candidate) =>
              path === candidate ||
              path.startsWith(`${candidate}/`) ||
              candidate.startsWith(`${path}/`),
          ),
        ),
      ),
  );
  if (highRisk || overlaps) {
    return {
      mode: "reviewer_assisted",
      reason: highRisk
        ? "high-risk or workspace task requires review"
        : "declared task paths may overlap",
      parallelTaskIds: [],
      requiresReview: true,
    };
  }
  const independent = active.filter((task) => task.dependencies.length === 0);
  if (independent.length >= 2) {
    return {
      mode: "parallel_specialists",
      reason: "multiple dependency-free tasks with no declared path overlap",
      parallelTaskIds: independent.map((task) => task.id),
      requiresReview: false,
    };
  }
  return {
    mode: "single_agent",
    reason: "task dependencies require sequential execution",
    parallelTaskIds: [],
    requiresReview: false,
  };
}
