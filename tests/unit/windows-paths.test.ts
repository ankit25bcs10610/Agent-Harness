import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inventoryTests } from "../../src/testing/inventory";
import { scanAuthorizedRepository } from "../../src/security/remediation";

test("repository-relative test inventory uses stable forward-slash paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "chiku-paths-"));
  await mkdir(join(root, "tests"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ scripts: { test: "bun test" } }),
  );
  await writeFile(
    join(root, "tests", "math.test.ts"),
    'test("math", () => {});',
  );
  const inventory = await inventoryTests(root);
  expect(inventory.files).toEqual(["tests/math.test.ts"]);
});

test("security scanner scope matching is stable across host path separators", async () => {
  const root = await mkdtemp(join(tmpdir(), "chiku-paths-"));
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "src", "vulnerable.ts"),
    'import { exec } from "node:child_process";\nexec(`echo ${input}`);\n',
  );
  const result = await scanAuthorizedRepository({
    root,
    allowedPaths: ["src"],
  });
  expect(result.files).toEqual(["src/vulnerable.ts"]);
  expect(
    result.findings.some((finding) => finding.type === "unsafe-command"),
  ).toBe(true);
});
