import { randomUUID } from "node:crypto";
import { ProcessExecutor } from "../process/executor";
import { WorkspaceManager } from "../workspace/manager";
import { BenchmarkRegistry } from "./registry";
import {
  EvaluationEnvironmentManager,
  type EvaluationEnvironment,
} from "./environment";
import { TraceCollector } from "./trace";
import {
  createDefaultGraderRegistry,
  type GraderContext,
  type GraderRegistry,
} from "./graders";
import { aggregateMetrics, outcomeFromGrades } from "./metrics";
import { checkBenchmarkIntegrity } from "./integrity";
import {
  listEvaluationResults,
  saveEvaluationResult,
  saveExperiment,
} from "./store";
import {
  EvaluationResultSchema,
  ExperimentSchema,
  type EvaluationResult,
  type EvaluationTask,
  type Experiment,
} from "./types";
import type { LoopOutput } from "../loop/types";

export type EvaluationExecution = {
  sessionId?: string;
  agentId?: string;
  workspaceId?: string;
  execution?: LoopOutput["execution"];
  changedFiles?: string[];
  artifacts?: string[];
  runtimeFailure?: string;
};

export type EvaluationAdapter = (
  task: EvaluationTask,
  environment: EvaluationEnvironment,
  trace: TraceCollector,
  signal: AbortSignal,
) => Promise<EvaluationExecution>;

export class EvaluationEngine {
  readonly benchmarks: BenchmarkRegistry;
  readonly graders: GraderRegistry;
  readonly environments: EvaluationEnvironmentManager;
  private readonly results = new Map<string, EvaluationResult>();
  constructor(
    private readonly workspaceManager = new WorkspaceManager(),
    graders = createDefaultGraderRegistry(),
    private readonly resultsDirectory?: string,
  ) {
    this.benchmarks = new BenchmarkRegistry();
    this.graders = graders;
    this.environments = new EvaluationEnvironmentManager(workspaceManager);
  }

  registerSuite(value: Parameters<BenchmarkRegistry["register"]>[0]) {
    return this.benchmarks.register(value);
  }

