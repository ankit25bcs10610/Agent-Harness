import { createHash, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import {
  LocalPluginRegistry,
  validateArchiveEntries,
  verifyPackageIntegrity,
} from "../../src/plugin";

const bytes = new TextEncoder().encode("declarative package fixture");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const manifest = {
  manifestVersion: 1,
  id: "example.registry",
  name: "Registry fixture",
  version: "1.0.0",
  publisher: { id: "example", name: "Example" },
  description: "Controlled registry fixture.",
  type: "declarative",
  requiredChikuApi: "1.0.0",
  platforms: ["darwin"],
  requiredCapabilities: [],
  optionalCapabilities: [],
  dependencies: {},
  resourceLimits: {
    maxRuntimeMs: 1000,
    maxOutputChars: 1000,
    maxStorageBytes: 1000,
  },
  integrity: { sha256 },
  license: "MIT",
};

test("package verification rejects tampering and archive escapes", () => {
  expect(verifyPackageIntegrity(bytes, sha256)).toBe(true);
  expect(() =>
    verifyPackageIntegrity(new TextEncoder().encode("tampered"), sha256),
  ).toThrow("integrity");
  expect(() => validateArchiveEntries([{ path: "../escape.ts" }])).toThrow(
    "traversal",
  );
  expect(() => validateArchiveEntries([{ path: "/absolute.ts" }])).toThrow(
    "unsafe path",
  );
  expect(() =>
    validateArchiveEntries([
      { path: "link.ts", type: "symlink", linkTarget: "../../secret" },
    ]),
  ).toThrow("symlink");
});

test("controlled registry enforces publisher ownership and review before discovery", async () => {
  const registry = new LocalPluginRegistry(
    await mkdtemp(join(tmpdir(), `chiku-registry-${randomUUID()}`)),
    { chikuApiVersion: "1.0.0", platform: "darwin" },
  );
  registry.registerPublisher("example", "publisher-token-123");
  await expect(
    registry.submit({
      publisherId: "example",
      publisherToken: "wrong-token-1234",
      manifest,
      packageBytes: bytes,
      archiveEntries: [{ path: "manifest.json" }],
    }),
  ).rejects.toThrow("authentication");
  await expect(
    registry.submit({
      publisherId: "other",
      publisherToken: "publisher-token-123",
      manifest,
      packageBytes: bytes,
      archiveEntries: [{ path: "manifest.json" }],
    }),
  ).rejects.toThrow("authentication");
  const submitted = await registry.submit({
    publisherId: "example",
    publisherToken: "publisher-token-123",
    manifest,
    packageBytes: bytes,
    archiveEntries: [{ path: "manifest.json" }],
  });
  expect(registry.search()).toHaveLength(0);
  await registry.review({
    id: manifest.id,
    version: manifest.version,
    reviewerId: "maintainer",
    state: "VALIDATING",
  });
  await registry.review({
    id: manifest.id,
    version: manifest.version,
    reviewerId: "maintainer",
    state: "SECURITY_REVIEW",
  });
  await registry.review({
    id: manifest.id,
    version: manifest.version,
    reviewerId: "maintainer",
    state: "MAINTAINER_REVIEW",
  });
  const approved = await registry.review({
    id: manifest.id,
    version: manifest.version,
    reviewerId: "maintainer",
    state: "APPROVED",
  });
  expect(approved.submissionId).toBe(submitted.submissionId);
  expect(registry.search("registry")).toHaveLength(1);
  await registry.revoke(
    manifest.id,
    manifest.version,
    "maintainer",
    "security advisory",
  );
  expect(registry.search()).toHaveLength(0);
});
