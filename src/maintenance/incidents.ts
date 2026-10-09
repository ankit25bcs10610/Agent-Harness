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
export const IncidentStateSchema = z.enum([
  "DETECTED",
  "TRIAGED",
  "INVESTIGATING",
  "MITIGATING",
  "MONITORING",
  "RESOLVED",
  "POSTMORTEM_PENDING",
  "CLOSED",
]);
export const IncidentActorRoleSchema = z.enum(["operator", "engineer"]);
const IncidentHistoryEntrySchema = z.object({
  from: IncidentStateSchema.nullable(),
  to: IncidentStateSchema,
  actorId: z.string().trim().min(1).max(128),
  actorRole: IncidentActorRoleSchema,
  occurredAt: z.string().datetime(),
  evidence: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
});
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
  state: IncidentStateSchema,
  history: z.array(IncidentHistoryEntrySchema).min(1).max(100),
  remediation: z.literal("human_review_required"),
});
export type Incident = z.infer<typeof IncidentSchema>;
export type IncidentActor = {
  actorId: string;
  actorRole: z.infer<typeof IncidentActorRoleSchema>;
};

const ALLOWED_TRANSITIONS: Record<
  Incident["state"],
  readonly Incident["state"][]
> = {
  DETECTED: ["TRIAGED"],
  TRIAGED: ["INVESTIGATING"],
  INVESTIGATING: ["MITIGATING", "MONITORING"],
  MITIGATING: ["INVESTIGATING", "MONITORING"],
  MONITORING: ["MITIGATING", "RESOLVED"],
  RESOLVED: ["POSTMORTEM_PENDING"],
  POSTMORTEM_PENDING: ["CLOSED"],
  CLOSED: [],
};

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
  const incident = {
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
    state: "DETECTED" as const,
    history: [
      {
        from: null,
        to: "DETECTED" as const,
        actorId: "local-crash-reporter",
        actorRole: "operator" as const,
        occurredAt: report.occurredAt,
        evidence: ["classification is based on persisted local crash evidence"],
      },
    ],
    remediation: "human_review_required",
  };
  return IncidentSchema.parse(incident);
}

export function transitionIncident(
  incident: Incident,
  nextState: Incident["state"],
  actor: IncidentActor,
  evidence: readonly string[],
  occurredAt = new Date(),
): Incident {
  const current = IncidentSchema.parse(incident);
  const validNextStates = ALLOWED_TRANSITIONS[current.state];
  if (!validNextStates.includes(nextState)) {
    throw new Error(
      `invalid incident transition: ${current.state} -> ${nextState}`,
    );
  }
  const validatedActor = z
    .object({
      actorId: z.string().trim().min(1).max(128),
      actorRole: IncidentActorRoleSchema,
    })
    .parse(actor);
  const validatedEvidence = z
    .array(z.string().trim().min(1).max(500))
    .min(1)
    .max(20)
    .parse(evidence);
  return IncidentSchema.parse({
    ...current,
    state: nextState,
    history: [
      ...current.history,
      {
        from: current.state,
        to: nextState,
        actorId: validatedActor.actorId,
        actorRole: validatedActor.actorRole,
        occurredAt: occurredAt.toISOString(),
        evidence: validatedEvidence,
      },
    ],
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
