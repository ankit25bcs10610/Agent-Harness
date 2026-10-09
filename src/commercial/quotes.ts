import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { quoteMinorUnits, type PricingPlan } from "./pricing";

export const QuoteStatusSchema = z.enum([
  "DRAFT",
  "UNDER_REVIEW",
  "APPROVED",
  "SENT",
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
]);
export type QuoteStatus = z.infer<typeof QuoteStatusSchema>;

export const QuoteSchema = z.object({
  schemaVersion: z.literal(1),
  quoteId: z.string().uuid(),
  tenantId: z.string().min(1),
  customerReference: z.string().min(1).max(200),
  planId: z.string().min(1),
  currency: z.string().length(3),
  quantity: z.number().int().positive(),
  amountMinor: z.number().int().nonnegative(),
  revision: z.number().int().positive().default(1),
  status: QuoteStatusSchema,
  evidence: z.array(z.string().min(1).max(500)).max(20),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type Quote = z.infer<typeof QuoteSchema>;

const transitions: Record<QuoteStatus, readonly QuoteStatus[]> = {
  DRAFT: ["UNDER_REVIEW", "EXPIRED"],
  UNDER_REVIEW: ["APPROVED", "DECLINED", "EXPIRED"],
  APPROVED: ["SENT", "EXPIRED"],
  SENT: ["ACCEPTED", "DECLINED", "EXPIRED"],
  ACCEPTED: [],
  DECLINED: [],
  EXPIRED: [],
};

const quoteFile = (directory: string) => join(directory, "quotes.json");

async function readQuotes(path: string) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(value)) return [] as Quote[];
    return value.flatMap((entry) => {
      const parsed = QuoteSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [] as Quote[];
  }
}

async function writeQuotes(path: string, quotes: readonly Quote[]) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(quotes, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export function createQuote(input: {
  tenantId: string;
  customerReference: string;
  plan: PricingPlan;
  quantity: number;
  now?: Date;
}): Quote {
  const total = quoteMinorUnits(input.plan, input.quantity);
  if (total.status !== "configured" || total.amountMinor === null)
    throw new Error("quote requires an approved configured pricing plan");
  const timestamp = (input.now ?? new Date()).toISOString();
  return QuoteSchema.parse({
    schemaVersion: 1,
    quoteId: randomUUID(),
    tenantId: input.tenantId,
    customerReference: input.customerReference,
    planId: input.plan.planId,
    currency: total.currency,
    quantity: input.quantity,
    amountMinor: total.amountMinor,
    revision: 1,
    status: "DRAFT",
    evidence: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function transitionQuote(input: {
  quote: Quote;
  next: QuoteStatus;
  actorTenantId: string;
  actorRole: "commercial_admin" | "customer";
  evidence?: string;
}): Quote {
  const quote = QuoteSchema.parse(input.quote);
  if (quote.tenantId !== input.actorTenantId)
    throw new Error("quote belongs to another tenant");
  const next = QuoteStatusSchema.parse(input.next);
  if (!transitions[quote.status].includes(next))
    throw new Error(`invalid quote transition: ${quote.status} -> ${next}`);
  if (
    ["UNDER_REVIEW", "APPROVED", "SENT"].includes(next) &&
    input.actorRole !== "commercial_admin"
  )
    throw new Error("commercial authorization required");
  if (
    next === "ACCEPTED" &&
    (!input.evidence || input.actorRole !== "customer")
  )
    throw new Error("customer acceptance evidence is required");
  if (next === "SENT" && !input.evidence)
    throw new Error("send evidence is required");
  return QuoteSchema.parse({
    ...quote,
    status: next,
    evidence: input.evidence
      ? [...quote.evidence, input.evidence]
      : quote.evidence,
    revision: quote.revision + 1,
    updatedAt: new Date().toISOString(),
  });
}

/** Tenant-scoped local quote persistence with append-only revisions. */
export class LocalQuoteStore {
  constructor(
    private readonly directory: string,
    private readonly tenantId: string,
  ) {}

  async create(input: Parameters<typeof createQuote>[0]) {
    if (input.tenantId !== this.tenantId)
      throw new Error("quote belongs to another tenant");
    const quote = createQuote(input);
    await writeQuotes(
      quoteFile(this.directory),
      (await readQuotes(quoteFile(this.directory))).concat(quote),
    );
    return quote;
  }

  async get(quoteId: string) {
    const revisions = await this.history(quoteId);
    return revisions.at(-1);
  }

  async history(quoteId: string) {
    const quotes = (await readQuotes(quoteFile(this.directory))).filter(
      (quote) => quote.tenantId === this.tenantId && quote.quoteId === quoteId,
    );
    return quotes.sort((left, right) => left.revision - right.revision);
  }

  async transition(input: {
    quoteId: string;
    next: QuoteStatus;
    actorRole: "commercial_admin" | "customer";
    evidence?: string;
    expectedRevision: number;
  }) {
    const current = await this.get(input.quoteId);
    if (!current) throw new Error(`quote not found: ${input.quoteId}`);
    if (current.revision !== input.expectedRevision)
      throw new Error(
        `stale quote revision: expected ${input.expectedRevision}, current ${current.revision}`,
      );
    const next = transitionQuote({
      quote: current,
      next: input.next,
      actorTenantId: this.tenantId,
      actorRole: input.actorRole,
      ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
    });
    const all = await readQuotes(quoteFile(this.directory));
    await writeQuotes(quoteFile(this.directory), all.concat(next));
    return next;
  }
}
