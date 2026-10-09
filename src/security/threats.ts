import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const ThreatStatusSchema = z.enum([
  "open",
  "mitigated",
  "accepted",
  "blocked",
]);
export const ThreatSeveritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export const ThreatModelEntrySchema = z.object({
  version: z.literal(1),
  threatId: z.string().min(1),
  asset: z.string().min(1),
  entryPoint: z.string().min(1),
  trustBoundary: z.string().min(1),
  impact: z.string().min(1).max(2000),
  likelihood: z.enum(["unlikely", "possible", "likely"]),
  severity: ThreatSeveritySchema,
  mitigation: z.string().min(1).max(2000),
  evidenceIds: z.array(z.string().min(1)).max(20),
  residualRisk: z.string().min(1).max(2000),
  owner: z.string().min(1),
  status: ThreatStatusSchema,
  reviewedAt: z.string().datetime(),
  reviewBy: z.string().datetime().optional(),
});

export type ThreatModelEntry = z.infer<typeof ThreatModelEntrySchema>;

export class LocalThreatModelStore {
  constructor(
    private readonly directory: string,
    private readonly maxEntries = 500,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1)
      throw new Error("maxEntries must be a positive safe integer");
  }

  private get path() {
    return join(this.directory, "threat-model.json");
  }

  async upsert(input: ThreatModelEntry): Promise<ThreatModelEntry> {
    const entry = ThreatModelEntrySchema.parse(input);
    const entries = await this.read();
    const next = [
      ...entries.filter((item) => item.threatId !== entry.threatId),
      entry,
    ].slice(-this.maxEntries);
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
    return entry;
  }

  async list(
    status?: z.infer<typeof ThreatStatusSchema>,
  ): Promise<ThreatModelEntry[]> {
    const entries = await this.read();
    return status === undefined
      ? entries
      : entries.filter((entry) => entry.status === status);
  }

  async dueForReview(now = new Date()): Promise<ThreatModelEntry[]> {
    return (await this.read()).filter(
      (entry) =>
        entry.reviewBy !== undefined &&
        Date.parse(entry.reviewBy) < now.getTime(),
    );
  }

  private async read(): Promise<ThreatModelEntry[]> {
    try {
      return z
        .array(ThreatModelEntrySchema)
        .parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error(
        `unable to read threat model: ${(error as Error).message}`,
      );
    }
  }
}
