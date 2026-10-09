import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  AnalyticsConsentSchema,
  AnalyticsEventSchema,
  AnalyticsExportSchema,
  AnalyticsPropertiesSchema,
  type AnalyticsConsent,
  type AnalyticsEvent,
  type AnalyticsExport,
} from "./types";

const now = () => new Date().toISOString();
const consentFile = (directory: string) =>
  join(directory, "analytics-consent.json");
const eventsFile = (directory: string) =>
  join(directory, "analytics-events.json");
const installationFile = (directory: string) =>
  join(directory, "installation-id");
const SAFE_PROPERTY_KEYS = new Set([
  "mode",
  "provider",
  "model",
  "platform",
  "feature",
  "status",
  "errorCategory",
  "reason",
]);
const SENSITIVE_PROPERTY_KEY =
  /api[-_]?key|authorization|credential|password|prompt|secret|session|source|path|file|code|content|token/i;
const SECRET_VALUE =
  /(bearer\s+|sk-[a-z0-9_-]{12,}|openrouter\.[a-z0-9_-]{12,})/i;
const ABSOLUTE_PATH = /(?:^|\s)(?:\/|[a-z]:[\\/])[^\s]{2,}/i;

async function atomicWrite(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export function sanitizeAnalyticsProperties(
  properties: Record<string, string | number | boolean>,
) {
  const sanitized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!SAFE_PROPERTY_KEYS.has(key) || SENSITIVE_PROPERTY_KEY.test(key))
      continue;
    if (typeof value === "string") {
      if (SECRET_VALUE.test(value) || ABSOLUTE_PATH.test(value)) continue;
      sanitized[key] = value.slice(0, 256);
    } else if (typeof value === "number" || typeof value === "boolean") {
      sanitized[key] = value;
    }
    if (Object.keys(sanitized).length >= 20) break;
  }
  return AnalyticsPropertiesSchema.parse(sanitized);
}

export async function getInstallationId(directory: string): Promise<string> {
  try {
    const existing = (
      await readFile(installationFile(directory), "utf8")
    ).trim();
    if (existing) return existing;
  } catch {
    // A missing identifier is expected on first launch.
  }
  const id = randomUUID();
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(installationFile(directory), `${id}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch {
    // Another process may have initialized it concurrently.
  }
  try {
    return (await readFile(installationFile(directory), "utf8")).trim() || id;
  } catch {
    return id;
  }
}

export async function loadAnalyticsConsent(
  directory: string,
): Promise<AnalyticsConsent> {
  try {
    return AnalyticsConsentSchema.parse(
      JSON.parse(await readFile(consentFile(directory), "utf8")),
    );
  } catch {
    return { schemaVersion: 1, analyticsOptIn: false, updatedAt: now() };
  }
}

export async function setAnalyticsConsent(
  directory: string,
  analyticsOptIn: boolean,
) {
  const consent = AnalyticsConsentSchema.parse({
    schemaVersion: 1,
    analyticsOptIn,
    updatedAt: now(),
  });
  await atomicWrite(consentFile(directory), consent);
  if (!analyticsOptIn) await deleteAnalyticsEvents(directory);
  return consent;
}

export async function listAnalyticsEvents(
  directory: string,
): Promise<AnalyticsEvent[]> {
  try {
    const values = JSON.parse(await readFile(eventsFile(directory), "utf8"));
    if (!Array.isArray(values)) return [];
    return values.flatMap((value) => {
      const parsed = AnalyticsEventSchema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}

export async function recordAnalyticsEvent(
  directory: string,
  input: Omit<
    AnalyticsEvent,
    "schemaVersion" | "eventId" | "occurredAt" | "origin"
  > &
    Partial<Pick<AnalyticsEvent, "eventId" | "occurredAt" | "origin">>,
  retention = { maxEvents: 1000, maxAgeMs: 180 * 24 * 60 * 60 * 1000 },
): Promise<AnalyticsEvent | undefined> {
  const consent = await loadAnalyticsConsent(directory);
  if (!consent.analyticsOptIn) return undefined;
  const event = AnalyticsEventSchema.parse({
    schemaVersion: 1,
    eventId: randomUUID(),
    occurredAt: now(),
    ...input,
    properties: sanitizeAnalyticsProperties(input.properties),
  });
  const cutoff = Date.now() - retention.maxAgeMs;
  const events = (await listAnalyticsEvents(directory))
    .filter(
      (entry) =>
        Date.parse(entry.occurredAt) >= cutoff &&
        entry.eventId !== event.eventId,
    )
    .concat(event)
    .slice(-retention.maxEvents);
  await atomicWrite(eventsFile(directory), events);
  return event;
}

export async function deleteAnalyticsEvents(directory: string) {
  await rm(eventsFile(directory), { force: true });
}

export async function exportAnalytics(
  directory: string,
): Promise<AnalyticsExport> {
  return AnalyticsExportSchema.parse({
    schemaVersion: 1,
    exportedAt: now(),
    consent: await loadAnalyticsConsent(directory),
    events: await listAnalyticsEvents(directory),
  });
}
