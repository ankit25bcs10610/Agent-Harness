import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  crashSignature,
  groupIncidents,
  listIncidents,
  transitionIncident,
} from "../../src/maintenance/incidents";

test("incident registry classifies persisted crash evidence without claiming confirmed root cause", async () => {
  const directory = join(tmpdir(), `chiku-incidents-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "report.json"),
    JSON.stringify({
      version: 1,
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      event: "uncaught_exception",
      error: {
        name: "ProviderError",
        message: "provider timeout",
        stack: "ProviderError: provider timeout",
      },
      runtime: { platform: "test", release: "test" },
    }),
  );
  const incidents = await listIncidents(directory);
  expect(incidents).toHaveLength(1);
  expect(incidents[0]?.category).toBe("provider");
  expect(incidents[0]?.confidence).toBe("SUSPECTED");
  expect(incidents[0]?.remediation).toBe("human_review_required");
  expect(incidents[0]?.state).toBe("DETECTED");
  expect(incidents[0]?.history).toHaveLength(1);
});

test("incident lifecycle requires authorized evidence and preserves an audit trail", async () => {
  const directory = join(tmpdir(), `chiku-incidents-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "report.json"),
    JSON.stringify({
      version: 1,
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      event: "uncaught_exception",
      error: { name: "Error", message: "tool timeout" },
      runtime: { platform: "test", release: "test" },
    }),
  );
  const [detected] = await listIncidents(directory);
  expect(detected).toBeDefined();
  expect(() =>
    transitionIncident(
      detected!,
      "TRIAGED",
      { actorId: "", actorRole: "operator" },
      ["local evidence"],
    ),
  ).toThrow();

  const triaged = transitionIncident(
    detected!,
    "TRIAGED",
    { actorId: "on-call", actorRole: "operator" },
    ["local crash report reviewed"],
  );
  const investigating = transitionIncident(
    triaged,
    "INVESTIGATING",
    { actorId: "engineer-1", actorRole: "engineer" },
    ["reproduction fixture required"],
  );
  expect(investigating.state).toBe("INVESTIGATING");
  expect(investigating.history).toHaveLength(3);
  expect(() =>
    transitionIncident(
      investigating,
      "CLOSED",
      { actorId: "on-call", actorRole: "operator" },
      ["closed without verification"],
    ),
  ).toThrow("invalid incident transition");
});

test("identical crash causes receive the same stable signature", async () => {
  const directory = join(tmpdir(), `chiku-incidents-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const first = randomUUID();
  const second = randomUUID();
  const report = (id: string, message: string) => ({
    version: 1,
    id,
    occurredAt: new Date().toISOString(),
    event: "uncaught_exception",
    error: { name: "TypeError", message },
    runtime: { platform: "test", release: "test" },
  });
  await writeFile(
    join(directory, "first.json"),
    JSON.stringify(report(first, "failed request 123")),
  );
  await writeFile(
    join(directory, "second.json"),
    JSON.stringify(report(second, "failed request 456")),
  );
  const incidents = await listIncidents(directory);
  expect(incidents[0]).toBeDefined();
  expect(
    crashSignature({
      error: { name: "TypeError", message: "failed request 123" },
    }),
  ).toBe(incidents[0]!.signature);
  expect(groupIncidents(incidents)).toHaveLength(1);
  expect(groupIncidents(incidents)[0]?.count).toBe(2);
});

test("malformed persisted crash reports are ignored", async () => {
  const directory = join(tmpdir(), `chiku-incidents-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "malformed.json"),
    JSON.stringify({ error: "nope" }),
  );
  expect(await listIncidents(directory)).toEqual([]);
});
