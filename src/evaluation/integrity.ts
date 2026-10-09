import { realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { EvaluationTask } from "./types";

export async function checkBenchmarkIntegrity(input: {
  task: EvaluationTask;
  root: string;
  changedFiles: readonly string[];
  trustedGraderRevision: string;
}) {
  const root = await realpath(input.root);
  const outside = input.changedFiles.filter((path) => {
    const resolved = resolve(root, path);
    const value = relative(root, resolved);
    return (
      value.startsWith("..") ||
      value.includes("/../") ||
      value.includes("\\..\\")
    );
  });
  const graderTampered = input.changedFiles.some((path) =>
    /grader|evaluation\/|benchmark\/trusted/i.test(path),
  );
  const fixtureContaminated = input.changedFiles.some(
    (path) =>
      input.task.securityConstraints.allowedPaths.length > 0 &&
      !input.task.securityConstraints.allowedPaths.some(
        (allowed) => path === allowed || path.startsWith(`${allowed}/`),
      ),
  );
  return {
    trustedGraderRevision: input.trustedGraderRevision,
    changedOutsideAllowedPaths: outside,
    graderTampered,
    fixtureContaminated,
    budgetExceeded: [] as Array<
      "iterations" | "tokens" | "wall_clock" | "tool_calls" | "cost"
    >,
  };
}
