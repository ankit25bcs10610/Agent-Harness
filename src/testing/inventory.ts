import { access, readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { discoverVerificationCommands } from "../workflow/verify";
import type {
  FrameworkDetection,
  TestCaseRecord,
  TestFramework,
  TestInventory,
  TestSelection,
} from "./types";

const ignored = new Set([
  ".git",
  ".chiku",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);
const testName = /(?:test|it|describe)\s*\(\s*["'`]([^"'`]+)["'`]/g;

function portableRelative(root: string, path: string) {
  return relative(root, path).split(sep).join("/");
}

async function walk(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(root, path)));
    else if (
      /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) ||
      /(?:^|\/)(?:tests?|__tests__)\//.test(portableRelative(root, path))
    )
      result.push(portableRelative(root, path));
  }
  return result.sort();
}

async function manifest(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ) as Record<string, unknown>;
}

function detectFromText(
  text: string,
  source: string,
): FrameworkDetection | null {
  if (/from\s+["']bun:test["']|require\(["']bun:test["']\)/.test(text))
    return { framework: "bun", supported: true, source, command: "bun test" };
  if (/from\s+["']vitest["']|from\s+["']@vitest\//.test(text))
    return {
      framework: "vitest",
      supported: true,
      source,
      command: "vitest run",
    };
  if (/from\s+["']@jest\/globals["']|jest\.config\./.test(text))
    return { framework: "jest", supported: true, source, command: "jest" };
  if (/from\s+["']mocha["']|describe\s*\(/.test(text))
    return { framework: "mocha", supported: true, source, command: "mocha" };
  if (/pytest|unittest/.test(text))
    return {
      framework: "pytest",
      supported: false,
      source,
      command: "pytest",
      reason:
        "Python test execution is inventory-only in this TypeScript/Bun runtime",
    };
  return null;
}

export async function detectTestFramework(
  root: string,
): Promise<FrameworkDetection> {
  const packageJson: Record<string, unknown> = await manifest(root).catch(
    () => ({}) as Record<string, unknown>,
  );
  const scripts =
    (packageJson.scripts as Record<string, unknown> | undefined) ?? {};
  const configured = Object.entries(scripts).find(
    ([name, command]) => /test/i.test(name) && typeof command === "string",
  );
  if (configured) {
    const command = configured[1] as string;
    const framework: TestFramework = /bun\s+test/.test(command)
      ? "bun"
      : /vitest/.test(command)
        ? "vitest"
        : /jest/.test(command)
          ? "jest"
          : /mocha/.test(command)
            ? "mocha"
            : "unknown";
    if (framework !== "unknown")
      return {
        framework,
        supported: true,
        source: `package.json#scripts.${configured[0]}`,
        command,
      };
  }
  for (const file of await walk(root)) {
    const detected = detectFromText(
      await readFile(join(root, file), "utf8"),
      file,
    );
    if (detected) return detected;
  }
  return {
    framework: "unknown",
    supported: false,
    source: "no configured test runner or recognizable test import",
    command: null,
    reason: "test framework could not be grounded in repository evidence",
  };
}

export async function inventoryTests(root: string): Promise<TestInventory> {
  const framework = await detectTestFramework(root);
  const files = await walk(root);
  const cases: TestCaseRecord[] = [];
  for (const file of files) {
    const text = await readFile(join(root, file), "utf8").catch(() => "");
    const detected = detectFromText(text, file);
    const fileFramework = detected?.framework ?? framework.framework;
    const names = [...text.matchAll(testName)].map((match) => match[1] ?? null);
    if (!names.length)
      cases.push({ file, name: null, framework: fileFramework });
    else
      for (const name of names)
        cases.push({ file, name, framework: fileFramework });
  }
  return {
    root,
    framework,
    files,
    cases,
    commands: await discoverVerificationCommands(root),
  };
}

export async function selectRelevantTests(
  inventory: TestInventory,
  changedFiles: readonly string[],
): Promise<TestSelection> {
  if (!changedFiles.length)
    return {
      files: inventory.files,
      fallback: true,
      reason: "no changed-file evidence; full-suite fallback",
    };
  const selected = inventory.files.filter((testFile) =>
    changedFiles.some((changed) => {
      const stem = changed
        .replace(/\.[^.]+$/, "")
        .split("/")
        .pop();
      return Boolean(
        stem && testFile.toLowerCase().includes(stem.toLowerCase()),
      );
    }),
  );
  if (!selected.length)
    return {
      files: inventory.files,
      fallback: true,
      reason: "impact mapping was inconclusive; full-suite fallback",
    };
  return {
    files: selected,
    fallback: false,
    reason: "test filename evidence matched changed source paths",
  };
}

export async function hasFile(root: string, path: string) {
  return access(join(root, path))
    .then(() => true)
    .catch(() => false);
}
