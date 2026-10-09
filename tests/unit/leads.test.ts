import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { LocalLeadStore } from "../../src/commercial";

test("local lead store requires consent and records auditable lifecycle changes", async () => {
  const store = new LocalLeadStore(
    await mkdtemp(join(tmpdir(), "chiku-leads-")),
  );
  await expect(
    store.create({
      email: "person@example.com",
      source: "website",
      consent: { marketing: false, productContact: false },
      actor: "user",
    }),
  ).rejects.toThrow("consent");
  const lead = await store.create({
    email: "person@example.com",
    organization: "Example",
    source: "website",
    consent: { marketing: false, productContact: true },
    actor: "user",
  });
  expect(lead.status).toBe("new");
  expect(
    (await store.updateStatus(lead.leadId, "qualified", "operator")).status,
  ).toBe("qualified");
  expect((await store.revoke(lead.leadId, "operator")).status).toBe("deleted");
  expect((await store.auditLog()).map((event) => event.action)).toEqual([
    "created",
    "status_changed",
    "status_changed",
  ]);
});
