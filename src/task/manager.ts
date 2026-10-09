import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  EngineeringTaskSchema,
  TASK_TRANSITIONS,
  type EngineeringTask,
  type EngineeringTaskState,
} from "./types";

const fileFor = (directory: string, taskId: string) =>
  join(directory, `task-${taskId}.json`);
const timestamp = () => new Date().toISOString();

async function persist(path: string, task: EngineeringTask) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(task, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export class EngineeringTaskManager {
  constructor(private readonly directory: string) {}

  async create(input: {
    objective: string;
    workspace: string;
    sourceRevision: string;
    constraints?: string[];
    relevantFiles?: string[];
    dependencies?: string[];
    plan?: { id: string; description: string }[];
    budget?: Partial<EngineeringTask["budget"]>;
  }): Promise<EngineeringTask> {
    const now = timestamp();
    const task = EngineeringTaskSchema.parse({
      schemaVersion: 1,
      taskId: randomUUID(),
      objective: input.objective,
      constraints: input.constraints ?? [],
      state: "CREATED",
      workspace: input.workspace,
      sourceRevision: input.sourceRevision,
      relevantFiles: input.relevantFiles ?? [],
      dependencies: input.dependencies ?? [],
      plan: (input.plan ?? []).map((step) => ({
        ...step,
        state: "pending",
        evidenceIds: [],
      })),
      authorizationIds: [],
      verificationEvidenceIds: [],
      checkpoint: {
        stepId: null,
        safeToResume: true,
        note: "created",
        updatedAt: now,
      },
      budget: {
        maxSteps: 50,
        maxRepairAttempts: 2,
        wallClockMs: 3_600_000,
        ...input.budget,
      },
      createdAt: now,
      updatedAt: now,
    });
    await persist(fileFor(this.directory, task.taskId), task);
    return task;
  }

  async load(taskId: string): Promise<EngineeringTask | undefined> {
    try {
      return EngineeringTaskSchema.parse(
        JSON.parse(await readFile(fileFor(this.directory, taskId), "utf8")),
      );
    } catch {
      return undefined;
    }
  }

  async transition(
    taskId: string,
    state: EngineeringTaskState,
    note: string,
    safeToResume = false,
  ) {
    const task = await this.load(taskId);
    if (!task) throw new Error(`engineering task not found: ${taskId}`);
    if (!TASK_TRANSITIONS[task.state].includes(state))
      throw new Error(`illegal task transition: ${task.state} -> ${state}`);
    const updated = EngineeringTaskSchema.parse({
      ...task,
      state,
      checkpoint: {
        ...task.checkpoint,
        safeToResume,
        note,
        updatedAt: timestamp(),
      },
      updatedAt: timestamp(),
    });
    await persist(fileFor(this.directory, taskId), updated);
    return updated;
  }

  async checkpoint(
    taskId: string,
    stepId: string | null,
    note: string,
    safeToResume: boolean,
  ) {
    const task = await this.load(taskId);
    if (!task) throw new Error(`engineering task not found: ${taskId}`);
    if (stepId && !task.plan.some((step) => step.id === stepId))
      throw new Error(`unknown task step: ${stepId}`);
    const updated = EngineeringTaskSchema.parse({
      ...task,
      checkpoint: { stepId, note, safeToResume, updatedAt: timestamp() },
      updatedAt: timestamp(),
    });
    await persist(fileFor(this.directory, taskId), updated);
    return updated;
  }
}
