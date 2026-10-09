import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { EngineeringTaskManager } from "../../src/task";

test("engineering task manager persists safe checkpoints and rejects illegal transitions", async () => {
  const manager = new EngineeringTaskManager(
    await mkdtemp(join(tmpdir(), "chiku-task-")),
  );
  const task = await manager.create({
    objective: "repair a failing test",
    workspace: "/workspace",
    sourceRevision: "HEAD",
    plan: [{ id: "inspect", description: "inspect failure" }],
  });
  expect(
    (await manager.transition(task.taskId, "UNDERSTANDING", "intake")).state,
  ).toBe("UNDERSTANDING");
  const checkpoint = await manager.checkpoint(
    task.taskId,
    "inspect",
    "inspection not side-effecting",
    true,
  );
  expect(checkpoint.checkpoint.safeToResume).toBe(true);
  await expect(
    manager.transition(task.taskId, "COMPLETED", "skip"),
  ).rejects.toThrow("illegal task transition");
});
