import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyAuthorizedSecurityPatch,
  scanAuthorizedRepository,
  validateSecurityScope,
} from "../../src/security";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chiku-security-"));
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      scripts: { test: "bun test" },
      dependencies: { demo: "^1.0.0" },
    }),
  );
  await writeFile(
    join(root, "src/vulnerable.ts"),
    'import { exec } from "node:child_process";\nexport function run(input: string) { exec(`echo ${input}`); }\n',
  );
  return root;
}

test("rejects security scopes that escape the authorized repository", async () => {
  const root = await fixture();
  await expect(
    validateSecurityScope({ root, allowedPaths: ["../outside"] }),
  ).rejects.toThrow("escapes repository");
});

test("reports source-grounded static findings without exposing secret values", async () => {
  const root = await fixture();
  await writeFile(
    join(root, "src/config.ts"),
    'const token = "sk-or-v1-super-secret-value";\n',
  );
  const result = await scanAuthorizedRepository({
    root,
    allowedPaths: ["src"],
  });
  expect(
    result.findings.some(
      (finding) =>
        finding.type === "unsafe-command" &&
        finding.location.file === "src/vulnerable.ts",
    ),
  ).toBe(true);
  expect(
    result.findings.some((finding) => finding.type === "secret-exposure"),
  ).toBe(true);
  expect(JSON.stringify(result)).not.toContain("super-secret-value");
});

test("requires advisory evidence instead of inventing dependency vulnerabilities", async () => {
  const root = await fixture();
  const result = await scanAuthorizedRepository({ root }, async () => []);
  expect(
    result.findings.filter((finding) => finding.type === "dependency-risk"),
  ).toHaveLength(0);
  const known = await scanAuthorizedRepository({ root }, async (dependency) =>
    dependency.name === "demo"
      ? [
          {
            advisoryId: "ADV-1",
            affectedVersions: "*",
            source: "fixture-advisory",
          },
        ]
      : [],
  );
  expect(
    known.findings.some((finding) => finding.findingId.includes("ADV-1")),
  ).toBe(true);
});

test("applies only explicitly approved security patch paths", async () => {
  const root = await fixture();
  await writeFile(join(root, "src/a.ts"), "old\n");
  const patch =
    "*** Begin Patch\n*** Update File: src/a.ts\n@@ -1 +1 @@\n-old\n+new\n*** End Patch";
  await expect(applyAuthorizedSecurityPatch(root, patch, [])).rejects.toThrow(
    "approved files",
  );
  await applyAuthorizedSecurityPatch(root, patch, ["src/a.ts"]);
  expect(await readFile(join(root, "src/a.ts"), "utf8")).toBe("new\n");
});
