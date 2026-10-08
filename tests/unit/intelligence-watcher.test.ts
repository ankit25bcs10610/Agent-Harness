import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { watchRepository } from "../../src/intelligence/watcher";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

test("refresh reports content changes and can be closed", async () => {
  root = await mkdtemp(join(tmpdir(), "chiku-watch-"));
  await writeFile(join(root, "one.ts"), "export const one = 1;\n");
  const watcher = await watchRepository({ root });
  await writeFile(join(root, "two.ts"), "export const two = 2;\n");
  const changes = await watcher.refresh();
  watcher.close();
  expect(changes.added).toContain("two.ts");
});
