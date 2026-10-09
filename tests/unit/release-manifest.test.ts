import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  buildReleaseManifest,
  ReleaseManifestSchema,
  verifyReleaseManifest,
} from "../../src/release";

describe("release manifest", () => {
  test("records actual artifact size and digest", async () => {
    const directory = join(tmpdir(), `chiku-release-${crypto.randomUUID()}`);
    await mkdir(directory, { recursive: true });
    const artifact = join(directory, "chiku.js");
    await writeFile(artifact, "release candidate");

    const manifest = await buildReleaseManifest({
      version: "1.0.0",
      channel: "canary",
      sourceRevision: "abc123",
      sourceState: "clean",
      artifactPaths: [artifact],
      builtAt: "2026-10-09T00:00:00.000Z",
      runtime: { bun: "1.4.2", platform: "darwin", arch: "arm64" },
    });

    expect(ReleaseManifestSchema.parse(manifest)).toEqual(manifest);
    expect(manifest.artifacts[0]?.bytes).toBe(17);
    expect(manifest.artifacts[0]?.sha256).toBe(
      "4b5297a5261624acded347f2aec687e6e3ac4153d1a056c571e48b7651197d40",
    );
    expect(manifest.signing.status).toBe("not_signed");
    expect(manifest.artifacts[0]?.path).toEndWith("/chiku.js");
  });

  test("fails when an artifact is missing", async () => {
    await expect(
      buildReleaseManifest({
        version: "1.0.0",
        channel: "development",
        sourceRevision: "abc123",
        sourceState: "unknown",
        artifactPaths: [join(tmpdir(), "does-not-exist-chiku.js")],
      }),
    ).rejects.toThrow();
  });

  test("rejects a tampered artifact using recorded size and digest", async () => {
    const directory = join(tmpdir(), `chiku-release-${crypto.randomUUID()}`);
    await mkdir(directory, { recursive: true });
    const artifact = join(directory, "chiku.js");
    await writeFile(artifact, "original artifact");
    const manifest = await buildReleaseManifest({
      version: "1.0.0",
      channel: "stable",
      sourceRevision: "abc123",
      sourceState: "clean",
      artifactPaths: [artifact],
      builtAt: "2026-10-09T00:00:00.000Z",
      runtime: { bun: "1.4.2", platform: "darwin", arch: "arm64" },
    });
    await writeFile(artifact, "tampered artifact");
    const result = await verifyReleaseManifest(manifest, "/");
    expect(result.verified).toBe(false);
    expect(result.failures.join(" ")).toContain("sha256 mismatch");
  });
});
