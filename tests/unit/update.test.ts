import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  canonicalUpdatePayload,
  selectCompatibleUpdate,
  stageUpdateArtifact,
  UpdateMetadataSchema,
  verifyUpdateMetadata,
} from "../../src/update";

const now = "2026-10-09T12:00:00.000Z";
const artifactBytes = new TextEncoder().encode("verified update artifact");

function metadata() {
  const unsigned = {
    schemaVersion: 1 as const,
    product: "Chiku" as const,
    channel: "stable" as const,
    generatedAt: "2026-10-09T11:00:00.000Z",
    expiresAt: "2026-10-10T11:00:00.000Z",
    artifacts: [
      {
        id: "chiku-darwin-arm64",
        version: "1.1.0",
        channel: "stable" as const,
        platform: "darwin" as const,
        arch: "arm64" as const,
        runtime: { name: "bun" as const, minimumVersion: "1.4.0" },
        installMethod: "package" as const,
        url: "https://updates.example.invalid/chiku.tgz",
        bytes: artifactBytes.byteLength,
        sha256: createHash("sha256").update(artifactBytes).digest("hex"),
      },
    ],
  };
  return {
    ...unsigned,
    signature: {
      algorithm: "ed25519" as const,
      keyId: "test-key",
      value: "AA==",
    },
  };
}

describe("secure update metadata and staging", () => {
  test("verifies signed metadata and rejects expiry or tampering", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const unsigned = metadata();
    const signature = sign(
      null,
      Buffer.from(canonicalUpdatePayload(unsigned)),
      privateKey,
    ).toString("base64");
    const signed = UpdateMetadataSchema.parse({
      ...unsigned,
      signature: { ...unsigned.signature, value: signature },
    });
    expect(
      verifyUpdateMetadata(
        signed,
        {
          "test-key": publicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
        },
        new Date(now),
      ).verified,
    ).toBe(true);
    expect(
      verifyUpdateMetadata(
        { ...signed, expiresAt: "2026-10-08T11:00:00.000Z" },
        {
          "test-key": publicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
        },
        new Date(now),
      ),
    ).toEqual({ verified: false, reason: "metadata expired" });
    expect(
      verifyUpdateMetadata(
        { ...signed, channel: "beta" },
        {
          "test-key": publicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
        },
        new Date(now),
      ),
    ).toEqual({ verified: false, reason: "invalid metadata signature" });
  });

  test("selects only a newer compatible artifact", () => {
    const candidate = UpdateMetadataSchema.parse(metadata());
    expect(
      selectCompatibleUpdate(candidate, {
        channel: "stable",
        currentVersion: "1.0.0",
        platform: "darwin",
        arch: "arm64",
        runtime: { name: "bun", version: "1.4.2" },
      })?.version,
    ).toBe("1.1.0");
    expect(
      selectCompatibleUpdate(candidate, {
        channel: "stable",
        currentVersion: "1.0.0",
        platform: "linux",
        arch: "x64",
        runtime: { name: "bun", version: "1.4.2" },
      }),
    ).toBeUndefined();
    expect(
      selectCompatibleUpdate(candidate, {
        channel: "stable",
        currentVersion: "1.1.0",
        platform: "darwin",
        arch: "arm64",
        runtime: { name: "bun", version: "1.4.2" },
      }),
    ).toBeUndefined();
  });

  test("stages only an HTTPS artifact with exact size and digest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chiku-update-"));
    const candidate = UpdateMetadataSchema.parse(metadata()).artifacts[0]!;
    const staged = await stageUpdateArtifact(
      candidate,
      directory,
      async () => artifactBytes,
    );
    expect(await readFile(staged)).toEqual(Buffer.from(artifactBytes));
    const stagedMode = (await stat(staged)).mode & 0o777;
    if (process.platform === "win32") {
      // Windows uses ACLs instead of POSIX permission bits. The temporary
      // staging directory provides the access boundary; ensure the artifact
      // is not marked executable while avoiding a false 0600 assertion.
      expect(stagedMode & 0o111).toBe(0);
    } else {
      expect(stagedMode).toBe(0o600);
    }
    await expect(
      stageUpdateArtifact(
        { ...candidate, sha256: "0".repeat(64) },
        directory,
        async () => artifactBytes,
      ),
    ).rejects.toThrow("sha256 mismatch");
    await expect(
      stageUpdateArtifact(
        { ...candidate, url: "http://updates.example.invalid/chiku.tgz" },
        directory,
        async () => artifactBytes,
      ),
    ).rejects.toThrow();
  });
});
