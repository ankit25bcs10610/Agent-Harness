import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { planChange } from "../../src/contract/planner";
import {
  compareContracts,
  reviseContract,
  validateContract,
} from "../../src/contract/types";
import { loadContract, saveContract } from "../../src/contract/store";
import { validateContractPreconditions } from "../../src/contract/preconditions";

let root = "";

async function runGit(args: string[]) {
  const process = Bun.spawn(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  if (code !== 0) throw new Error(stderr);
}

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function setup() {
  root = await mkdtemp(join(tmpdir(), "chiku-contract-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "value.ts"), "export const value = 1;\n");
  await runGit(["init"]);
  await runGit(["config", "user.email", "test@example.invalid"]);
  await runGit(["config", "user.name", "Test"]);
  await runGit(["add", "."]);
  await runGit(["commit", "-m", "initial"]);
}

const patch = `*** Begin Patch
*** Update File: src/value.ts
@@ -1,1 +1,1 @@
-export const value = 1;
+export const value = 2;
*** End Patch`;

test("plans a real patch with repository evidence and validates preconditions", async () => {
  await setup();
  const contract = await planChange({
    root,
    taskId: "task-1",
    sessionId: "session-1",
    userRequest: "change the value",
    objective: "Update the exported value",
    patch,
  });
  expect(contract.proposedFiles[0]?.originalHash).toHaveLength(64);
  expect(contract.proposedFiles[0]?.proposedHash).toHaveLength(64);
  expect(contract.riskAssessment.level).toBe("low");
  expect(
    (await validateContractPreconditions(contract, root)).every(
      (item) => item.passed,
    ),
  ).toBe(true);
});

test("persists immutable revisions and detects stale files", async () => {
  await setup();
  const contract = await planChange({
    root,
    taskId: "task-2",
    sessionId: "session-2",
    userRequest: "change the value",
    objective: "Update the exported value",
    patch,
  });
  const directory = join(root, ".contracts");
  await saveContract(contract, directory);
  const loaded = await loadContract(contract.contractId, undefined, directory);
  expect(loaded?.revision).toBe(1);
  const revised = reviseContract(contract, { status: "approved" });
  expect(revised.revision).toBe(2);
  expect(compareContracts(contract, revised)).toEqual(["status"]);
  expect(validateContract(revised).valid).toBe(true);
  await writeFile(join(root, "src", "value.ts"), "export const value = 3;\n");
  const checks = await validateContractPreconditions(contract, root);
  expect(checks.find((item) => item.kind === "file_hash")?.passed).toBe(false);
});
