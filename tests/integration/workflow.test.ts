import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createWorkflowController } from "../../src/workflow/verify";
import type { ToolContext } from "../../src/tool/types";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

function context(): ToolContext {
  return {
    permissions: { projectRoot: process.cwd(), grants: [], audit: [] },
    asker: async () => "allow-once" as const,
    signal: new AbortController().signal,
    maxOutputChars: 10_000,
  };
}

test("discovers and executes verification commands with evidence", async () => {
  root = await mkdtemp(join(process.cwd(), ".chiku-workflow-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ scripts: { typecheck: "echo verified" } }),
  );
  const phases: string[] = [];
  const controller = createWorkflowController(
    {
      root,
      maxRepairAttempts: 0,
      commandTimeoutMs: 5000,
      maxOutputChars: 1000,
      enabled: true,
    },
    context(),
    { onPhase: (phase) => phases.push(phase) },
  );
  controller.recordToolCall({
    toolCallId: "1",
    name: "str_replace",
    arguments: JSON.stringify({ path: "file.ts" }),
  });
  const report = await controller.finalize(
    "stop",
    new AbortController().signal,
  );
  expect(report?.passed).toBe(true);
  expect(report?.checks[0]?.stdout).toContain("verified");
  expect(phases).toContain("final_evidence");
});

test("reports failed checks and bounds repair attempts", async () => {
  root = await mkdtemp(join(process.cwd(), ".chiku-workflow-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ scripts: { test: "exit 1" } }),
  );
  let repairs = 0;
  const controller = createWorkflowController(
    {
      root,
      maxRepairAttempts: 1,
      commandTimeoutMs: 5000,
      maxOutputChars: 1000,
      enabled: true,
    },
    context(),
    undefined,
    async () => {
      repairs++;
      return false;
    },
  );
  controller.recordToolCall({
    toolCallId: "1",
    name: "write_file",
    arguments: JSON.stringify({ path: "file.ts" }),
  });
  const report = await controller.finalize(
    "stop",
    new AbortController().signal,
  );
  expect(report?.passed).toBe(false);
  expect(report?.checks[0]?.status).toBe("failed");
  expect(repairs).toBe(1);
  expect(report?.remainingRisks.length).toBeGreaterThan(0);
});
