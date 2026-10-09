import { randomUUID } from "node:crypto";
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
    updatedAt: new Date().toISOString(),
  });
}
