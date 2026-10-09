import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  CrashReportSchema,
  listCrashReports,
  type CrashReport,
} from "../beta/crash";
import { createHash } from "node:crypto";

export const IncidentSeveritySchema = z.enum(["SEV0", "SEV1", "SEV2", "SEV3"]);
export const IncidentConfidenceSchema = z.enum([
  "CONFIRMED",
  "LIKELY",
  "SUSPECTED",
  "UNKNOWN",
]);
export const IncidentSchema = z.object({
  incidentId: z.string().uuid(),
  sourceReport: z.string().min(1),
  signature: z.string().length(64),
  occurredAt: z.string().datetime(),
  severity: IncidentSeveritySchema,
  confidence: IncidentConfidenceSchema,
  category: z.enum([
    "safety",
    "data_loss",
    "provider",
    "tool",
    "runtime",
    "unknown",
  ]),
  summary: z.string().min(1),
  evidence: z.array(z.string()),
  remediation: z.literal("human_review_required"),
});
export type Incident = z.infer<typeof IncidentSchema>;

function normalizeForSignature(value: string) {
  return value
    .replace(/[0-9a-f]{8,}/gi, "<id>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function crashSignature(report: Pick<CrashReport, "error">) {
  return createHash("sha256")
    .update(
      `${normalizeForSignature(report.error.name)}:${normalizeForSignature(report.error.message)}`,
    )
    .digest("hex");
}

function classify(report: CrashReport, sourceReport: string): Incident {
  const haystack =
    `${report.error.name} ${report.error.message} ${report.error.stack ?? ""}`.toLowerCase();
  const safety = /permission|unauthor|sandbox|policy|secret|credential/.test(
    haystack,
  );
  const dataLoss = /corrupt|rollback|deleted|overwrite|session/.test(haystack);
  const provider = /openrouter|provider|model|rate.?limit|timeout/.test(
    haystack,
  );
  const tool = /tool|command|process|spawn/.test(haystack);
  const category = safety
    ? "safety"
    : dataLoss
      ? "data_loss"
      : provider
        ? "provider"
        : tool
          ? "tool"
          : "runtime";
  const severity =
    safety || dataLoss ? "SEV1" : provider || tool ? "SEV2" : "SEV3";
  return IncidentSchema.parse({
    incidentId: report.id,
    sourceReport,
    signature: crashSignature(report),
    occurredAt: report.occurredAt,
    severity,
    confidence: "SUSPECTED",
    category,
    summary: `${report.event}: ${report.error.name}: ${report.error.message}`,
    evidence: [
      "classification is based on persisted local crash evidence",
      ...(report.error.stack ? ["stack trace available"] : []),
    ],
    remediation: "human_review_required",
  });
}

export async function listIncidents(directory?: string): Promise<Incident[]> {
  const paths = await listCrashReports(directory);
  const incidents: Incident[] = [];
  for (const sourceReport of paths) {
    try {
      const report = CrashReportSchema.parse(
        JSON.parse(await readFile(join(sourceReport), "utf8")),
      );
      incidents.push(classify(report, sourceReport));
    } catch {
      // Corrupt reports remain on disk and are omitted rather than treated as valid evidence.
    }
  }
  return incidents.sort((left, right) =>
    right.occurredAt.localeCompare(left.occurredAt),
  );
}

export function groupIncidents(incidents: readonly Incident[]) {
  const groups = new Map<string, Incident[]>();
  for (const incident of incidents) {
    const group = groups.get(incident.signature) ?? [];
    group.push(incident);
    groups.set(incident.signature, group);
  }
  return [...groups.entries()].map(([signature, entries]) => ({
    signature,
    count: entries.length,
    incidents: entries,
  }));
}
