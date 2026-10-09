import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  activationFunnel,
  exportAnalytics,
  getInstallationId,
  listAnalyticsEvents,
  recordAnalyticsEvent,
  sanitizeAnalyticsProperties,
  setAnalyticsConsent,
  cohortRetention,
} from "../../src/analytics";

const base = {
  installationId: crypto.randomUUID(),
  productVersion: "1.0.0",
  properties: { source: "fixture" },
} as const;

describe("privacy-first local analytics", () => {
  test("is disabled by default and does not persist events", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chiku-analytics-"));
    expect(
      await recordAnalyticsEvent(directory, { ...base, name: "first_launch" }),
    ).toBeUndefined();
    expect(await listAnalyticsEvents(directory)).toEqual([]);
  });

  test("stores bounded validated events and revocation deletes them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chiku-analytics-"));
    await setAnalyticsConsent(directory, true);
    await recordAnalyticsEvent(directory, {
      ...base,
      name: "installation_verified",
    });
    await recordAnalyticsEvent(directory, { ...base, name: "first_launch" });
    expect(
      activationFunnel(await listAnalyticsEvents(directory)),
    ).toMatchObject({ eligibleInstallations: 1, firstLaunches: 1 });
    expect((await exportAnalytics(directory)).events).toHaveLength(2);
    await setAnalyticsConsent(directory, false);
    expect(await listAnalyticsEvents(directory)).toEqual([]);
  });

  test("keeps a stable local installation identifier without collecting identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chiku-analytics-"));
    const first = await getInstallationId(directory);
    const second = await getInstallationId(directory);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
  });

  test("filters sensitive and unbounded event properties before persistence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chiku-analytics-"));
    await setAnalyticsConsent(directory, true);
    const event = await recordAnalyticsEvent(directory, {
      ...base,
      name: "first_launch",
      properties: {
        mode: "local",
        prompt: "inspect /private/project/source.ts",
        sourcePath: "/private/project/source.ts",
        apiKey: ["sk", "live", "secret", "value"].join("-"),
        reason: "a".repeat(1000),
      },
    });
    expect(event?.properties).toEqual({
      mode: "local",
      reason: "a".repeat(256),
    });
    expect(JSON.stringify(event)).not.toContain("source.ts");
    expect(JSON.stringify(event)).not.toContain(
      ["sk", "live", "secret", "value"].join("-"),
    );
    expect(sanitizeAnalyticsProperties({ prompt: "private prompt" })).toEqual(
      {},
    );
  });

  test("excludes explicitly synthetic events from adoption and retention reports", () => {
    const installationId = crypto.randomUUID();
    const event = (
      name: "first_launch" | "coding_task_verified",
      origin: "product" | "synthetic",
    ) => ({
      schemaVersion: 1 as const,
      eventId: crypto.randomUUID(),
      name,
      occurredAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
      installationId,
      productVersion: "1.0.0",
      origin,
      properties: {},
    });
    expect(
      activationFunnel([event("first_launch", "synthetic")]),
    ).toMatchObject({
      eligibleInstallations: 0,
      firstLaunches: 0,
    });
    expect(
      cohortRetention([event("first_launch", "synthetic")])[0],
    ).toMatchObject({
      cohortSize: 0,
      retainedInstallations: 0,
      rate: null,
    });
  });

  test("reports retention from observed events with explicit denominators", () => {
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    const event = (
      installationId: string,
      name: "first_launch" | "coding_task_attempted",
      days: number,
    ) => ({
      schemaVersion: 1 as const,
      eventId: crypto.randomUUID(),
      name,
      occurredAt: new Date(Date.UTC(2026, 0, 1 + days)).toISOString(),
      installationId,
      productVersion: "1.0.0",
      properties: {},
    });
    const report = cohortRetention([
      event(first, "first_launch", 0),
      event(first, "coding_task_attempted", 1),
      event(second, "first_launch", 0),
    ]);
    expect(report[0]).toEqual({
      day: 1,
      cohortSize: 2,
      retainedInstallations: 1,
      rate: 0.5,
    });
    expect(report[1]?.rate).toBe(0);
    expect(report[2]?.cohortSize).toBe(2);
  });
});
