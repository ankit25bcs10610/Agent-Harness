import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const LeadStatusSchema = z.enum([
  "new",
  "qualified",
  "disqualified",
  "converted",
  "deleted",
]);
export const LeadSchema = z.object({
  schemaVersion: z.literal(1),
  leadId: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(160).optional(),
  organization: z.string().min(1).max(200).optional(),
  source: z.enum(["website", "cli", "referral", "authorized_import"]),
  status: LeadStatusSchema,
  consent: z.object({
    marketing: z.boolean(),
    productContact: z.boolean(),
    recordedAt: z.string().datetime({ offset: true }),
  }),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type Lead = z.infer<typeof LeadSchema>;

export const LeadAuditEventSchema = z.object({
  eventId: z.string().uuid(),
  leadId: z.string().uuid(),
  action: z.enum([
    "created",
    "updated",
    "status_changed",
    "deleted",
    "exported",
  ]),
  actor: z.string().min(1).max(120),
  at: z.string().datetime({ offset: true }),
});
export type LeadAuditEvent = z.infer<typeof LeadAuditEventSchema>;

const recordFile = (directory: string) => join(directory, "leads.json");
const auditFile = (directory: string) => join(directory, "lead-audit.json");
const now = () => new Date().toISOString();

async function readList<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const parsed = schema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}

async function writeAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

export class LocalLeadStore {
  constructor(
    private readonly directory: string,
    private readonly maxRecords = 10_000,
  ) {}

  async list() {
    return readList(recordFile(this.directory), LeadSchema);
  }

  async create(input: {
    email: string;
    name?: string;
    organization?: string;
    source: Lead["source"];
    consent: { marketing: boolean; productContact: boolean };
    actor: string;
  }) {
    if (!input.consent.productContact && !input.consent.marketing)
      throw new Error(
        "explicit product-contact or marketing consent is required",
      );
    const timestamp = now();
    const lead = LeadSchema.parse({
      schemaVersion: 1,
      leadId: randomUUID(),
      ...input,
      actor: undefined,
      status: "new",
      consent: { ...input.consent, recordedAt: timestamp },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const records = (await this.list())
      .filter((item) => item.email !== lead.email)
      .concat(lead)
      .slice(-this.maxRecords);
    await writeAtomic(recordFile(this.directory), records);
    await this.audit(lead.leadId, "created", input.actor);
    return lead;
  }

  async updateStatus(leadId: string, status: Lead["status"], actor: string) {
    const records = await this.list();
    const current = records.find((item) => item.leadId === leadId);
    if (!current) throw new Error(`lead not found: ${leadId}`);
    const updated = LeadSchema.parse({ ...current, status, updatedAt: now() });
    await writeAtomic(
      recordFile(this.directory),
      records.map((item) => (item.leadId === leadId ? updated : item)),
    );
    await this.audit(leadId, "status_changed", actor);
    return updated;
  }

  async revoke(leadId: string, actor: string) {
    return this.updateStatus(leadId, "deleted", actor);
  }

  async audit(leadId: string, action: LeadAuditEvent["action"], actor: string) {
    const event = LeadAuditEventSchema.parse({
      eventId: randomUUID(),
      leadId,
      action,
      actor,
      at: now(),
    });
    const events = (
      await readList(auditFile(this.directory), LeadAuditEventSchema)
    )
      .slice(-this.maxRecords)
      .concat(event);
    await writeAtomic(auditFile(this.directory), events);
    return event;
  }

  async auditLog() {
    return readList(auditFile(this.directory), LeadAuditEventSchema);
  }
}
