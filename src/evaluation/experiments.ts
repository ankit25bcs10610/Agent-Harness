import { randomUUID } from "node:crypto";
import { loadExperiment, saveExperiment } from "./store";
import type { EvaluationAdapter, EvaluationEngine } from "./engine";
import {
  ExperimentSchema,
  type EvaluationTask,
  type Experiment,
} from "./types";

export type ExperimentRun = Omit<
  Experiment,
  "experimentId" | "createdAt" | "updatedAt" | "status" | "results"
>;

/** Durable, bounded experiment orchestration. Completed tasks are never rerun on resume. */
export class ExperimentManager {
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly engine: EvaluationEngine,
    private readonly directory?: string,
  ) {}

  async create(input: ExperimentRun) {
    const now = new Date().toISOString();
    const experiment = ExperimentSchema.parse({
      ...input,
      experimentId: randomUUID(),
      status: "created",
      results: [],
      createdAt: now,
      updatedAt: now,
    });
    await saveExperiment(experiment, this.directory);
    return experiment;
  }

  async run(
    experiment: Experiment,
    tasks: readonly EvaluationTask[],
    adapter: EvaluationAdapter,
    signal?: AbortSignal,
  ) {
    if (experiment.status === "completed") return experiment;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    this.controllers.set(experiment.experimentId, controller);
    try {
      const completed = new Set(
        experiment.results.map((result) => result.taskId),
      );
      const next = ExperimentSchema.parse({
        ...experiment,
        status: "running",
        updatedAt: new Date().toISOString(),
      });
      await saveExperiment(next, this.directory);
      for (const task of tasks) {
        if (completed.has(task.taskId) || controller.signal.aborted) continue;
        const result = await this.engine.evaluateTask(
          task,
          adapter,
          controller.signal,
        );
        next.results.push(result);
        next.updatedAt = new Date().toISOString();
        await saveExperiment(next, this.directory);
      }
      next.status = controller.signal.aborted ? "cancelled" : "completed";
      next.updatedAt = new Date().toISOString();
      await saveExperiment(next, this.directory);
      return next;
    } catch (error) {
      const failed = ExperimentSchema.parse({
        ...experiment,
        status: "failed",
        updatedAt: new Date().toISOString(),
      });
      await saveExperiment(failed, this.directory);
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      this.controllers.delete(experiment.experimentId);
    }
  }

  cancel(experimentId: string) {
    this.controllers.get(experimentId)?.abort();
  }

  async resume(
    experimentId: string,
    tasks: readonly EvaluationTask[],
    adapter: EvaluationAdapter,
    signal?: AbortSignal,
  ) {
    const experiment = await loadExperiment(experimentId, this.directory);
    return this.run(experiment, tasks, adapter, signal);
  }
}
