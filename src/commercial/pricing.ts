import { z } from "zod";

export const PricingPlanSchema = z.object({
  planId: z.string().regex(/^[a-z][a-z0-9._-]{1,63}$/),
  name: z.string().min(1).max(100),
  availability: z.enum(["draft", "approved", "retired"]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  billingPeriod: z.enum(["month", "year", "one_time"]),
  unit: z.enum(["organization", "seat", "usage"]),
  amountMinor: z.number().int().nonnegative().nullable(),
  trialDays: z.number().int().nonnegative().max(365).nullable(),
  modelProviderCostsIncluded: z.boolean(),
});
export type PricingPlan = z.infer<typeof PricingPlanSchema>;

export const PricingCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  catalogId: z.string().min(1),
  effectiveAt: z.string().datetime({ offset: true }),
  approvedBy: z.string().min(1).nullable(),
  plans: z.array(PricingPlanSchema),
});
export type PricingCatalog = z.infer<typeof PricingCatalogSchema>;

export function validatePricingCatalog(value: unknown) {
  const catalog = PricingCatalogSchema.parse(value);
  const ids = new Set<string>();
  for (const plan of catalog.plans) {
    if (ids.has(plan.planId))
      throw new Error(`duplicate pricing plan: ${plan.planId}`);
    ids.add(plan.planId);
    if (
      plan.availability === "approved" &&
      (catalog.approvedBy === null || plan.amountMinor === null)
    )
      throw new Error(
        `approved plan ${plan.planId} requires an approver and configured amount`,
      );
  }
  return catalog;
}

export function quoteMinorUnits(plan: PricingPlan, quantity: number) {
  if (!Number.isSafeInteger(quantity) || quantity < 1)
    throw new Error("quantity must be a positive safe integer");
  if (plan.availability !== "approved" || plan.amountMinor === null)
    return {
      status: "unknown" as const,
      amountMinor: null,
      currency: plan.currency,
    };
  if (!Number.isSafeInteger(plan.amountMinor))
    throw new Error("pricing amount must be a safe integer");
  const amountMinor = plan.amountMinor * quantity;
  if (!Number.isSafeInteger(amountMinor))
    throw new Error("quote exceeds safe integer precision");
  return {
    status: "configured" as const,
    amountMinor,
    currency: plan.currency,
  };
}
