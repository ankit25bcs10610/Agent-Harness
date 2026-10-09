import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  MemoryEvidenceSchema,
  MemoryPolicySchema,
  MemoryRecordSchema,
  MemoryScopeSchema,
  type MemoryEvidence,
  type MemoryPolicy,
  type MemoryRecord,
  type MemoryRetrieval,
  type MemoryScope,
} from "./types";

const now = () => new Date().toISOString();
const secret =
  /(?:api[_-]?key|token|secret|password|passwd|authorization|cookie|\.env|id_rsa|private key|sk-[a-z0-9])/i;
const terms = (value: string) =>
  new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/)
      .filter((term) => term.length > 2),
  );
const sameScope = (left: MemoryScope, right: MemoryScope) =>
  left.kind === right.kind && left.id === right.id;

async function atomicWrite(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export class LocalMemoryStore implements MemoryRetrieval {
  private readonly file: string;
  private records: MemoryRecord[] = [];
  private loaded = false;

  constructor(
    private readonly directory: string,
    private policy: MemoryPolicy = MemoryPolicySchema.parse({}),
  ) {
    this.file = join(directory, "memory.json");
  }

  async load() {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, "utf8"));
      this.records = Array.isArray(parsed)
        ? parsed.flatMap((item) => {
            const result = MemoryRecordSchema.safeParse(item);
            return result.success ? [result.data] : [];
          })
        : [];
    } catch {
      this.records = [];
    }
    this.loaded = true;
    await this.cleanup();
    return this;
  }

  setPolicy(policy: MemoryPolicy) {
    this.policy = MemoryPolicySchema.parse(policy);
  }

  currentPolicy() {
    return this.policy;
  }

  private async ensureLoaded() {
    if (!this.loaded) await this.load();
  }

  private validateSummary(summary: string) {
    if (secret.test(summary))
      throw new Error("memory summary contains sensitive material");
    if (/```|\b(?:import|export|function|class)\s+[A-Za-z_$]/.test(summary))
      throw new Error(
        "raw source content is not accepted as persistent memory",
      );
  }

  async add(input: {
    scope: MemoryScope;
    kind: MemoryRecord["kind"];
    summary: string;
    status?: MemoryRecord["status"];
    evidence?: MemoryEvidence[];
    sourceRevision?: string;
    expiresAt?: string;
  }): Promise<MemoryRecord | undefined> {
    await this.ensureLoaded();
    if (!this.policy.enabled) return undefined;
    const scope = MemoryScopeSchema.parse(input.scope);
    const summary = input.summary.trim();
    this.validateSummary(summary);
    const evidence = (input.evidence ?? []).map((item) =>
      MemoryEvidenceSchema.parse(item),
    );
    const status = input.status ?? "candidate";
    if (
      status === "verified" &&
      !evidence.some(
        (item) =>
          item.kind === "verification" || item.kind === "user_confirmation",
      )
    )
      throw new Error(
        "verified memory requires verification or user confirmation evidence",
      );
    if (
      status === "corrected" &&
      !evidence.some((item) => item.kind === "user_confirmation")
    )
      throw new Error("corrected memory requires user confirmation evidence");
    const timestamp = now();
    const record = MemoryRecordSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      scope,
      kind: input.kind,
      summary,
      status,
      evidence,
      ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    });
    const normalized = summary.toLowerCase();
    this.records = this.records.filter(
      (item) =>
        !(
          sameScope(item.scope, scope) &&
          item.summary.toLowerCase() === normalized
        ),
    );
    this.records.unshift(record);
    this.records = this.records.slice(0, this.policy.maxRecords);
    await this.persist();
    return record;
  }

  async list(scope: MemoryScope) {
    await this.ensureLoaded();
    if (!this.policy.enabled) return [];
    const parsedScope = MemoryScopeSchema.parse(scope);
    return this.records.filter((item) => sameScope(item.scope, parsedScope));
  }

  async retrieve(
    scope: MemoryScope,
    query: string,
    limit = this.policy.maxRetrieved,
  ) {
    await this.ensureLoaded();
    if (!this.policy.enabled) return [];
    const parsedScope = MemoryScopeSchema.parse(scope);
    const queryTerms = terms(query);
    return this.records
      .filter(
        (item) =>
          sameScope(item.scope, parsedScope) &&
          (item.status === "verified" || item.status === "corrected"),
      )
      .map((item) => ({
        item,
        score: [...terms(item.summary)].filter((term) => queryTerms.has(term))
          .length,
      }))
      .filter((entry) => entry.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.item.updatedAt.localeCompare(left.item.updatedAt),
      )
      .slice(0, Math.min(Math.max(1, limit), this.policy.maxRetrieved))
      .map((entry) => entry.item);
  }

  async correct(id: string, summary: string, reference: string) {
    await this.ensureLoaded();
    const current = this.records.find((item) => item.id === id);
    if (!current) throw new Error("memory record not found");
    this.validateSummary(summary);
    const updated = MemoryRecordSchema.parse({
      ...current,
      summary: summary.trim(),
      status: "corrected",
      evidence: [...current.evidence, { kind: "user_confirmation", reference }],
      updatedAt: now(),
    });
    this.records = this.records.map((item) =>
      item.id === id ? updated : item,
    );
    await this.persist();
    return updated;
  }

  async invalidateRevision(scope: MemoryScope, revision: string) {
    await this.ensureLoaded();
    const parsedScope = MemoryScopeSchema.parse(scope);
    const timestamp = now();
    this.records = this.records.map((item) =>
      sameScope(item.scope, parsedScope) &&
      item.sourceRevision &&
      item.sourceRevision !== revision
        ? {
            ...item,
            status: "invalidated" as const,
            invalidatedAt: timestamp,
            updatedAt: timestamp,
          }
        : item,
    );
    await this.persist();
  }

  async delete(id: string) {
    await this.ensureLoaded();
    const before = this.records.length;
    this.records = this.records.filter((item) => item.id !== id);
    if (before !== this.records.length) await this.persist();
    return before !== this.records.length;
  }

  async deleteScope(scope: MemoryScope) {
    await this.ensureLoaded();
    const parsedScope = MemoryScopeSchema.parse(scope);
    const before = this.records.length;
    this.records = this.records.filter(
      (item) => !sameScope(item.scope, parsedScope),
    );
    if (before !== this.records.length) await this.persist();
    return before - this.records.length;
  }

  async cleanup(at = Date.now()) {
    const cutoff = at - this.policy.maxAgeMs;
    const before = this.records.length;
    this.records = this.records
      .filter(
        (item) =>
          Date.parse(item.updatedAt) >= cutoff &&
          (!item.expiresAt || Date.parse(item.expiresAt) > at) &&
          item.status !== "invalidated" &&
          item.status !== "rejected",
      )
      .slice(0, this.policy.maxRecords);
    if (this.loaded && before !== this.records.length) await this.persist();
    return before - this.records.length;
  }

  private async persist() {
    await atomicWrite(this.file, this.records);
  }
}
