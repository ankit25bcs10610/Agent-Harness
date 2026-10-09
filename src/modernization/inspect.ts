import { access, readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { discoverRepository } from "../workspace/git";
import { discoverVerificationCommands } from "../workflow/verify";
import type {
  DependencyRecord,
  ProjectInventory,
  TechnologyEvidence,
} from "./types";

const SKIP = new Set([
  ".git",
  ".chiku",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

async function filesUnder(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) result.push(...(await filesUnder(root, path)));
    else if (SOURCE_EXTENSIONS.has(extname(entry.name)))
      result.push(relative(root, path));
  }
  return result.sort();
}

function evidenceFromManifest(
  manifest: Record<string, unknown>,
  source: string,
): TechnologyEvidence[] {
  const evidence: TechnologyEvidence[] = [];
  const engines = manifest.engines as Record<string, unknown> | undefined;
  if (typeof engines?.bun === "string")
    evidence.push({
      kind: "package_manager",
      name: "bun",
      version: engines.bun,
      source,
      confidence: "declared",
    });
  if (typeof engines?.node === "string")
    evidence.push({
      kind: "language",
      name: "node",
      version: engines.node,
      source,
      confidence: "declared",
    });
  const deps = {
    ...(manifest.dependencies as Record<string, unknown> | undefined),
    ...(manifest.devDependencies as Record<string, unknown> | undefined),
  };
  for (const [name, value] of Object.entries(deps)) {
    if (name === "typescript" && typeof value === "string")
      evidence.push({
        kind: "language",
        name: "typescript",
        version: value,
        source,
        confidence: "declared",
      });
    if (name === "react" && typeof value === "string")
      evidence.push({
        kind: "framework",
        name: "react",
        version: value,
        source,
        confidence: "declared",
      });
  }
  return evidence;
}

async function dependencyRecords(
  manifest: Record<string, unknown>,
  root: string,
  source: string,
): Promise<DependencyRecord[]> {
  const kinds = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ] as const;
  return await Promise.all(
    kinds.flatMap((kind) =>
      Object.entries(
        (manifest[kind] as Record<string, unknown> | undefined) ?? {},
      ).flatMap(([name, version]) =>
        typeof version === "string"
          ? [
              resolveDeclaredDependency(root, name).then((resolvedVersion) => ({
                name,
                requestedVersion: version,
                resolvedVersion,
                kind,
                source,
              })),
            ]
          : [],
      ),
    ),
  );
}

export async function inspectProject(root: string): Promise<ProjectInventory> {
  const manifestPath = join(root, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
    string,
    unknown
  >;
  const sourceFiles = await filesUnder(root);
  const repository = await discoverRepository(root).catch(() => undefined);
  const lockfile =
    (
      await Promise.all(
        ["bun.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"].map(
          async (name) =>
            await access(join(root, name))
              .then(() => name)
              .catch(() => null),
        ),
      )
    ).find(Boolean) ?? null;
  const evidence = evidenceFromManifest(manifest, "package.json");
  if (
    sourceFiles.some((path) => path.endsWith(".tsx") || path.endsWith(".jsx"))
  )
    evidence.push({
      kind: "framework",
      name: "jsx",
      version: null,
      source: "source files",
      confidence: "observed",
    });
  if (sourceFiles.some((path) => path === "tsconfig.json"))
    evidence.push({
      kind: "build",
      name: "typescript-compiler",
      version: null,
      source: "tsconfig.json",
      confidence: "observed",
    });
  if (repository?.dirty)
    evidence.push({
      kind: "build",
      name: "git-dirty-worktree",
      version: null,
      source: "git status",
      confidence: "observed",
    });
  return {
    root,
    evidence,
    dependencies: await dependencyRecords(manifest, root, "package.json"),
    sourceFiles,
    publicFiles: (
      await Promise.all(
        ["package.json", "README.md", "LICENSE"].map(
          async (name) =>
            await access(join(root, name))
              .then(() => name)
              .catch(() => null),
        ),
      )
    ).filter((name): name is string => Boolean(name)),
    lockfile,
    verificationCommands: await discoverVerificationCommands(root),
  };
}

export async function resolveDeclaredDependency(
  root: string,
  name: string,
): Promise<string | null> {
  for (const file of [
    "bun.lock",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
  ]) {
    const path = join(root, file);
    const text = await readFile(path, "utf8").catch(() => "");
    if (!text) continue;
    if (file === "package-lock.json") {
      try {
        const parsed = JSON.parse(text) as {
          packages?: Record<string, { version?: unknown }>;
        };
        const version = parsed.packages?.[`node_modules/${name}`]?.version;
        if (typeof version === "string") return version;
      } catch {
        return null;
      }
    }
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const bunMatch = text.match(
      new RegExp(`^\\s*"${escaped}": \\["${escaped}@([^"/]+)`, "m"),
    );
    if (bunMatch?.[1]) return bunMatch[1];
    const versionMatch = text.match(
      new RegExp(
        `"${escaped}"[^\\n]*[\\n ]+[^\\n]*version[^\\n:]*: \\"?([^\\n\\\", ]+)`,
        "m",
      ),
    );
    if (versionMatch?.[1]) return versionMatch[1];
  }
  return null;
}
