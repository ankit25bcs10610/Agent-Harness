import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const FinancialEventKindSchema = z.enum([
  "charge",
  "refund",
  "payment_fee",
  "adjustment",
]);
export type FinancialEventKind = z.infer<typeof FinancialEventKindSchema>;

export const FinancialEventStateSchema = z.enum([
  "booked",
  "collected",
  "recognized",
]);
export type FinancialEventState = z.infer<typeof FinancialEventStateSchema>;

export const FinancialEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().uuid(),
  tenantId: z.string().min(1),
  providerEventId: z.string().min(1).optional(),
  kind: FinancialEventKindSchema,
  state: FinancialEventStateSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  amountMinor: z.number().int().nonnegative().finite(),
  verified: z.literal(true),
  occurredAt: z.string().datetime({ offset: true }),
  recordedAt: z.string().datetime({ offset: true }),
});
export type FinancialEvent = z.infer<typeof FinancialEventSchema>;

const ledgerFile = (directory: string) =>
  join(directory, "financial-ledger.json");

async function readLedger(path: string) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(value)) return [] as FinancialEvent[];
    return value.flatMap((item) => {
      const parsed = FinancialEventSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [] as FinancialEvent[];
  }
}

async function writeLedger(path: string, events: readonly FinancialEvent[]) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(events, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export type FinancialTotals = {
  currency: string;
  bookedMinor: number;
  collectedMinor: number;
  recognizedMinor: number;
};

/** Tenant-scoped append-only financial evidence. Values are integer minor units. */
export class LocalFinancialLedger {
  constructor(
    private readonly directory: string,
    private readonly tenantId: string,
  ) {}

  async list() {
    return (await readLedger(ledgerFile(this.directory))).filter(
      (event) => event.tenantId === this.tenantId,
    );
  }

  async append(
    input: Omit<
      FinancialEvent,
      "schemaVersion" | "eventId" | "tenantId" | "recordedAt"
    > & { eventId?: string },
  ) {
    const event = FinancialEventSchema.parse({
      schemaVersion: 1,
      eventId: input.eventId ?? randomUUID(),
      tenantId: this.tenantId,
      recordedAt: new Date().toISOString(),
      ...input,
    });
    const path = ledgerFile(this.directory);
    const events = await readLedger(path);
    const duplicate = events.find(
      (item) =>
        item.tenantId === this.tenantId &&
        (item.eventId === event.eventId ||
          (event.providerEventId !== undefined &&
            item.providerEventId === event.providerEventId)),
    );
    if (duplicate) return { applied: false as const, event: duplicate };
    await writeLedger(path, events.concat(event));
    return { applied: true as const, event };
  }

  async totals(): Promise<FinancialTotals[]> {
    const totals = new Map<string, FinancialTotals>();
    for (const event of await this.list()) {
      const current = totals.get(event.currency) ?? {
        currency: event.currency,
        bookedMinor: 0,
        collectedMinor: 0,
        recognizedMinor: 0,
      };
      const sign = event.kind === "charge" ? 1 : -1;
      const field = `${event.state}Minor` as
        "bookedMinor" | "collectedMinor" | "recognizedMinor";
      const value = current[field] + sign * event.amountMinor;
      if (!Number.isSafeInteger(value))
        throw new Error("financial total exceeds safe integer precision");
      current[field] = value;
      totals.set(event.currency, current);
    }
    return [...totals.values()].sort((left, right) =>
      left.currency.localeCompare(right.currency),
    );
  }
}
