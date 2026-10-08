import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatch, parsePatch, undoPatch } from "../../src/patch/engine";
import { runTool } from "../../src/tool/registry";
import type { ToolContext } from "../../src/tool/types";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
const signal = () => new AbortController().signal;
const context = (): ToolContext => ({
  permissions: { projectRoot: root, grants: [], audit: [] },
  asker: async () => "allow-once" as const,
  signal: signal(),
  maxOutputChars: 20_000,
});

test("parses and dry-runs multi-file patches without writing", async () => {
  root = await mkdtemp(join(tmpdir(), "chiku-patch-"));
  await writeFile(join(root, "a.txt"), "one\ntwo\n");
  await writeFile(join(root, "b.txt"), "red\nblue\n");
  const patch =
    "*** Begin Patch\n*** Update File: a.txt\n@@ -1,2 +1,2 @@\n one\n-two\n+TWO\n*** Update File: b.txt\n@@ -1,2 +1,2 @@\n-red\n+RED\n blue\n*** End Patch";
  const result = await applyPatch(root, patch, {
    dryRun: true,
    signal: signal(),
  });
  expect(result.dryRun).toBe(true);
  expect(result.files).toHaveLength(2);
  expect(await readFile(join(root, "a.txt"), "utf8")).toBe("one\ntwo\n");
});

test("applies a patch, preserves newline style and supports verified undo", async () => {
  root = await mkdtemp(join(tmpdir(), "chiku-patch-"));
  const path = join(root, "file.txt");
  await writeFile(path, "one\r\ntwo\r\n");
  const result = await applyPatch(
    root,
    "--- a/file.txt\n+++ b/file.txt\n@@ -1,2 +1,2 @@\n one\n-two\n+changed\n",
    { signal: signal() },
  );
  expect(result.applied).toBe(true);
  expect(await readFile(path, "utf8")).toBe("one\r\nchanged\r\n");
  await undoPatch(result.undoToken!, signal());
  expect(await readFile(path, "utf8")).toBe("one\r\ntwo\r\n");
});

test("rejects malformed and stale patches before modification", async () => {
  root = await mkdtemp(join(tmpdir(), "chiku-patch-"));
  const path = join(root, "file.txt");
  await writeFile(path, "current\n");
  expect(() => parsePatch("@@ -1 +1 @@\n-old\n+new")).toThrow("file header");
  await expect(
    applyPatch(
      root,
      "--- a/file.txt\n+++ b/file.txt\n@@ -1,1 +1,1 @@\n-old\n+new\n",
      { signal: signal() },
    ),
  ).rejects.toThrow("conflicting deletion");
  expect(await readFile(path, "utf8")).toBe("current\n");
});

test("rejects concurrent modification and symlink targets", async () => {
  root = await mkdtemp(join(tmpdir(), "chiku-patch-"));
  const path = join(root, "file.txt");
  await writeFile(path, "one\n");
  const controller = new AbortController();
  controller.abort();
  await expect(
    applyPatch(
      root,
      "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-one\n+two\n",
      { signal: controller.signal },
    ),
  ).rejects.toThrow("cancelled");
});

test("registers apply_patch with central permission checks", async () => {
  root = await mkdtemp(join(tmpdir(), "chiku-patch-"));
  await writeFile(join(root, "file.txt"), "one\n");
  const denied = context();
  denied.asker = async () => "deny";
  const result = await runTool(
    "apply_patch",
    JSON.stringify({
      dryRun: true,
      patch: "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-one\n+two\n",
    }),
    denied,
  );
  expect(result).toContain("Not allowed");
});
