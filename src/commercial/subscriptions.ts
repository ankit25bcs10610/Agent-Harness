import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const SubscriptionStatusSchema = z.enum([
  "trialing",
  "active",
  "past_due",
  "canceled",
  "expired",
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const SubscriptionSchema = z.object({
  schemaVersion: z.literal(1),
  subscriptionId: z.string().min(1),
  tenantId: z.string().min(1),
  planId: z.string().min(1),
  status: SubscriptionStatusSchema,
  seats: z.number().int().positive(),
  providerCustomerRef: z.string().min(1),
  providerSubscriptionRef: z.string().min(1),
  currentPeriodEnd: z.string().datetime({ offset: true }).nullable(),
  updatedAt: z.string().datetime({ offset: true }),
});
export type Subscription = z.infer<typeof SubscriptionSchema>;

export const VerifiedBillingEventSchema = z.object({
  eventId: z.string().min(1),
  tenantId: z.string().min(1),
  kind: z.enum([
    "subscription_started",
    "subscription_updated",
    "subscription_canceled",
  ]),
  verified: z.literal(true),
  subscription: SubscriptionSchema.omit({ updatedAt: true }),
  receivedAt: z.string().datetime({ offset: true }),
  providerOccurredAt: z.string().datetime({ offset: true }).optional(),
});
export type VerifiedBillingEvent = z.infer<typeof VerifiedBillingEventSchema>;

export const EntitlementSchema = z.object({
  tenantId: z.string().min(1),
  planId: z.string().min(1).nullable(),
  status: z.enum(["granted", "not_granted"]),
  seats: z.number().int().nonnegative(),
  reason: z.string().min(1),
});
export type Entitlement = z.infer<typeof EntitlementSchema>;

const subscriptionsFile = (directory: string) =>
  join(directory, "subscriptions.json");
const eventsFile = (directory: string) =>
  join(directory, "billing-events.json");
const now = () => new Date().toISOString();

async function atomicWrite(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function readArray<T>(path: string, schema: z.ZodType<T>) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(value)) return [] as T[];
    return value.flatMap((item) => {
      const parsed = schema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [] as T[];
  }
}

export class LocalSubscriptionStore {
  constructor(
    private readonly directory: string,
    private readonly tenantId: string,
  ) {}

  async subscription() {
    return (
      await readArray(subscriptionsFile(this.directory), SubscriptionSchema)
    ).find((item) => item.tenantId === this.tenantId);
  }

  async applyVerifiedEvent(input: unknown) {
    const event = VerifiedBillingEventSchema.parse(input);
    if (event.tenantId !== this.tenantId)
      throw new Error("billing tenant mismatch");
    const events = await readArray(
      eventsFile(this.directory),
      VerifiedBillingEventSchema,
    );
    if (events.some((item) => item.eventId === event.eventId))
      return {
        applied: false,
        reason: "duplicate" as const,
        subscription: await this.subscription(),
      };
    const current = await this.subscription();
    const incomingAt = Date.parse(event.providerOccurredAt ?? event.receivedAt);
    const currentAt = current ? Date.parse(current.updatedAt) : -Infinity;
    if (current && incomingAt < currentAt)
      return {
        applied: false,
        reason: "out_of_order" as const,
        subscription: current,
      };
    const subscription = SubscriptionSchema.parse({
      ...event.subscription,
      updatedAt: event.receivedAt,
    });
    const allSubscriptions = (
      await readArray(subscriptionsFile(this.directory), SubscriptionSchema)
    )
      .filter(
        (item) =>
          item.tenantId !== this.tenantId ||
          item.subscriptionId !== subscription.subscriptionId,
      )
      .concat(subscription);
    await atomicWrite(subscriptionsFile(this.directory), allSubscriptions);
    await atomicWrite(eventsFile(this.directory), events.concat(event));
    return { applied: true, reason: "applied" as const, subscription };
  }

  async entitlement(): Promise<Entitlement> {
    const subscription = await this.subscription();
    if (!subscription || !["trialing", "active"].includes(subscription.status))
      return EntitlementSchema.parse({
        tenantId: this.tenantId,
        planId: subscription?.planId ?? null,
        status: "not_granted",
        seats: 0,
        reason: subscription
          ? `subscription status is ${subscription.status}`
          : "no verified subscription",
      });
    return EntitlementSchema.parse({
      tenantId: this.tenantId,
      planId: subscription.planId,
      status: "granted",
      seats: subscription.seats,
      reason: "verified persisted subscription",
    });
  }
}
