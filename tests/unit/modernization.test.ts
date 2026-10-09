import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import {
  captureBaseline,
  createMigrationPlan,
  inspectProject,
  renameTypeScriptIdentifier,
  topologicalPlan,
} from "../../src/modernization";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chiku-modernization-"));
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      engines: { bun: ">=1" },
      scripts: { typecheck: "tsc --noEmit", test: "bun test" },
      dependencies: { react: "^19.0.0" },
      devDependencies: { typescript: "^5.0.0" },
    }),
  );
  await writeFile(
    join(root, "bun.lock"),
    '  "react": ["react@19.1.0", "", {}, "hash"],\n',
  );
  await writeFile(
    join(root, "src/app.ts"),
    "export const legacyName = 1;\nconsole.log(legacyName);\n",
  );
  return root;
}

test("inspects project technology, dependencies, lockfile, and checks from repository evidence", async () => {
  const root = await fixture();
  const inventory = await inspectProject(root);
  expect(inventory.evidence.some((item) => item.name === "typescript")).toBe(
    true,
  );
  expect(inventory.dependencies.map((item) => item.name)).toContain("react");
  expect(
    inventory.dependencies.find((item) => item.name === "react")
      ?.resolvedVersion,
  ).toBe("19.1.0");
  expect(inventory.lockfile).toBe("bun.lock");
  expect(inventory.verificationCommands).toEqual([
    { name: "typecheck", command: "bun run typecheck" },
    { name: "test", command: "bun run test" },
  ]);
});

test("builds an approval-aware dependency plan and rejects cyclic plans", async () => {
  const root = await fixture();
  const inventory = await inspectProject(root);
  const plan = createMigrationPlan(
    {
      schemaVersion: 1,
      source: { technology: "typescript", version: "5" },
      target: { technology: "typescript", version: "5.9" },
      goals: ["rename legacy API"],
      breakingChangeTolerance: "none",
      approvedFiles: ["src/app.ts"],
    },
    inventory,
  );
  expect(topologicalPlan(plan).map((step) => step.id)).toEqual([
    "inventory",
    "baseline",
    "transform",
    "verify",
    "review",
  ]);
  expect(
    plan.steps.find((step) => step.id === "transform")?.requiresApproval,
  ).toBe(true);
});

test("renames only AST identifiers in the approved file and is idempotent", async () => {
  const root = await fixture();
  const first = await renameTypeScriptIdentifier({
    root,
    file: "src/app.ts",
    from: "legacyName",
    to: "modernName",
    approvedFiles: ["src/app.ts"],
    authorize: async () => true,
  });
  expect(first.changed).toBe(true);
  expect(await readFile(join(root, "src/app.ts"), "utf8")).toBe(
    "export const modernName = 1;\nconsole.log(modernName);\n",
  );
  const second = await renameTypeScriptIdentifier({
    root,
    file: "src/app.ts",
    from: "legacyName",
    to: "modernName",
    approvedFiles: ["src/app.ts"],
    authorize: async () => true,
  });
  expect(second.changed).toBe(false);
});

test("rejects transformations outside approval scope or after cancellation", async () => {
  const root = await fixture();
  await expect(
    renameTypeScriptIdentifier({
      root,
      file: "src/app.ts",
      from: "legacyName",
      to: "modernName",
      approvedFiles: [],
      authorize: async () => true,
    }),
  ).rejects.toThrow("approved migration scope");
  const controller = new AbortController();
  controller.abort();
  await expect(
    renameTypeScriptIdentifier({
      root,
      file: "src/app.ts",
      from: "legacyName",
      to: "modernName",
      approvedFiles: ["src/app.ts"],
      authorize: async () => true,
      signal: controller.signal,
    }),
  ).rejects.toThrow("cancelled");
});

test("captures an unexecuted baseline unless an authorized check runner is supplied", async () => {
  const root = await fixture();
  const baseline = await captureBaseline(root);
  expect(
    baseline.baseline.checks.every((check) => check.status === "untested"),
  ).toBe(true);
  const executed = await captureBaseline(root, async (check) => ({
    status: "passed",
    reason: `fixture executed ${check.name}`,
  }));
  expect(
    executed.baseline.checks.every((check) => check.status === "passed"),
  ).toBe(true);
});
