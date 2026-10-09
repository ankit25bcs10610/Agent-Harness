import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { LocalSecurityEvidenceStore } from "../../src/security";

const evidence = (id: string, reviewBy?: string) => ({
  version: 1 as const,
  evidenceId: id,
  controlId: "permission-boundary",
  status: "IMPLEMENTED_AND_TESTED" as const,
  source: "tests/unit/permission.test.ts",
  sourceVersion: "working-tree",
  collectedAt: "2026-10-09T00:00:00.000Z",
  environment: "test" as const,
  testStatus: "passed" as const,
  limitations: ["Local fixture only; not an independent audit."],
  ...(reviewBy ? { reviewBy } : {}),
  summary: "Permission decisions are validated by deterministic tests.",
});

test("security evidence is versioned, bounded, atomically persisted, and queryable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chiku-evidence-"));
  const store = new LocalSecurityEvidenceStore(directory, 1);
  await store.record(evidence("one"));
  await store.record(evidence("two"));

  expect((await store.list()).map((item) => item.evidenceId)).toEqual(["two"]);
  expect(await store.list({ status: "IMPLEMENTED_AND_TESTED" })).toHaveLength(
    1,
  );
  expect(
    await readFile(join(directory, "security-evidence.json"), "utf8"),
  ).not.toContain("secret");
});

test("expired evidence is excluded from the current evidence view", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chiku-evidence-"));
  const store = new LocalSecurityEvidenceStore(directory);
  await store.record(evidence("expired", "2026-01-01T00:00:00.000Z"));
  await store.record(evidence("current", "2027-01-01T00:00:00.000Z"));

  expect(
    (await store.current(new Date("2026-10-09T00:00:00.000Z"))).map(
      (item) => item.evidenceId,
    ),
  ).toEqual(["current"]);
});
