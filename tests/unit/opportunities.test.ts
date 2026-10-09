import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { LocalOpportunityStore } from "../../src/commercial";

test("opportunity lifecycle is tenant-scoped and evidence-backed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chiku-opportunities-"));
  const store = new LocalOpportunityStore(directory, "tenant-a");
  const opportunity = await store.create({
    leadId: crypto.randomUUID(),
    organization: "Example",
    problem: "Reduce verification time",
    actor: "operator",
  });
  expect((await store.list()).map((item) => item.opportunityId)).toEqual([
    opportunity.opportunityId,
  ]);
  expect(
    (
      await store.changeStage(
        opportunity.opportunityId,
        "evaluation",
        "operator",
      )
    ).stage,
  ).toBe("evaluation");
  await expect(
    new LocalOpportunityStore(directory, "tenant-b").list(),
  ).resolves.toEqual([]);
});
