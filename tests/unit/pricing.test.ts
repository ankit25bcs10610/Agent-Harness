import { expect, test } from "bun:test";
import { quoteMinorUnits, validatePricingCatalog } from "../../src/commercial";

const plan = {
  planId: "developer",
  name: "Developer",
  availability: "approved",
  currency: "USD",
  billingPeriod: "month",
  unit: "organization",
  amountMinor: 1250,
  trialDays: null,
  modelProviderCostsIncluded: false,
} as const;

test("pricing catalog validates approval and calculates integer minor-unit quotes", () => {
  const catalog = validatePricingCatalog({
    schemaVersion: 1,
    catalogId: "fixture",
    effectiveAt: "2026-10-09T00:00:00.000Z",
    approvedBy: "operator",
    plans: [plan],
  });
  expect(quoteMinorUnits(catalog.plans[0]!, 3)).toEqual({
    status: "configured",
    amountMinor: 3750,
    currency: "USD",
  });
});

test("unapproved or unknown pricing never becomes a zero quote", () => {
  const unknown = {
    ...plan,
    availability: "draft",
    amountMinor: null,
  } as const;
  expect(() =>
    validatePricingCatalog({
      schemaVersion: 1,
      catalogId: "fixture",
      effectiveAt: "2026-10-09T00:00:00.000Z",
      approvedBy: null,
      plans: [unknown],
    }),
  ).not.toThrow();
  expect(quoteMinorUnits(unknown, 1)).toEqual({
    status: "unknown",
    amountMinor: null,
    currency: "USD",
  });
});