  async evaluateTask(
    task: EvaluationTask,
    adapter: EvaluationAdapter,
    signal = new AbortController().signal,
  ): Promise<EvaluationResult> {
    const evaluationId = randomUUID();
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const trace = new TraceCollector(evaluationId, runId);
    trace.record({
      taskId: task.taskId,
      type: "EVALUATION_STARTED",
      data: { benchmarkId: task.benchmarkId },
    });
    let environment: EvaluationEnvironment | undefined;
    let execution: EvaluationExecution = {};
    let grades: Awaited<
      ReturnType<ReturnType<GraderRegistry["get"]>["grade"]>
    >[] = [];
    try {
      environment = await this.environments.prepare(task, evaluationId, signal);
      trace.record({
        taskId: task.taskId,
        workspaceId: environment.workspaceId,
        type: "WORKSPACE_PREPARED",
        data: { root: environment.root },
      });
      execution = await adapter(task, environment, trace, signal);
      const changedFiles = execution.changedFiles ?? [];
      trace.record({
        taskId: task.taskId,
        sessionId: execution.sessionId,
        agentId: execution.agentId,
        workspaceId: execution.workspaceId ?? environment.workspaceId,
        type: "AGENT_COMPLETED",
        data: { changedFiles: changedFiles.length },
      });
      const graderContext: GraderContext = {
        task,
        root: environment.root,
        changedFiles,
        trustedGraderRevision: "application-controlled",
        process: new ProcessExecutor(),
        signal,
        ...(execution.runtimeFailure
          ? { runtimeFailure: execution.runtimeFailure }
          : {}),
      };
      for (const id of task.requiredGraders) {
        trace.record({
          taskId: task.taskId,
          workspaceId: environment.workspaceId,
          type: "GRADING_STARTED",
          data: { grader: id },
        });
        const grade = await this.graders.get(id).grade(graderContext);
        grades.push(grade);
        trace.record({
          taskId: task.taskId,
          workspaceId: environment.workspaceId,
          type: "GRADING_COMPLETED",
          data: { grader: id, outcome: grade.outcome },
        });
      }
      const integrity = await checkBenchmarkIntegrity({
        task,
        root: environment.root,
        changedFiles,
        trustedGraderRevision: "application-controlled",
      });
      const finishedAt = new Date().toISOString();
      const metrics = aggregateMetrics({
        grades,
        durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
        changedFiles,
        allowedPaths: task.securityConstraints.allowedPaths,
        ...(execution.execution ? { execution: execution.execution } : {}),
      });
      const result = EvaluationResultSchema.parse({
        evaluationId,
        runId,
        taskId: task.taskId,
        status:
          integrity.graderTampered ||
          integrity.changedOutsideAllowedPaths.length
            ? "FAIL"
            : outcomeFromGrades(grades),
        startedAt,
        finishedAt,
        ...(environment.workspaceId
          ? { workspaceId: environment.workspaceId }
          : {}),
        grades,
        metrics,
        trace: trace.list(),
        artifacts: execution.artifacts ?? [],
        integrity,
      });
      await saveEvaluationResult(result, this.resultsDirectory);
      this.results.set(result.evaluationId, result);
      return result;
    } catch (error) {
      const finishedAt = new Date().toISOString();
      trace.record({
        taskId: task.taskId,
        type: "EVALUATION_FAILED",
        data: { error: error instanceof Error ? error.message : String(error) },
      });
      const result = EvaluationResultSchema.parse({
        evaluationId,
        runId,
        taskId: task.taskId,
        status: signal.aborted
          ? "TIMEOUT"
          : error instanceof Error &&
              error.message.startsWith("evaluation blocked:")
            ? "BLOCKED"
            : "ERROR",
        startedAt,
        finishedAt,
        ...(environment?.workspaceId
          ? { workspaceId: environment.workspaceId }
          : {}),
        grades,
        metrics: aggregateMetrics({
          grades,
          durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
          changedFiles: execution.changedFiles ?? [],
          ...(execution.execution ? { execution: execution.execution } : {}),
        }),
        trace: trace.list(),
        artifacts: execution.artifacts ?? [],
        integrity: {
          trustedGraderRevision: "application-controlled",
          changedOutsideAllowedPaths: [],
          graderTampered: false,
          fixtureContaminated: false,
        },
        error: error instanceof Error ? error.message : String(error),
      });
      await saveEvaluationResult(result, this.resultsDirectory);
      this.results.set(result.evaluationId, result);
      return result;
    }
  }

  async runSuite(
    suiteId: string,
    adapter: EvaluationAdapter,
    signal = new AbortController().signal,
  ) {
    const suite = this.benchmarks.get(suiteId);
    const results: EvaluationResult[] = [];
    for (const task of suite.tasks) {
      if (signal.aborted) break;
      results.push(await this.evaluateTask(task, adapter, signal));
    }
    return results;
  }

  async createExperiment(
    input: Omit<
      Experiment,
      "experimentId" | "createdAt" | "updatedAt" | "status" | "results"
    >,
  ) {
    const now = new Date().toISOString();
    const experiment = ExperimentSchema.parse({
      ...input,
      experimentId: randomUUID(),
      status: "created",
      results: [],
      createdAt: now,
      updatedAt: now,
    });
    await saveExperiment(experiment, this.resultsDirectory);
    return experiment;
  }

  result(id: string) {
    const result = this.results.get(id);
    if (!result) throw new Error(`evaluation result not found: ${id}`);
    return result;
  }

  listResults() {
    return [...this.results.values()];
  }

  async hydrate() {
    for (const result of await listEvaluationResults(this.resultsDirectory))
      this.results.set(result.evaluationId, result);
    return this.listResults();
  }
}
