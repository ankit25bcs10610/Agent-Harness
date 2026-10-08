import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listRepositoryFiles,
  searchRepository,
  searchRepositorySymbols,
} from "../../src/tool/repository";
import { runTool } from "../../src/tool/registry";
import type { ToolContext } from "../../src/tool/types";

let root = "";
const signal = () => new AbortController().signal;
const context = (workspace: string): ToolContext => ({
  permissions: { projectRoot: workspace, grants: [], audit: [] },
  asker: async () => "allow-once" as const,
  signal: signal(),
  maxOutputChars: 20_000,
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

test("lists metadata, excludes dependencies, and paginates", async () => {
  root = await mkdtemp(join(tmpdir(), "chiku-repo-"));
  await mkdir(join(root, "node_modules"));
  await writeFile(join(root, "a.ts"), "export const a = 1;");
  await writeFile(join(root, "node_modules", "ignored.js"), "ignored");
  await writeFile(join(root, "image.bin"), Buffer.from([0, 1, 2]));
  const page = await listRepositoryFiles({ root, maxResults: 1 }, signal());
  expect(page.results).toHaveLength(1);
  expect(page.results[0]?.path).not.toContain("node_modules");
  const all = await listRepositoryFiles({ root, maxResults: 10 }, signal());
  expect(all.results.find((item) => item.path === "image.bin")?.binary).toBe(
    true,
  );
});

test("searches text, returns source locations, and finds symbols", async () => {
  root = await mkdtemp(join(tmpdir(), "chiku-repo-"));
  await writeFile(
    join(root, "main.ts"),
    "export function greet() {\n  return 'hello';\n}\n",
  );
  const matches = await searchRepository("hello", { root }, signal());
  expect(matches.results[0]).toMatchObject({ path: "main.ts", line: 2 });
  const symbols = await searchRepositorySymbols("greet", { root }, signal());
  expect(symbols.results[0]).toMatchObject({ path: "main.ts", line: 1 });
});

test("does not traverse symlinks and rejects invalid regular expressions", async () => {
  root = await mkdtemp(join(tmpdir(), "chiku-repo-"));
  const outside = await mkdtemp(join(tmpdir(), "chiku-outside-"));
  try {
    await writeFile(join(outside, "secret.ts"), "secret");
    await symlink(outside, join(root, "linked"));
    expect(
      (
        await listRepositoryFiles({ root, maxResults: 20 }, signal())
      ).results.some((item) => item.path.includes("linked")),
    ).toBe(false);
    const result = await runTool(
      "search_files",
      JSON.stringify({ query: "[", regex: true }),
      context(root),
    );
    expect(result).toContain("invalid regular expression");
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("honors cancellation", async () => {
  root = await mkdtemp(join(tmpdir(), "chiku-repo-"));
  const controller = new AbortController();
  controller.abort();
  await expect(
    searchRepository("anything", { root }, controller.signal),
  ).rejects.toThrow("cancelled");
});
