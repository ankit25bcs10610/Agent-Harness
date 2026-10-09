import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { redactProviderSecrets } from "../provider/errors";

export const FeedbackCategorySchema = z.enum([
  "bug",
  "installation",
  "provider",
  "ux",
  "performance",
  "feature",
  "security",
]);
export const FeedbackDraftSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  category: FeedbackCategorySchema,
  summary: z.string().trim().min(1).max(500),
  reproduction: z.string().trim().max(4_000),
  environment: z.string().trim().max(500),
  chikuVersion: z.string().trim().max(100),
  consentToSubmit: z.boolean(),
});
export type FeedbackDraft = z.infer<typeof FeedbackDraftSchema>;

function bounded(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function createFeedbackDraft(
  input: Omit<FeedbackDraft, "version" | "id" | "createdAt">,
  now = new Date(),
): FeedbackDraft {
  return FeedbackDraftSchema.parse(
    redactProviderSecrets({
      version: 1,
      id: randomUUID(),
      createdAt: now.toISOString(),
      category: input.category,
      summary: bounded(input.summary, 500),
      reproduction: bounded(input.reproduction, 4_000),
      environment: bounded(input.environment, 500),
      chikuVersion: bounded(input.chikuVersion, 100),
      consentToSubmit: input.consentToSubmit,
    }),
  );
}

export async function saveFeedbackDraft(
  draft: FeedbackDraft,
  directory: string,
) {
  const valid = FeedbackDraftSchema.parse(draft);
  await mkdir(directory, { recursive: true });
  const destination = join(directory, `${valid.id}.json`);
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, `${JSON.stringify(valid, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, destination);
  return destination;
}

export async function listFeedbackDrafts(
  directory: string,
): Promise<FeedbackDraft[]> {
  const files = await readdir(directory).catch(() => []);
  const drafts: FeedbackDraft[] = [];
  for (const file of files.filter((entry) => entry.endsWith(".json"))) {
    try {
      drafts.push(
        FeedbackDraftSchema.parse(
          JSON.parse(await readFile(join(directory, file), "utf8")),
        ),
      );
    } catch {
      // Invalid drafts are omitted and never treated as submitted feedback.
    }
  }
  return drafts.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

export async function deleteFeedbackDraft(id: string, directory: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id))
    throw new Error("invalid feedback identifier");
  await rm(join(directory, `${id}.json`), { force: true });
}
