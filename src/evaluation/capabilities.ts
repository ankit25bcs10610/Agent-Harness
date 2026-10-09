import { z } from "zod";

export const CapabilityStatusSchema = z.enum([
  "VERIFIED",
  "PARTIAL",
  "UNKNOWN",
  "NOT_AVAILABLE",
  "BLOCKED",
]);
export type CapabilityStatus = z.infer<typeof CapabilityStatusSchema>;

export const CapabilityEvidenceSchema = z.object({
  source: z.string().trim().min(1).max(300),
  observation: z.string().trim().min(1).max(1_000),
});
export type CapabilityEvidence = z.infer<typeof CapabilityEvidenceSchema>;

export const CapabilityRecordSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9._-]{1,63}$/),
  name: z.string().trim().min(1).max(160),
  status: CapabilityStatusSchema,
  evidence: z.array(CapabilityEvidenceSchema).max(50),
  limitations: z.array(z.string().trim().min(1).max(500)).max(20),
  evaluatedAt: z.string().datetime({ offset: true }),
});
export type CapabilityRecord = z.infer<typeof CapabilityRecordSchema>;

export function validateCapabilityMatrix(values: readonly unknown[]) {
  const records = values.map((value) => CapabilityRecordSchema.parse(value));
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id))
      throw new Error(`duplicate capability: ${record.id}`);
    ids.add(record.id);
    if (record.status === "VERIFIED" && record.evidence.length === 0)
      throw new Error(`verified capability ${record.id} requires evidence`);
    if (record.status === "UNKNOWN" && record.limitations.length === 0)
      throw new Error(`unknown capability ${record.id} requires a limitation`);
  }
  return records;
}

export function capabilityReportMarkdown(values: readonly unknown[]) {
  const records = validateCapabilityMatrix(values);
  return [
    "# Chiku capability evidence",
    "",
    "Statuses describe observed repository evidence only; they are not competitor claims.",
    "",
    ...records.flatMap((record) => [
      `## ${record.name} — ${record.status}`,
      `- ID: \`${record.id}\``,
      ...record.evidence.map(
        (evidence) =>
          `- Evidence: \`${evidence.source}\` — ${evidence.observation}`,
      ),
      ...record.limitations.map((limitation) => `- Limitation: ${limitation}`),
      "",
    ]),
  ].join("\n");
}
