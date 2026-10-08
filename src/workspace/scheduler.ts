export type ScheduledTask<T> = {
  taskId: string;
  run: (signal: AbortSignal) => Promise<T>;
};

export type ScheduledTaskState = {
  taskId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
};

export class TaskScheduler {
  private readonly queue: (ScheduledTask<unknown> & {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  })[] = [];
  private readonly states = new Map<string, ScheduledTaskState>();
  private readonly controllers = new Map<string, AbortController>();
  private active = 0;

  constructor(private limit = 1) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error("scheduler concurrency must be at least one");
  }

  setLimit(limit: number) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error("scheduler concurrency must be at least one");
    this.limit = limit;
    this.pump();
  }

  submit<T>(task: ScheduledTask<T>): Promise<T> {
    if (this.states.has(task.taskId))
      throw new Error(`task already scheduled: ${task.taskId}`);
    this.states.set(task.taskId, { taskId: task.taskId, status: "queued" });
    const promise = new Promise<T>((resolve, reject) => {
      this.queue.push({
        ...task,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
    });
    this.pump();
    return promise;
  }

  cancel(taskId: string) {
    const controller = this.controllers.get(taskId);
    if (controller) controller.abort();
    const state = this.states.get(taskId);
    if (state?.status === "queued") state.status = "cancelled";
  }

  snapshot() {
    return [...this.states.values()];
  }

  private pump() {
    while (this.active < this.limit) {
      const task = this.queue.shift();
      if (!task) return;
      const state = this.states.get(task.taskId);
      if (!state || state.status === "cancelled") {
        task.reject(new Error("task cancelled before execution"));
        continue;
      }
      this.active++;
      state.status = "running";
      const controller = new AbortController();
      this.controllers.set(task.taskId, controller);
      void task
        .run(controller.signal)
        .then(
          (value) => {
            state.status = "completed";
            task.resolve(value);
          },
          (error) => {
            state.status = controller.signal.aborted ? "cancelled" : "failed";
            task.reject(error);
          },
        )
        .finally(() => {
          this.active--;
          this.controllers.delete(task.taskId);
          this.pump();
        });
    }
  }
}
