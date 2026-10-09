import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  PluginManifestSchema,
  validatePluginManifest,
  type PluginManifest,
} from "./manifest";

export const PluginReviewStateSchema = z.enum([
  "SUBMITTED",
  "VALIDATING",
  "SECURITY_REVIEW",
  "MAINTAINER_REVIEW",
  "APPROVED",
  "REJECTED",
  "QUARANTINED",
  "DEPRECATED",
  "REVOKED",
]);
export type PluginReviewState = z.infer<typeof PluginReviewStateSchema>;

export const PluginRegistryRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    submissionId: z.string().uuid(),
    manifest: PluginManifestSchema,
    packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
    packageSize: z.number().int().positive(),
    publisherId: z.string().min(1).max(200),
    state: PluginReviewStateSchema,
    submittedAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    reviewerId: z.string().min(1).max(200).optional(),
    reason: z.string().max(2_000).optional(),
  })
  .strict();
export type PluginRegistryRecord = z.infer<typeof PluginRegistryRecordSchema>;

const transitions: Record<PluginReviewState, readonly PluginReviewState[]> = {
  SUBMITTED: ["VALIDATING", "REJECTED"],
  VALIDATING: ["SECURITY_REVIEW", "REJECTED", "QUARANTINED"],
  SECURITY_REVIEW: ["MAINTAINER_REVIEW", "REJECTED", "QUARANTINED"],
  MAINTAINER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["DEPRECATED", "REVOKED"],
  REJECTED: [],
  QUARANTINED: ["SECURITY_REVIEW", "REVOKED"],
  DEPRECATED: ["REVOKED"],
  REVOKED: [],
};

const stamp = () => new Date().toISOString();
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

export function verifyPackageIntegrity(
  bytes: Uint8Array,
  expectedSha256: string,
) {
  const expected = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(expectedSha256);
  if (digest(bytes) !== expected)
    throw new Error("package integrity hash mismatch");
  return true;
}

export function validateArchiveEntries(
  entries: readonly {
    path: string;
    type?: "file" | "directory" | "symlink";
    linkTarget?: string;
  }[],
) {
  for (const entry of entries) {
    if (
      !entry.path ||
      entry.path.includes("\0") ||
      entry.path.startsWith("/") ||
      entry.path.includes("\\")
    )
      throw new Error("archive contains an unsafe path");
    const parts = entry.path.split("/");
    if (parts.includes("..") || parts.includes("."))
      throw new Error("archive contains path traversal");
    if (entry.type === "symlink")
      throw new Error("archive symlinks are not supported");
    if (entry.linkTarget !== undefined)
      throw new Error("archive link targets are not supported");
  }
  return true;
}

async function atomicWrite(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export class LocalPluginRegistry {
  private readonly records = new Map<string, PluginRegistryRecord>();
  private readonly publishers = new Map<string, string>();

  constructor(
    private readonly directory: string,
    private readonly options: {
      chikuApiVersion: string;
      platform: NodeJS.Platform;
    },
  ) {}

  registerPublisher(publisherId: string, token: string) {
    if (!publisherId.trim() || token.length < 16)
      throw new Error("publisher identity is invalid");
    this.publishers.set(publisherId, digest(token));
  }

  authenticatePublisher(publisherId: string, token: string) {
    return this.publishers.get(publisherId) === digest(token);
  }

  async submit(input: {
    publisherId: string;
    publisherToken: string;
    manifest: unknown;
    packageBytes: Uint8Array;
    archiveEntries: readonly {
      path: string;
      type?: "file" | "directory" | "symlink";
      linkTarget?: string;
    }[];
  }) {
    if (!this.authenticatePublisher(input.publisherId, input.publisherToken))
      throw new Error("publisher authentication failed");
    const manifest = PluginManifestSchema.parse(input.manifest);
    if (manifest.publisher.id !== input.publisherId)
      throw new Error("publisher does not own the manifest namespace");
    validatePluginManifest(manifest, this.options);
    validateArchiveEntries(input.archiveEntries);
    const packageSha256 = digest(input.packageBytes);
    if (manifest.integrity?.sha256 !== packageSha256)
      throw new Error("manifest integrity does not match package");
    const existing = [...this.records.values()].find(
      (record) =>
        record.manifest.id === manifest.id &&
        record.manifest.version === manifest.version,
    );
    if (existing && existing.publisherId !== input.publisherId)
      throw new Error("publisher cannot overwrite another publisher's package");
    const timestamp = stamp();
    const record = PluginRegistryRecordSchema.parse({
      schemaVersion: 1,
      submissionId: randomUUID(),
      manifest,
      packageSha256,
      packageSize: input.packageBytes.byteLength,
      publisherId: input.publisherId,
      state: "SUBMITTED",
      submittedAt: timestamp,
      updatedAt: timestamp,
    });
    this.records.set(`${manifest.id}@${manifest.version}`, record);
    await atomicWrite(
      join(this.directory, `${manifest.id}-${manifest.version}.json`),
      record,
    );
    return record;
  }

  async review(input: {
    id: string;
    version: string;
    reviewerId: string;
    state: PluginReviewState;
    reason?: string;
  }) {
    const key = `${input.id}@${input.version}`;
    const record = this.records.get(key) ?? (await this.load(key));
    if (!record) throw new Error("plugin submission not found");
    if (!record.submissionId) throw new Error("invalid plugin submission");
    if (record.publisherId === input.reviewerId)
      throw new Error("publisher cannot review its own submission");
    if (!transitions[record.state].includes(input.state))
      throw new Error(
        `illegal plugin review transition: ${record.state} -> ${input.state}`,
      );
    const updated = PluginRegistryRecordSchema.parse({
      ...record,
      state: input.state,
      reviewerId: input.reviewerId,
      updatedAt: stamp(),
      ...(input.reason ? { reason: input.reason } : {}),
    });
    this.records.set(key, updated);
    await atomicWrite(
      join(this.directory, `${input.id}-${input.version}.json`),
      updated,
    );
    return updated;
  }

  search(query = "") {
    const normalized = query.toLowerCase();
    return [...this.records.values()].filter(
      (record) =>
        record.state === "APPROVED" &&
        (!normalized ||
          `${record.manifest.id} ${record.manifest.name} ${record.manifest.description}`
            .toLowerCase()
            .includes(normalized)),
    );
  }

  async revoke(
    id: string,
    version: string,
    reviewerId: string,
    reason: string,
  ) {
    return this.review({ id, version, reviewerId, state: "REVOKED", reason });
  }

  private async load(key: string) {
    const [id, version] = key.split("@");
    if (!id || !version) return undefined;
    try {
      const record = PluginRegistryRecordSchema.parse(
        JSON.parse(
          await readFile(join(this.directory, `${id}-${version}.json`), "utf8"),
        ),
      );
      this.records.set(key, record);
      return record;
    } catch {
      return undefined;
    }
  }
}
