import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  createFeedbackDraft,
  deleteFeedbackDraft,
  listFeedbackDrafts,
  saveFeedbackDraft,
} from "../../src/beta";

describe("privacy-first feedback drafts", () => {
  test("redacts provider secrets and requires explicit submission consent", async () => {
    const directory = join(tmpdir(), `chiku-feedback-${randomUUID()}`);
    await mkdir(directory, { recursive: true });
    const draft = createFeedbackDraft({
      category: "provider",
      summary: "Provider failed sk-or-v1-secret",
      reproduction: "No private source included",
      environment: "test",
      chikuVersion: "1.0.0",
      consentToSubmit: false,
    });
    const path = await saveFeedbackDraft(draft, directory);
    expect(await readFile(path, "utf8")).not.toContain("sk-or-v1-secret");
    expect((await listFeedbackDrafts(directory))[0]?.consentToSubmit).toBe(
      false,
    );
    await deleteFeedbackDraft(draft.id, directory);
    expect(await listFeedbackDrafts(directory)).toHaveLength(0);
    await rm(directory, { recursive: true, force: true });
  });
});
