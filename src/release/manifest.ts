import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

export const ReleaseArtifactSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const ReleaseManifestSchema = z.object({
  schemaVersion: z.literal(1),
  product: z.literal("Chiku"),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  channel: z.enum(["development", "canary", "stable"]),
  builtAt: z.string().datetime({ offset: true }),
  sourceRevision: z.string().min(1),
  sourceState: z.enum(["clean", "modified", "unknown"]),
  runtime: z.object({
    bun: z.string().min(1),
    platform: z.string().min(1),
    arch: z.string().min(1),
  }),
  artifacts: z.array(ReleaseArtifactSchema).min(1),
  signing: z.object({
    status: z.literal("not_signed"),
    note: z.string().min(1),
  }),
});

export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;

function isOutside(baseDirectory: string, candidate: string) {
  const relativePath = relative(baseDirectory, candidate);
  return (
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  );
}

export async function buildReleaseManifest(input: {
  version: string;
  channel: ReleaseManifest["channel"];
  sourceRevision: string;
  sourceState: ReleaseManifest["sourceState"];
  artifactPaths: readonly string[];
  baseDirectory?: string;
  builtAt?: string;
  runtime?: { bun: string; platform: string; arch: string };
}): Promise<ReleaseManifest> {
  const baseDirectory = await realpath(input.baseDirectory ?? process.cwd());
  const artifacts = [];
  for (const artifactPath of input.artifactPaths) {
    const path = await realpath(resolve(artifactPath));
    if (isOutside(baseDirectory, path)) {
      throw new Error(
        `release artifact must be inside ${baseDirectory}: ${artifactPath}`,
      );
    }
    const data = await readFile(path);
    artifacts.push({
      name: basename(path),
      path: relative(baseDirectory, path).split("\\").join("/"),
      bytes: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
    });
  }

  return ReleaseManifestSchema.parse({
    schemaVersion: 1,
    product: "Chiku",
    version: input.version,
    channel: input.channel,
    builtAt: input.builtAt ?? new Date().toISOString(),
    sourceRevision: input.sourceRevision,
    sourceState: input.sourceState,
    runtime: input.runtime ?? {
      bun: Bun.version,
      platform: process.platform,
      arch: process.arch,
    },
    artifacts,
    signing: {
      status: "not_signed",
      note: "This manifest provides integrity hashes only; a trusted release signature is not configured.",
    },
  });
}

export async function verifyReleaseManifest(
  manifest: ReleaseManifest,
  baseDirectory = process.cwd(),
) {
  const verified = ReleaseManifestSchema.parse(manifest);
  const resolvedBaseDirectory = await realpath(baseDirectory).catch(() => null);
  const failures: string[] = [];
  if (!resolvedBaseDirectory) {
    return {
      verified: false,
      failures: ["release base directory unavailable"],
    };
  }
  for (const artifact of verified.artifacts) {
    if (isAbsolute(artifact.path)) {
      failures.push(`${artifact.name}: absolute artifact path is not allowed`);
      continue;
    }
    const path = resolve(resolvedBaseDirectory, artifact.path);
    try {
      const realArtifactPath = await realpath(path);
      if (isOutside(resolvedBaseDirectory, realArtifactPath)) {
        failures.push(`${artifact.name}: artifact escapes release directory`);
        continue;
      }
      const data = await readFile(realArtifactPath);
      const digest = createHash("sha256").update(data).digest("hex");
      if (data.byteLength !== artifact.bytes)
        failures.push(`${artifact.name}: byte length mismatch`);
      if (digest !== artifact.sha256)
        failures.push(`${artifact.name}: sha256 mismatch`);
    } catch {
      failures.push(`${artifact.name}: artifact unavailable`);
    }
  }
  return { verified: failures.length === 0, failures };
}
