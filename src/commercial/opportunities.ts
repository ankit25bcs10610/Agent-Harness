import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const OpportunityStageSchema = z.enum([
  "discovered",
  "qualified",
  "evaluation",
  "proposal",
  "negotiation",
  "won",
  "lost",
]);
export type OpportunityStage = z.infer<typeof OpportunityStageSchema>;

export const OpportunitySchema = z.object({
  schemaVersion: z.literal(1),
  opportunityId: z.string().uuid(),
  leadId: z.string().uuid(),
  organization: z.string().min(1).max(200),
  stage: OpportunityStageSchema,
  qualification: z.object({
    problem: z.string().min(1).max(2_000),
    technicalOwnerConfirmed: z.boolean(),
    evaluationAuthorized: z.boolean(),
    budgetStatus: z.enum(["unknown", "unconfirmed", "confirmed"]),
    timeline: z.enum(["unknown", "exploration", "quarter", "six_months_plus"]),
  }),
  evidenceRefs: z.array(z.string().min(1)).max(100),
  tenantId: z.string().min(1).max(100),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

export const OpportunityAuditSchema = z.object({
  eventId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  tenantId: z.string().min(1),
  action: z.enum(["created", "stage_changed", "qualification_updated"]),
  actor: z.string().min(1),
  at: z.string().datetime({ offset: true }),
});
export type OpportunityAudit = z.infer<typeof OpportunityAuditSchema>;

const now = () => new Date().toISOString();
const dataFile = (directory: string) => join(directory, "opportunities.json");
const auditFile = (directory: string) =>
  join(directory, "opportunity-audit.json");

async function list<T>(path: string, schema: z.ZodType<T>) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed)) return [] as T[];
    return parsed.flatMap((item) => {
      const value = schema.safeParse(item);
      return value.success ? [value.data] : [];
    });
  } catch {
    return [] as T[];
  }
}

async function atomicWrite(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export class LocalOpportunityStore {
  constructor(
    private readonly directory: string,
    private readonly tenantId: string,
    private readonly maxRecords = 2_000,
  ) {}

  async list() {
    return (await list(dataFile(this.directory), OpportunitySchema)).filter(
      (item) => item.tenantId === this.tenantId,
    );
  }

  async create(input: {
    leadId: string;
    organization: string;
    problem: string;
    actor: string;
    technicalOwnerConfirmed?: boolean;
    evaluationAuthorized?: boolean;
  }) {
    const timestamp = now();
    const opportunity = OpportunitySchema.parse({
      schemaVersion: 1,
      opportunityId: randomUUID(),
      leadId: input.leadId,
      organization: input.organization,
      stage: "discovered",
      qualification: {
        problem: input.problem,
        technicalOwnerConfirmed: input.technicalOwnerConfirmed ?? false,
        evaluationAuthorized: input.evaluationAuthorized ?? false,
        budgetStatus: "unknown",
        timeline: "unknown",
      },
      evidenceRefs: [],
      tenantId: this.tenantId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const records = (await list(dataFile(this.directory), OpportunitySchema))
      .concat(opportunity)
      .slice(-this.maxRecords);
    await atomicWrite(dataFile(this.directory), records);
    await this.audit(opportunity.opportunityId, "created", input.actor);
    return opportunity;
  }

  async changeStage(
    opportunityId: string,
    stage: OpportunityStage,
    actor: string,
  ) {
    const records = await this.list();
    const current = records.find(
      (item) => item.opportunityId === opportunityId,
    );
    if (!current) throw new Error(`opportunity not found: ${opportunityId}`);
    const updated = OpportunitySchema.parse({
      ...current,
      stage,
      updatedAt: now(),
    });
    const all = (await list(dataFile(this.directory), OpportunitySchema)).map(
      (item) =>
        item.opportunityId === opportunityId && item.tenantId === this.tenantId
          ? updated
          : item,
    );
    await atomicWrite(dataFile(this.directory), all);
    await this.audit(opportunityId, "stage_changed", actor);
    return updated;
  }

  private async audit(
    opportunityId: string,
    action: OpportunityAudit["action"],
    actor: string,
  ) {
    const event = OpportunityAuditSchema.parse({
      eventId: randomUUID(),
      opportunityId,
      tenantId: this.tenantId,
      action,
      actor,
      at: now(),
    });
    await atomicWrite(
      auditFile(this.directory),
      (await list(auditFile(this.directory), OpportunityAuditSchema))
        .concat(event)
        .slice(-this.maxRecords),
    );
    return event;
  }
}
