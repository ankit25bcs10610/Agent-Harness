import { randomUUID } from "node:crypto";
import { AgentTaskSchema, type AgentTask, type AgentTaskStatus } from "./types";

export class TaskGraph {
  private readonly tasks = new Map<string, AgentTask>();

  constructor(tasks: readonly AgentTask[] = []) {
    for (const task of tasks) {
      const valid = AgentTaskSchema.parse(task);
      if (this.tasks.has(valid.id))
        throw new Error(`task already exists: ${valid.id}`);
      this.tasks.set(valid.id, valid);
    }
    for (const task of this.tasks.values())
      for (const dependency of task.dependencies) this.require(dependency);
    this.assertAcyclic();
  }

  add(task: AgentTask) {
    const valid = AgentTaskSchema.parse(task);
    if (this.tasks.has(valid.id))
      throw new Error(`task already exists: ${valid.id}`);
    for (const dependency of valid.dependencies) {
      if (dependency === valid.id || !this.tasks.has(dependency)) {
        // Dependencies may be added before their task only through addDependency.
        throw new Error(`unknown task dependency: ${dependency}`);
      }
    }
    this.tasks.set(valid.id, valid);
    this.assertAcyclic();
    return valid;
  }

  addTask(
    input: Omit<
      AgentTask,
      "id" | "createdAt" | "updatedAt" | "status" | "attempts"
    >,
  ) {
    const now = new Date().toISOString();
    return this.add({
      ...input,
      id: randomUUID(),
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  addDependency(taskId: string, dependencyId: string) {
    const task = this.require(taskId);
    this.require(dependencyId);
    if (taskId === dependencyId)
      throw new Error("task cannot depend on itself");
    const updated = {
      ...task,
      dependencies: [...new Set([...task.dependencies, dependencyId])],
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(taskId, updated);
    try {
      this.assertAcyclic();
    } catch (error) {
      this.tasks.set(taskId, task);
      throw error;
    }
  }

  get(id: string) {
    return this.require(id);
  }

  list() {
    return [...this.tasks.values()];
  }

  ready() {
    return this.list().filter((task) => {
      if (task.status !== "pending" && task.status !== "ready") return false;
      const dependencies = task.dependencies.map((id) => this.require(id));
      if (
        dependencies.some((dependency) =>
          ["failed", "cancelled", "blocked"].includes(dependency.status),
        )
      ) {
        this.update(task.id, "blocked");
        return false;
      }
      return dependencies.every(
        (dependency) => dependency.status === "succeeded",
      );
    });
  }

  update(id: string, status: AgentTaskStatus) {
    const task = this.require(id);
    const updated = AgentTaskSchema.parse({
      ...task,
      status,
      updatedAt: new Date().toISOString(),
    });
    this.tasks.set(id, updated);
    return updated;
  }

  attempt(id: string) {
    const task = this.require(id);
    const updated = AgentTaskSchema.parse({
      ...task,
      attempts: task.attempts + 1,
      status: "running",
      updatedAt: new Date().toISOString(),
    });
    this.tasks.set(id, updated);
    return updated;
  }

  isComplete() {
    return this.list().every((task) =>
      ["succeeded", "failed", "cancelled", "blocked"].includes(task.status),
    );
  }

  hasFailure() {
    return this.list().some((task) =>
      ["failed", "cancelled", "blocked"].includes(task.status),
    );
  }

  private require(id: string) {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`task not found: ${id}`);
    return task;
  }

  private assertAcyclic() {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) throw new Error("task graph contains a cycle");
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dependency of this.require(id).dependencies) visit(dependency);
      visiting.delete(id);
      visited.add(id);
    };
    for (const task of this.tasks.values()) visit(task.id);
  }
}
