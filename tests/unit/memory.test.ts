import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { LocalMemoryStore } from "../../src/memory";

const scope = { kind: "workspace" as const, id: "workspace-a" };

test("memory store is disabled by default and requires evidence for verified facts", async () => {
  const directory = join(tmpdir(), `chiku-memory-${randomUUID()}`);
  const disabled = await new LocalMemoryStore(directory).load();
  expect(
    await disabled.add({
      scope,
      kind: "architecture",
      summary: "Uses Bun tests",
    }),
  ).toBeUndefined();

  const store = await new LocalMemoryStore(directory, {
    enabled: true,
    maxRecords: 10,
    maxAgeMs: 1_000_000,
    maxRetrieved: 5,
  }).load();
  await expect(
    store.add({
      scope,
      kind: "architecture",
      summary: "Uses Bun tests",
      status: "verified",
    }),
  ).rejects.toThrow("evidence");
  const candidate = await store.add({
    scope,
    kind: "architecture",
    summary: "Uses Bun tests",
  });
  expect(candidate?.status).toBe("candidate");
  expect(await store.retrieve(scope, "Bun tests")).toHaveLength(0);
});

test("verified memory is scoped, deduplicated, retrievable, and never stores secrets", async () => {
  const directory = join(tmpdir(), `chiku-memory-${randomUUID()}`);
  const store = await new LocalMemoryStore(directory, {
    enabled: true,
    maxRecords: 10,
    maxAgeMs: 1_000_000,
    maxRetrieved: 5,
  }).load();
  const first = await store.add({
    scope,
    kind: "workflow",
    summary: "Run bun test before review",
    status: "verified",
    evidence: [
      { kind: "verification", reference: "ci-run-1", outcome: "pass" },
    ],
    sourceRevision: "abc",
  });
  expect(first).toBeDefined();
  await store.add({
    scope,
    kind: "workflow",
    summary: "Run bun test before review",
    status: "verified",
    evidence: [
      { kind: "verification", reference: "ci-run-2", outcome: "pass" },
    ],
  });
  await expect(
    store.add({
      scope,
      kind: "workflow",
      summary: "OPENROUTER_API_KEY=secret",
    }),
  ).rejects.toThrow("sensitive");
  expect(await store.retrieve(scope, "review bun test")).toHaveLength(1);
  expect(
    await store.retrieve(
      { kind: "workspace", id: "workspace-b" },
      "review bun test",
    ),
  ).toHaveLength(0);
});

test("memory supports correction, revision invalidation, deletion, and corrupted-file recovery", async () => {
  const directory = join(tmpdir(), `chiku-memory-${randomUUID()}`);
  const store = await new LocalMemoryStore(directory, {
    enabled: true,
    maxRecords: 10,
    maxAgeMs: 1_000_000,
    maxRetrieved: 5,
  }).load();
  const record = await store.add({
    scope,
    kind: "convention",
    summary: "Use strict TypeScript",
    status: "verified",
    evidence: [
      { kind: "verification", reference: "typecheck", outcome: "pass" },
    ],
    sourceRevision: "old",
  });
  const corrected = await store.correct(
    record!.id,
    "Use strict TypeScript and Bun formatting",
    "user-correction",
  );
  expect(corrected.status).toBe("corrected");
  await store.invalidateRevision(scope, "new");
  expect(await store.retrieve(scope, "strict TypeScript")).toHaveLength(0);
  expect(await store.delete(record!.id)).toBe(true);

  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "memory.json"), "not-json\n");
  const recovered = await new LocalMemoryStore(directory, {
    enabled: true,
    maxRecords: 10,
    maxAgeMs: 1_000_000,
    maxRetrieved: 5,
  }).load();
  expect(await recovered.list(scope)).toHaveLength(0);
});
