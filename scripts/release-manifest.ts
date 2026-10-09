import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildReleaseManifest } from "../src/release/manifest";

const packageJson = JSON.parse(await Bun.file("package.json").text()) as {
  version?: string;
};
const version = packageJson.version;
if (!version) throw new Error("package.json does not contain a version");

const channel = process.env.CHIKU_RELEASE_CHANNEL ?? "development";
if (!["development", "canary", "stable"].includes(channel)) {
  throw new Error(`unsupported CHIKU_RELEASE_CHANNEL: ${channel}`);
}

const revisionResult = Bun.spawnSync(["git", "rev-parse", "--verify", "HEAD"]);
const sourceRevision =
  new TextDecoder().decode(revisionResult.stdout).trim() || "unknown";
const statusResult = Bun.spawnSync(["git", "status", "--porcelain"]);
const sourceState =
  statusResult.exitCode !== 0
    ? "unknown"
    : new TextDecoder().decode(statusResult.stdout).trim()
      ? "modified"
      : "clean";
const artifactPaths = process.argv.slice(2);
if (!artifactPaths.length) {
  throw new Error("usage: bun scripts/release-manifest.ts <artifact> [...]");
}

const manifest = await buildReleaseManifest({
  version,
  channel: channel as "development" | "canary" | "stable",
  sourceRevision,
  sourceState,
  artifactPaths,
});
const output = resolve("dist/release-manifest.json");
await mkdir(resolve("dist"), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(output);
