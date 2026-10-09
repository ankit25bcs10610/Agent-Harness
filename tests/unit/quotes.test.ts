import { expect, test } from "bun:test";
import { createQuote, transitionQuote } from "../../src/commercial";
import type { PricingPlan } from "../../src/commercial";

const plan: PricingPlan = {
  planId: "team-monthly",
  name: "Team",
  availability: "approved",
  currency: "USD",
  billingPeriod: "month",
  unit: "seat",
  amountMinor: 1200,
  trialDays: null,
  modelProviderCostsIncluded: false,
};

test("quote lifecycle requires approved pricing and human evidence", () => {
  const quote = createQuote({
    tenantId: "tenant-a",
    customerReference: "customer-a",
    plan,
    quantity: 3,
  });
  expect(quote.amountMinor).toBe(3600);
  expect(() =>
    transitionQuote({
      quote,
      next: "UNDER_REVIEW",
      actorTenantId: "tenant-a",
      actorRole: "customer",
    }),
  ).toThrow("commercial authorization");
  const reviewed = transitionQuote({
    quote,
    next: "UNDER_REVIEW",
    actorTenantId: "tenant-a",
    actorRole: "commercial_admin",
  });
  const approved = transitionQuote({
    quote: reviewed,
    next: "APPROVED",
    actorTenantId: "tenant-a",
    actorRole: "commercial_admin",
  });
  expect(() =>
    transitionQuote({
      quote: approved,
      next: "SENT",
      actorTenantId: "tenant-a",
      actorRole: "commercial_admin",
    }),
  ).toThrow("send evidence");
  const sent = transitionQuote({
    quote: approved,
    next: "SENT",
    actorTenantId: "tenant-a",
    actorRole: "commercial_admin",
    evidence: "operator-approved-send",
  });
  expect(() =>
    transitionQuote({
      quote: sent,
      next: "ACCEPTED",
      actorTenantId: "tenant-a",
      actorRole: "customer",
    }),
  ).toThrow("acceptance evidence");
  expect(
    transitionQuote({
      quote: sent,
      next: "ACCEPTED",
      actorTenantId: "tenant-a",
      actorRole: "customer",
      evidence: "customer-confirmation-ref",
    }).status,
  ).toBe("ACCEPTED");
});

test("quote lifecycle is tenant isolated and rejects unapproved plans", () => {
  expect(() =>
    createQuote({
      tenantId: "tenant-a",
      customerReference: "customer-a",
      plan: { ...plan, availability: "draft" },
      quantity: 1,
    }),
  ).toThrow("approved configured");
  const quote = createQuote({
    tenantId: "tenant-a",
    customerReference: "customer-a",
    plan,
    quantity: 1,
  });
  expect(() =>
    transitionQuote({
      quote,
      next: "UNDER_REVIEW",
      actorTenantId: "tenant-b",
      actorRole: "commercial_admin",
    }),
  ).toThrow("another tenant");
});
