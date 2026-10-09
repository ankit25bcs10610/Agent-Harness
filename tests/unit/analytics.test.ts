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
  setAnalyticsConsent,
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
});
