import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFinancialLedger } from "../../src/commercial";

const financialEvent = (
  providerEventId: string,
  kind: "charge" | "refund" = "charge",
) => ({
  providerEventId,
  kind,
  state: "collected" as const,
  currency: "USD",
  amountMinor: 1250,
  verified: true as const,
  occurredAt: "2026-10-09T00:00:00.000Z",
});

test("financial ledger is tenant scoped, idempotent, and currency separated", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chiku-ledger-"));
  const ledger = new LocalFinancialLedger(directory, "tenant-a");
  expect((await ledger.append(financialEvent("payment-1"))).applied).toBe(true);
  expect((await ledger.append(financialEvent("payment-1"))).applied).toBe(
    false,
  );
  await ledger.append({
    ...financialEvent("refund-1", "refund"),
    currency: "EUR",
    amountMinor: 500,
  });
  expect(await ledger.totals()).toEqual([
    {
      currency: "EUR",
      bookedMinor: 0,
      collectedMinor: -500,
      recognizedMinor: 0,
    },
    {
      currency: "USD",
      bookedMinor: 0,
      collectedMinor: 1250,
      recognizedMinor: 0,
    },
  ]);
});

test("financial ledger rejects unverified or unsafe money input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chiku-ledger-"));
  const ledger = new LocalFinancialLedger(directory, "tenant-a");
  await expect(
    ledger.append({
      ...financialEvent("bad"),
      verified: false as unknown as true,
    }),
  ).rejects.toThrow();
  await expect(
    ledger.append({ ...financialEvent("bad"), amountMinor: 0.5 }),
  ).rejects.toThrow();
});
