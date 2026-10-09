import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { LocalThreatModelStore } from "../../src/security";

const threat = (id: string, reviewBy: string) => ({
  version: 1 as const,
  threatId: id,
  asset: "source-code",
  entryPoint: "model tool output",
  trustBoundary: "untrusted model to permission engine",
  impact: "Unauthorized file modification or data disclosure.",
  likelihood: "possible" as const,
  severity: "high" as const,
  mitigation: "Deterministic capability checks and workspace canonicalization.",
  evidenceIds: ["permission-test-1"],
  residualRisk:
    "Provider output remains untrusted and may request unsafe actions.",
  owner: "security-engineering",
  status: "mitigated" as const,
  reviewedAt: "2026-10-09T00:00:00.000Z",
  reviewBy,
});

test("threat model stores validated, bounded entries and filters status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chiku-threats-"));
  const store = new LocalThreatModelStore(directory, 1);
  await store.upsert(threat("t-1", "2027-01-01T00:00:00.000Z"));
  await store.upsert({
    ...threat("t-2", "2027-01-01T00:00:00.000Z"),
    status: "open",
  });

  expect((await store.list()).map((item) => item.threatId)).toEqual(["t-2"]);
  expect(await store.list("mitigated")).toHaveLength(0);
  expect(await store.list("open")).toHaveLength(1);
});

test("threat model identifies overdue reviews without claiming mitigation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chiku-threats-"));
  const store = new LocalThreatModelStore(directory);
  await store.upsert(threat("expired", "2026-01-01T00:00:00.000Z"));
  await store.upsert(threat("current", "2027-01-01T00:00:00.000Z"));

  expect(
    (await store.dueForReview(new Date("2026-10-09T00:00:00.000Z"))).map(
      (item) => item.threatId,
    ),
  ).toEqual(["expired"]);
});
