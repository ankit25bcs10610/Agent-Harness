import {
  BenchmarkSuiteSchema,
  type BenchmarkSuite,
  type EvaluationTask,
} from "./types";

export class BenchmarkRegistry {
  private readonly suites = new Map<string, BenchmarkSuite>();

  register(value: BenchmarkSuite) {
    const suite = BenchmarkSuiteSchema.parse(value);
    if (this.suites.has(suite.id))
      throw new Error(`benchmark suite already registered: ${suite.id}`);
    const taskIds = new Set<string>();
    for (const task of suite.tasks) {
      if (taskIds.has(task.taskId))
        throw new Error(`duplicate evaluation task: ${task.taskId}`);
      taskIds.add(task.taskId);
      if (task.benchmarkId !== suite.id)
        throw new Error(`task ${task.taskId} belongs to another benchmark`);
    }
    this.suites.set(suite.id, suite);
    return suite;
  }

  get(id: string) {
    const suite = this.suites.get(id);
    if (!suite) throw new Error(`benchmark suite not found: ${id}`);
    return suite;
  }

  task(suiteId: string, taskId: string): EvaluationTask {
    const task = this.get(suiteId).tasks.find(
      (value) => value.taskId === taskId,
    );
    if (!task) throw new Error(`evaluation task not found: ${taskId}`);
    return task;
  }

  list() {
    return [...this.suites.values()];
  }
}
