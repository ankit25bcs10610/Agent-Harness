import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { listIncidents } from "../../src/maintenance/incidents";

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
});
