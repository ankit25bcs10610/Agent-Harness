import { access } from "node:fs/promises";
import { join, relative } from "node:path";
import { ProcessExecutor } from "../process/executor";
import type { ProcessRequest } from "../process/types";
import {
  GradeResultSchema,
  type EvaluationTask,
  type GradeResult,
} from "./types";

export type GraderContext = {
  task: EvaluationTask;
  root: string;
  changedFiles: readonly string[];
  trustedGraderRevision: string;
  process: ProcessExecutor;
  signal: AbortSignal;
  runtimeFailure?: string;
};

export type Grader = {
  id: string;
  trusted: true;
  grade: (context: GraderContext) => Promise<GradeResult>;
};

function result(
  grader: string,
  outcome: GradeResult["outcome"],
  started: number,
  evidence: string[],
  extra: Partial<GradeResult> = {},
) {
  return GradeResultSchema.parse({
    grader,
    outcome,
    durationMs: Date.now() - started,
    evidence,
    ...extra,
  });
}

function commandFor(task: EvaluationTask, grader: string) {
  const index = [
    "unit_test",
    "integration_test",
    "build",
    "typecheck",
    "lint",
  ].indexOf(grader);
  return index >= 0
    ? (task.verificationCommands[index] ?? task.verificationCommands[0])
    : undefined;
}

function commandGrader(id: string): Grader {
  return {
    id,
    trusted: true,
    async grade(context) {
      const started = Date.now();
      const command = commandFor(context.task, id);
      if (!command)
        return result(id, "NOT_RUN", started, [
          "No verification command configured.",
        ]);
      if (context.task.securityConstraints.requiresIsolation)
        return result(id, "BLOCKED", started, [
          "Task requires an isolation backend; none was supplied.",
        ]);
      const request: ProcessRequest = {
        command,
        cwd: context.root,
        workspaceRoot: context.root,
        timeoutMs: context.task.timeoutMs,
        maxOutputChars: 20_000,
      };
      const output = await context.process.run(request, context.signal);
      const evidence = [output.stdout, output.stderr]
        .filter(Boolean)
        .map((value) => value.slice(0, 4_000));
      const outcome =
        output.failure === "timeout"
          ? "TIMEOUT"
          : output.failure
            ? "ERROR"
            : output.exitCode === 0
              ? "PASS"
              : "FAIL";
      return result(id, outcome, started, evidence, {
        exitCode: output.exitCode,
      });
    },
  };
}

export class GraderRegistry {
  private readonly graders = new Map<string, Grader>();
  register(grader: Grader) {
    if (!grader.trusted)
      throw new Error(`grader must be trusted: ${grader.id}`);
    if (this.graders.has(grader.id))
      throw new Error(`grader already registered: ${grader.id}`);
    this.graders.set(grader.id, grader);
  }
  get(id: string) {
    const grader = this.graders.get(id);
    if (!grader) throw new Error(`grader not found: ${id}`);
    return grader;
  }
  list() {
    return [...this.graders.values()];
  }
}

export function createDefaultGraderRegistry() {
  const registry = new GraderRegistry();
  for (const id of [
    "unit_test",
    "integration_test",
    "build",
    "typecheck",
    "lint",
  ])
    registry.register(commandGrader(id));

  registry.register({
    id: "patch_validation",
    trusted: true,
    async grade(context) {
      const started = Date.now();
      const output = await context.process.run(
        {
          command: "git diff --check",
          cwd: context.root,
          workspaceRoot: context.root,
          timeoutMs: context.task.timeoutMs,
          maxOutputChars: 10_000,
        },
        context.signal,
      );
      return result(
        "patch_validation",
        output.exitCode === 0 ? "PASS" : "FAIL",
        started,
        [output.stdout, output.stderr].filter(Boolean),
        { exitCode: output.exitCode },
      );
    },
  });
  registry.register({
    id: "file_scope",
    trusted: true,
    async grade(context) {
      const started = Date.now();
      const allowed = context.task.securityConstraints.allowedPaths;
      const outside = context.changedFiles.filter(
        (file) =>
          !allowed.some((path) => file === path || file.startsWith(`${path}/`)),
      );
      return result(
        "file_scope",
        outside.length ? "FAIL" : "PASS",
        started,
        outside.length
          ? [`Changed files outside allowed paths: ${outside.join(", ")}`]
          : ["All changed files are within the trusted task scope."],
        { score: outside.length ? 0 : 1 },
      );
    },
  });
  registry.register({
    id: "repository_state",
    trusted: true,
    async grade(context) {
      const started = Date.now();
      const output = await context.process.run(
        {
          command: "git status --short --untracked-files=all",
          cwd: context.root,
          workspaceRoot: context.root,
          timeoutMs: context.task.timeoutMs,
          maxOutputChars: 10_000,
        },
        context.signal,
      );
      return result(
        "repository_state",
        output.failure ? "ERROR" : "PASS",
        started,
        [output.stdout, output.stderr].filter(Boolean),
        { exitCode: output.exitCode },
      );
    },
  });
  registry.register({
    id: "task_assertion",
    trusted: true,
    async grade(context) {
      const started = Date.now();
      const missing: string[] = [];
      for (const path of context.task.expectedOutcomes.requiredFiles) {
        try {
          await access(join(context.root, path));
        } catch {
          missing.push(path);
        }
      }
      const forbidden = context.changedFiles.filter((path) =>
        context.task.expectedOutcomes.forbiddenFiles.includes(path),
      );
      const evidence = [
        `missing=${missing.join(",")}`,
        `forbidden=${forbidden.join(",")}`,
      ];
      return result(
        "task_assertion",
        missing.length || forbidden.length ? "FAIL" : "PASS",
        started,
        evidence,
        { score: missing.length || forbidden.length ? 0 : 1 },
      );
    },
  });
  registry.register({
    id: "security_policy",
    trusted: true,
    async grade(context) {
      const started = Date.now();
      const outside = context.changedFiles.filter((path) =>
        relative(context.root, join(context.root, path)).startsWith(".."),
      );
      return result(
        "security_policy",
        outside.length ? "FAIL" : "PASS",
        started,
        outside.length
          ? ["Path escaped evaluation root."]
          : ["Changed paths remain relative to the evaluation root."],
      );
    },
  });
  registry.register({
    id: "runtime_failure",
    trusted: true,
    async grade(context) {
      const started = Date.now();
      return result(
        "runtime_failure",
        context.runtimeFailure ? "FAIL" : "PASS",
        started,
        [context.runtimeFailure ?? "No runtime failure recorded."],
      );
    },
  });
  for (const id of ["multi_agent", "integration_test"]) {
    if (!registry.list().some((grader) => grader.id === id))
      registry.register(commandGrader(id));
  }
  return registry;
}
