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
  iterations?: number;
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

  private trustedGraderRevision(task: EvaluationTask) {
    return (
      this.benchmarks.list().find((suite) => suite.id === task.benchmarkId)
        ?.trustedGraderRevision ?? "application-controlled"
    );
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
    const trustedGraderRevision = this.trustedGraderRevision(task);
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
    const deadline = new AbortController();
    const abortFromCaller = () => deadline.abort();
    signal.addEventListener("abort", abortFromCaller, { once: true });
    const timer = setTimeout(() => deadline.abort(), task.timeoutMs);
    try {
      environment = await this.environments.prepare(
        task,
        evaluationId,
        deadline.signal,
      );
      trace.record({
        taskId: task.taskId,
        workspaceId: environment.workspaceId,
        type: "WORKSPACE_PREPARED",
        data: { root: environment.root },
      });
      execution = await adapter(task, environment, trace, deadline.signal);
      if (deadline.signal.aborted)
        throw new Error("evaluation timed out before grading");
      const budgetExceeded = [
        ...(execution.iterations !== undefined &&
        execution.iterations > task.budget.maxIterations
          ? (["iterations"] as const)
          : []),
        ...(execution.execution &&
        execution.execution.tokensUsed > task.budget.maxTokens
          ? (["tokens"] as const)
          : []),
        ...(execution.execution &&
        execution.execution.toolCalls > task.budget.maxToolCalls
          ? (["tool_calls"] as const)
          : []),
      ];
      if (budgetExceeded.length)
        trace.record({
          taskId: task.taskId,
          type: "BUDGET_EXCEEDED",
          data: { budgets: budgetExceeded },
        });
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
        trustedGraderRevision,
        process: new ProcessExecutor(),
        signal: deadline.signal,
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
        trustedGraderRevision,
      });
      integrity.budgetExceeded = [...budgetExceeded];
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
          integrity.changedOutsideAllowedPaths.length ||
          budgetExceeded.length
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
        status: deadline.signal.aborted
          ? "TIMEOUT"
          : error instanceof Error &&
              (error.message.startsWith("evaluation blocked:") ||
                error.message.startsWith("fixture base commit mismatch:"))
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
          trustedGraderRevision,
          changedOutsideAllowedPaths: [],
          graderTampered: false,
          fixtureContaminated: false,
          budgetExceeded: [],
        },
        error: error instanceof Error ? error.message : String(error),
      });
      await saveEvaluationResult(result, this.resultsDirectory);
      this.results.set(result.evaluationId, result);
      return result;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abortFromCaller);
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
