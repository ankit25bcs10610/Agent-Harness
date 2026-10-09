import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { LocalSubscriptionStore } from "../../src/commercial";

const event = (tenantId = "tenant-a", eventId = "evt-1") => ({
  eventId,
  tenantId,
  kind: "subscription_started",
  verified: true,
  subscription: {
    schemaVersion: 1,
    subscriptionId: "sub-1",
    tenantId,
    planId: "developer",
    status: "active",
    seats: 2,
    providerCustomerRef: "cus-1",
    providerSubscriptionRef: "psub-1",
    currentPeriodEnd: null,
  },
  receivedAt: "2026-10-09T00:00:00.000Z",
});

test("verified subscription events are tenant-scoped and idempotent", async () => {
  const store = new LocalSubscriptionStore(
    await mkdtemp(join(tmpdir(), "chiku-billing-")),
    "tenant-a",
  );
  expect((await store.applyVerifiedEvent(event())).applied).toBe(true);
  expect((await store.applyVerifiedEvent(event())).applied).toBe(false);
  expect(await store.entitlement()).toMatchObject({
    status: "granted",
    seats: 2,
  });
  await expect(
    store.applyVerifiedEvent(event("tenant-b", "evt-2")),
  ).rejects.toThrow("tenant mismatch");
});

test("unverified billing signals are rejected", async () => {
  const store = new LocalSubscriptionStore(
    await mkdtemp(join(tmpdir(), "chiku-billing-")),
    "tenant-a",
  );
  await expect(
    store.applyVerifiedEvent({ ...event(), verified: false }),
  ).rejects.toThrow();
  expect(await store.entitlement()).toMatchObject({
    status: "not_granted",
    seats: 0,
  });
});

test("older verified provider events cannot overwrite newer subscription state", async () => {
  const store = new LocalSubscriptionStore(
    await mkdtemp(join(tmpdir(), "chiku-billing-")),
    "tenant-a",
  );
  await store.applyVerifiedEvent({
    ...event("tenant-a", "evt-new"),
    subscription: { ...event().subscription, status: "active" },
    providerOccurredAt: "2026-10-09T02:00:00.000Z",
    receivedAt: "2026-10-09T02:01:00.000Z",
  });
  const result = await store.applyVerifiedEvent({
    ...event("tenant-a", "evt-old"),
    subscription: { ...event().subscription, status: "canceled" },
    providerOccurredAt: "2026-10-09T01:00:00.000Z",
    receivedAt: "2026-10-09T03:00:00.000Z",
  });
  expect(result).toMatchObject({ applied: false, reason: "out_of_order" });
  expect((await store.subscription())?.status).toBe("active");
});
