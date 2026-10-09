import { z } from "zod";

export const MemoryScopeSchema = z.object({
  kind: z.enum(["session", "workspace", "user", "tenant"]),
  id: z.string().trim().min(1).max(300),
});
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const MemoryStatusSchema = z.enum([
  "candidate",
  "verified",
  "corrected",
  "rejected",
  "invalidated",
]);
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

export const MemoryEvidenceSchema = z
  .object({
    kind: z.enum(["verification", "user_confirmation", "agent_assertion"]),
    reference: z.string().trim().min(1).max(500),
    outcome: z.enum(["pass", "fail", "unknown"]).optional(),
  })
  .strict();
export type MemoryEvidence = z.infer<typeof MemoryEvidenceSchema>;

export const MemoryRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    scope: MemoryScopeSchema,
    kind: z.enum([
      "architecture",
      "convention",
      "workflow",
      "repair",
      "preference",
      "failure",
    ]),
    summary: z.string().trim().min(1).max(2_000),
    status: MemoryStatusSchema,
    evidence: z.array(MemoryEvidenceSchema).max(20),
    sourceRevision: z.string().trim().min(1).max(200).optional(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    invalidatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export const MemoryPolicySchema = z
  .object({
    enabled: z.boolean().default(false),
    maxRecords: z.number().int().positive().max(10_000).default(500),
    maxAgeMs: z
      .number()
      .int()
      .positive()
      .max(31_536_000_000)
      .default(180 * 24 * 60 * 60 * 1000),
    maxRetrieved: z.number().int().positive().max(100).default(10),
  })
  .strict();
export type MemoryPolicy = z.infer<typeof MemoryPolicySchema>;

export type MemoryRetrieval = {
  retrieve(
    scope: MemoryScope,
    query: string,
    limit?: number,
  ): Promise<MemoryRecord[]>;
};
