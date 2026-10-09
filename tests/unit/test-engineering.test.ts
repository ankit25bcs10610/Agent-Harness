import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  analyzeRepeats,
  classifyFailure,
  runProperty,
} from "../../src/testing/quality";
import {
  detectTestFramework,
  inventoryTests,
  selectRelevantTests,
} from "../../src/testing/inventory";
import { runMutationAnalysis } from "../../src/testing/mutation";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chiku-testing-"));
  await mkdir(join(root, "src"));
  await mkdir(join(root, "tests"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ scripts: { test: "bun test" } }),
  );
  await writeFile(
    join(root, "src/math.ts"),
    "export function isPositive(value: number) { return value > 0; }\n",
  );
  await writeFile(
    join(root, "tests/math.test.ts"),
    'import { test, expect } from "bun:test"; test("positive", () => expect(true).toBe(true));\n',
  );
  return root;
}

test("detects Bun and inventories executable test cases", async () => {
  const root = await fixture();
  expect(await detectTestFramework(root)).toMatchObject({
    framework: "bun",
    supported: true,
  });
  const inventory = await inventoryTests(root);
  expect(inventory.files).toEqual(["tests/math.test.ts"]);
  expect(inventory.cases[0]?.name).toBe("positive");
});

test("falls back to the full suite when source impact is uncertain", async () => {
  const root = await fixture();
  const inventory = await inventoryTests(root);
  const selection = await selectRelevantTests(inventory, ["src/unknown.ts"]);
  expect(selection.fallback).toBe(true);
  expect(selection.files).toEqual(inventory.files);
});

test("property checks preserve deterministic seeds and counterexamples", () => {
  const result = runProperty({
    seed: 7,
    cases: 20,
    generate: (random) => Math.floor(random() * 10),
    invariant: (value) => value < 5,
  });
  expect(result.passed).toBe(false);
  expect(result.seed).toBe(7);
  expect(result.counterexample).toBeDefined();
});

test("classifies failures and requires repeated mixed outcomes for flakiness", () => {
  expect(classifyFailure({ exitCode: 1, stderr: "TS2304: missing name" })).toBe(
    "COMPILE_FAILURE",
  );
  expect(classifyFailure({ timedOut: true })).toBe("TIMEOUT");
  expect(analyzeRepeats(["failed"] as const).flaky).toBe(false);
  expect(analyzeRepeats(["passed", "failed", "passed"] as const).flaky).toBe(
    true,
  );
});

test("runs bounded mutations in a disposable workspace and scores only valid mutants", async () => {
  const root = await fixture();
  const report = await runMutationAnalysis({
    root,
    files: ["src/math.ts"],
    maxMutants: 2,
    timeoutMs: 100,
    run: async (workspace, mutant) => {
      expect(await readFile(join(workspace, "src/math.ts"), "utf8")).not.toBe(
        await readFile(join(root, "src/math.ts"), "utf8"),
      );
      return mutant.operator === "comparison-boundary" ? "killed" : "survived";
    },
  });
  expect(report.cases.length).toBe(1);
  expect(report.validCount).toBe(1);
  expect(report.score).toBe(1);
});
