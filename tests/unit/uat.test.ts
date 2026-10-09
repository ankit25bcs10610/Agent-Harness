import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  UAT_SCENARIOS,
  createUatRecord,
  finishUatRecord,
  loadUatRecords,
  saveUatRecord,
} from "../../src/uat";

describe("UAT records", () => {
  test("creates versioned evidence and preserves non-pass outcomes", async () => {
    const directory = join(tmpdir(), `chiku-uat-${randomUUID()}`);
    await mkdir(directory, { recursive: true });
    const scenario = UAT_SCENARIOS[0]!;
    const started = createUatRecord({
      scenarioId: scenario.scenarioId,
      scenarioVersion: scenario.version,
      status: "NOT_RUN",
      startedAt: new Date().toISOString(),
      environment: {
        runtime: "bun-test",
        platform: process.platform,
        workspace: directory,
      },
      evidence: [],
    });
    const finished = finishUatRecord(
      started,
      "BLOCKED",
      ["registry unavailable"],
      "clean install could not be verified",
    );
    const path = await saveUatRecord(finished, directory);
    const persisted = JSON.parse(await readFile(path, "utf8"));
    expect(persisted.status).toBe("BLOCKED");
    expect(persisted.failure).toContain("could not be verified");
    expect(persisted.scenarioVersion).toBe("1");
    expect(
      (await loadUatRecords(directory)).map((item) => item.recordId),
    ).toEqual([finished.recordId]);
    await rm(directory, { recursive: true, force: true });
  });

  test("loads legacy index records and ignores corrupt files without duplicating records", async () => {
    const directory = join(tmpdir(), `chiku-uat-${randomUUID()}`);
    await mkdir(directory, { recursive: true });
    const scenario = UAT_SCENARIOS[0]!;
    const record = createUatRecord({
      scenarioId: scenario.scenarioId,
      scenarioVersion: scenario.version,
      status: "PASS",
      startedAt: new Date().toISOString(),
      environment: {
        runtime: "bun-test",
        platform: process.platform,
        workspace: directory,
      },
      evidence: ["fixture passed"],
    });
    await Bun.write(join(directory, "index.json"), JSON.stringify([record]));
    await Bun.write(
      join(directory, `${record.recordId}.json`),
      JSON.stringify(record),
    );
    await Bun.write(join(directory, "corrupt.json"), "not-json");
    expect(
      (await loadUatRecords(directory)).map((item) => item.recordId),
    ).toEqual([record.recordId]);
    await rm(directory, { recursive: true, force: true });
  });
});
