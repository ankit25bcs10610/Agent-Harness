import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";

export const UpdateChannelSchema = z.enum(["stable", "beta", "nightly"]);
export type UpdateChannel = z.infer<typeof UpdateChannelSchema>;

const VersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

export const UpdateArtifactSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9._-]+$/),
  version: VersionSchema,
  channel: UpdateChannelSchema,
  platform: z.enum(["darwin", "linux", "win32"]),
  arch: z.enum(["arm64", "x64", "ia32"]),
  runtime: z.object({ name: z.literal("bun"), minimumVersion: VersionSchema }),
  installMethod: z.enum(["package", "binary"]),
  url: z
    .string()
    .url()
    .refine((value) => value.startsWith("https://"), {
      message: "update artifacts must use HTTPS",
    }),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type UpdateArtifact = z.infer<typeof UpdateArtifactSchema>;

export const UpdateMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  product: z.literal("Chiku"),
  channel: UpdateChannelSchema,
  generatedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  artifacts: z.array(UpdateArtifactSchema).min(1).max(100),
  signature: z.object({
    algorithm: z.literal("ed25519"),
    keyId: z.string().min(1).max(128),
    value: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
  }),
});
export type UpdateMetadata = z.infer<typeof UpdateMetadataSchema>;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortKeys(entry)]),
  );
}

export function canonicalUpdatePayload(metadata: UpdateMetadata) {
  const { signature: _signature, ...unsigned } = metadata;
  return JSON.stringify(sortKeys(unsigned));
}

export function verifyUpdateMetadata(
  input: unknown,
  trustedKeys: Readonly<Record<string, string>>,
  now = new Date(),
) {
  const metadata = UpdateMetadataSchema.parse(input);
  if (Date.parse(metadata.expiresAt) <= now.getTime()) {
    return { verified: false as const, reason: "metadata expired" };
  }
  if (Date.parse(metadata.generatedAt) > now.getTime()) {
    return { verified: false as const, reason: "metadata is from the future" };
  }
  const pem = trustedKeys[metadata.signature.keyId];
  if (!pem) return { verified: false as const, reason: "unknown signing key" };
  try {
    const valid = verify(
      null,
      Buffer.from(canonicalUpdatePayload(metadata)),
      createPublicKey(pem),
      Buffer.from(metadata.signature.value, "base64"),
    );
    return valid
      ? { verified: true as const, metadata }
      : { verified: false as const, reason: "invalid metadata signature" };
  } catch {
    return {
      verified: false as const,
      reason: "invalid signing key or signature",
    };
  }
}

function compareVersions(left: string, right: string) {
  const parse = (value: string) => {
    const [core = "", prerelease = ""] = value.split("-", 2);
    return {
      core: core.split(".").map(Number),
      prerelease,
    };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index])
      return (a.core[index] ?? 0) - (b.core[index] ?? 0);
  }
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

export function selectCompatibleUpdate(
  metadata: UpdateMetadata,
  input: {
    channel: UpdateChannel;
    currentVersion: string;
    platform: UpdateArtifact["platform"];
    arch: UpdateArtifact["arch"];
    runtime: { name: "bun"; version: string };
  },
) {
  const valid = UpdateMetadataSchema.parse(metadata);
  if (valid.channel !== input.channel) return undefined;
  return valid.artifacts.find(
    (artifact) =>
      artifact.channel === input.channel &&
      artifact.platform === input.platform &&
      artifact.arch === input.arch &&
      artifact.runtime.name === input.runtime.name &&
      compareVersions(input.runtime.version, artifact.runtime.minimumVersion) >=
        0 &&
      compareVersions(artifact.version, input.currentVersion) > 0,
  );
}

export async function stageUpdateArtifact(
  artifact: UpdateArtifact,
  directory: string,
  download: (url: string, signal?: AbortSignal) => Promise<Uint8Array>,
  signal?: AbortSignal,
) {
  const valid = UpdateArtifactSchema.parse(artifact);
  if (valid.bytes > 100 * 1024 * 1024)
    throw new Error("update artifact exceeds the staging size limit");
  if (signal?.aborted) throw new Error("update staging cancelled");
  const bytes = await download(valid.url, signal);
  if (bytes.byteLength !== valid.bytes) throw new Error("update size mismatch");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== valid.sha256) throw new Error("update sha256 mismatch");
  await mkdir(directory, { recursive: true });
  const destination = join(
    directory,
    `${basename(valid.id)}-${valid.version}.artifact`,
  );
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
    await rename(temporary, destination);
    return destination;
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function readStagedArtifact(path: string) {
  return readFile(path);
}
