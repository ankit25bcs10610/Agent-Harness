import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  analyzeImpact,
  buildRepositoryIndex,
  findDependencies,
  findSymbols,
  loadRepositoryIndex,
  retrieve,
  saveRepositoryIndex,
} from "../../src/intelligence";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

test("indexes TypeScript symbols and observed relative imports", async () => {
  root = await mkdtemp(join(tmpdir(), "chiku-intelligence-"));
  await writeFile(
    join(root, "util.ts"),
    "export function greet(name: string) { return name; }\n",
  );
  await writeFile(
    join(root, "main.ts"),
    "import { greet } from './util';\nexport const run = () => greet('world');\n",
  );
  const index = await buildRepositoryIndex(
    { root },
    new AbortController().signal,
  );
  expect(findSymbols(index, "greet")[0]).toMatchObject({
    path: "util.ts",
    kind: "function",
    startLine: 1,
  });
  expect(findDependencies(index, "main.ts")).toEqual(["util.ts"]);
  expect(retrieve(index, "greet", 5)[0]?.path).toBe("util.ts");
  expect(
    analyzeImpact(index, ["util.ts"]).some((item) => item.path === "main.ts"),
  ).toBe(true);
});

test("persists atomically and rejects corrupted indexes", async () => {
  root = await mkdtemp(join(tmpdir(), "chiku-intelligence-"));
  const path = join(root, "index.json");
  const index = await buildRepositoryIndex(
    { root },
    new AbortController().signal,
  );
  await saveRepositoryIndex(index, path);
  expect((await loadRepositoryIndex(path))?.root).toBe(index.root);
  await writeFile(path, "not json");
  expect(await loadRepositoryIndex(path)).toBeUndefined();
});
