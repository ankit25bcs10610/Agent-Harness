import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

export const SecurityControlStatusSchema = z.enum([
  "IMPLEMENTED_AND_TESTED",
  "IMPLEMENTED_UNVERIFIED",
  "PARTIAL",
  "MISSING",
  "BLOCKED",
]);

export const SecurityEvidenceSchema = z.object({
  version: z.literal(1),
  evidenceId: z.string().min(1),
  controlId: z.string().min(1),
  status: SecurityControlStatusSchema,
  source: z.string().min(1),
  sourceVersion: z.string().min(1),
  collectedAt: z.string().datetime(),
  environment: z.enum(["local", "test", "staging", "production"]),
  testStatus: z.enum(["passed", "failed", "not_run", "blocked"]),
  limitations: z.array(z.string().min(1)).max(20),
  reviewBy: z.string().datetime().optional(),
  summary: z.string().min(1).max(2000),
});

export type SecurityEvidence = z.infer<typeof SecurityEvidenceSchema>;

export type EvidenceQuery = {
  controlId?: string;
  status?: z.infer<typeof SecurityControlStatusSchema>;
};

export class LocalSecurityEvidenceStore {
  constructor(
    private readonly directory: string,
    private readonly maxRecords = 500,
  ) {
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1)
      throw new Error("maxRecords must be a positive safe integer");
  }

  private get path() {
    return join(this.directory, "security-evidence.json");
  }

  async record(input: SecurityEvidence): Promise<SecurityEvidence> {
    const evidence = SecurityEvidenceSchema.parse(input);
    const records = await this.read();
    const next = [
      ...records.filter((item) => item.evidenceId !== evidence.evidenceId),
      evidence,
    ].slice(-this.maxRecords);
    await this.write(next);
    return evidence;
  }

  async list(query: EvidenceQuery = {}): Promise<SecurityEvidence[]> {
    const records = await this.read();
    return records.filter(
      (item) =>
        (query.controlId === undefined || item.controlId === query.controlId) &&
        (query.status === undefined || item.status === query.status),
    );
  }

  async current(now = new Date()): Promise<SecurityEvidence[]> {
    const records = await this.read();
    return records.filter(
      (item) =>
        item.reviewBy === undefined ||
        Date.parse(item.reviewBy) >= now.getTime(),
    );
  }

  private async read(): Promise<SecurityEvidence[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, "utf8"));
      return z.array(SecurityEvidenceSchema).parse(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error(
        `unable to read security evidence: ${(error as Error).message}`,
      );
    }
  }

  private async write(records: SecurityEvidence[]) {
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }
}
