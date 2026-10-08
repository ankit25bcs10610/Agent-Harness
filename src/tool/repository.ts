import { lstat, open, readdir, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, extname, join, relative, resolve } from "node:path";

export type RepositoryOptions = {
  root: string;
  regex?: boolean;
  glob?: string;
  exclude?: string[];
  respectGitignore?: boolean;
  maxResults?: number;
  maxChars?: number;
  timeoutMs?: number;
  cursor?: number;
};

export type FileMetadata = {
  path: string;
  kind: "file" | "directory";
  bytes?: number;
  extension?: string | undefined;
  binary?: boolean;
};

export type SearchMatch = {
  path: string;
  line: number;
  column?: number | undefined;
  text: string;
};

const DEFAULT_EXCLUDES = [
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".chiku",
];
const DEFAULT_MAX_RESULTS = 100;
const DEFAULT_MAX_CHARS = 20_000;
const DEFAULT_TIMEOUT_MS = 5_000;

function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "@@DOUBLE@@")
    .replace(/\*/g, "[^/]*")
    .replace(/@@DOUBLE@@/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${source}$`);
}

function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some(
    (pattern) =>
      globToRegExp(pattern).test(path) ||
      globToRegExp(`**/${pattern}`).test(path),
  );
}

function bounded<T>(items: T[], maxResults: number, cursor: number) {
  return {
    items: items.slice(cursor, cursor + maxResults),
    nextCursor:
      cursor + maxResults < items.length ? cursor + maxResults : undefined,
    total: items.length,
  };
}

async function canonicalRoot(root: string): Promise<string> {
  const result = await realpath(root);
  return result;
}

async function isBinary(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

async function fallbackFiles(
  root: string,
  options: RepositoryOptions,
): Promise<string[]> {
  const output: string[] = [];
  const excludes = [...DEFAULT_EXCLUDES, ...(options.exclude ?? [])];
  async function visit(directory: string): Promise<void> {
    if (output.length >= (options.maxResults ?? DEFAULT_MAX_RESULTS) * 10)
      return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).replaceAll("\\", "/");
      if (!path || matchesAny(path, excludes) || entry.name.startsWith("."))
        continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(absolute);
      else if (
        entry.isFile() &&
        (!options.glob || matchesAny(path, [options.glob]))
      )
        output.push(path);
    }
  }
  await visit(root);
  return output.sort();
}

async function runRg(
  args: string[],
  root: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<string | undefined> {
  return new Promise((resolveOutput, reject) => {
    if (signal.aborted) {
      reject(new Error("repository search cancelled"));
      return;
    }
    const child = spawn("rg", args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    const abort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        resolveOutput(undefined);
      else reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(new Error("repository search cancelled"));
      else if (code !== 0 && code !== 1)
        reject(new Error(stderr || `rg exited with ${code}`));
      else resolveOutput(stdout);
    });
  });
}

async function fallbackSearch(
  query: string,
  root: string,
  options: RepositoryOptions,
  signal: AbortSignal,
): Promise<SearchMatch[]> {
  const matcher = options.regex ? new RegExp(query) : undefined;
  const files = await fallbackFiles(root, {
    ...options,
    maxResults: Math.max(options.maxResults ?? DEFAULT_MAX_RESULTS, 1) * 10,
  });
  const results: SearchMatch[] = [];
  for (const path of files) {
    if (signal.aborted) throw new Error("repository search cancelled");
    const absolute = join(root, path);
    if (await isBinary(absolute)) continue;
    const content = await readFileText(absolute);
    if (content === undefined) continue;
    const lines = content.split(/\r?\n/);
    for (const [index, text] of lines.entries()) {
      const match = matcher ? matcher.exec(text) : undefined;
      const column = matcher ? (match?.index ?? -1) : text.indexOf(query);
      if (column < 0) continue;
      results.push({ path, line: index + 1, column, text });
      if (
        results.length >=
        (options.maxResults ?? DEFAULT_MAX_RESULTS) + (options.cursor ?? 0)
      )
        return results;
    }
  }
  return results;
}

async function readFileText(path: string): Promise<string | undefined> {
  try {
    const handle = await open(path, "r");
    try {
      return (await handle.readFile()).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

export async function listRepositoryFiles(
  options: RepositoryOptions,
  signal: AbortSignal,
): Promise<{
  results: FileMetadata[];
  nextCursor?: number | undefined;
  total: number;
}> {
  const root = await canonicalRoot(options.root);
  if (signal.aborted) throw new Error("repository search cancelled");
  const excludes = [...DEFAULT_EXCLUDES, ...(options.exclude ?? [])];
  const args = [
    "--files",
    ...(options.respectGitignore === false ? ["--no-ignore"] : []),
    ...(options.glob ? ["--glob", options.glob] : []),
    ...excludes.flatMap((exclude) => ["--glob", `!${exclude}/**`]),
  ];
  let paths: string[];
  try {
    paths =
      (await runRg(args, root, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, signal))
        ?.split("\n")
        .filter(Boolean) ?? (await fallbackFiles(root, options));
  } catch (error) {
    if (signal.aborted) throw error;
    paths = await fallbackFiles(root, options);
  }
  const metadata: FileMetadata[] = [];
  for (const path of paths) {
    if (matchesAny(path, excludes)) continue;
    try {
      const absolute = join(root, path);
      const stat = await lstat(absolute);
      if (!stat.isFile()) continue;
      metadata.push({
        path,
        kind: "file",
        bytes: stat.size,
        extension: extname(path) || undefined,
        binary: await isBinary(absolute),
      });
    } catch {
      /* changed during traversal */
    }
  }
  return {
    results: bounded(
      metadata,
      options.maxResults ?? DEFAULT_MAX_RESULTS,
      options.cursor ?? 0,
    ).items,
    nextCursor: bounded(
      metadata,
      options.maxResults ?? DEFAULT_MAX_RESULTS,
      options.cursor ?? 0,
    ).nextCursor,
    total: metadata.length,
  };
}

export async function searchRepository(
  query: string,
  options: RepositoryOptions,
  signal: AbortSignal,
): Promise<{
  results: SearchMatch[];
  nextCursor?: number | undefined;
  total: number;
  truncated: boolean;
}> {
  const root = await canonicalRoot(options.root);
  const excludes = [...DEFAULT_EXCLUDES, ...(options.exclude ?? [])];
  const args = [
    "--json",
    "--line-number",
    "--column",
    ...(options.respectGitignore === false ? ["--no-ignore"] : []),
    ...(options.glob ? ["--glob", options.glob] : []),
    ...excludes.flatMap((exclude) => ["--glob", `!${exclude}/**`]),
    query,
    ".",
  ];
  let raw: string | undefined;
  try {
    raw = await runRg(
      args,
      root,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal,
    );
  } catch (error) {
    if (signal.aborted) throw error;
    if (
      error instanceof Error &&
      error.message === "repository search cancelled"
    )
      throw error;
    raw = undefined;
  }
  const results: SearchMatch[] = [];
  let chars = 0;
  for (const line of (raw ?? "").split("\n")) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as {
        type: string;
        data?: {
          path?: { text?: string };
          line_number?: number;
          lines?: { text?: string };
          submatches?: { start?: number }[];
        };
      };
      if (
        parsed.type !== "match" ||
        !parsed.data?.path?.text ||
        !parsed.data.line_number
      )
        continue;
      const text = parsed.data.lines?.text?.replace(/\n$/, "") ?? "";
      chars += text.length;
      if (chars > (options.maxChars ?? DEFAULT_MAX_CHARS)) break;
      results.push({
        path: parsed.data.path.text.replace(/^\.\//, ""),
        line: parsed.data.line_number,
        column: parsed.data.submatches?.[0]?.start,
        text,
      });
      if (
        results.length >=
        (options.maxResults ?? DEFAULT_MAX_RESULTS) + (options.cursor ?? 0)
      )
        break;
    } catch {
      /* ignore non-match rg events */
    }
  }
  if (raw === undefined) {
    const fallback = await fallbackSearch(query, root, options, signal);
    const page = bounded(
      fallback,
      options.maxResults ?? DEFAULT_MAX_RESULTS,
      options.cursor ?? 0,
    );
    return {
      results: page.items,
      nextCursor: page.nextCursor,
      total: page.total,
      truncated: Boolean(page.nextCursor),
    };
  }
  const page = bounded(
    results,
    options.maxResults ?? DEFAULT_MAX_RESULTS,
    options.cursor ?? 0,
  );
  return {
    results: page.items,
    nextCursor: page.nextCursor,
    total: results.length,
    truncated:
      Boolean(page.nextCursor) ||
      chars >= (options.maxChars ?? DEFAULT_MAX_CHARS),
  };
}

export async function searchRepositorySymbols(
  name: string | undefined,
  options: RepositoryOptions,
  signal: AbortSignal,
) {
  const query = name
    ? `(?:function|class|interface|type|enum|const|let|var)\\s+${name}\\b`
    : "(?:export\\s+)?(?:async\\s+)?(?:function|class|interface|type|enum|const|let|var)\\s+[A-Za-z_$][\\w$]*";
  return searchRepository(
    query,
    {
      ...options,
      regex: true,
      glob: options.glob ?? "**/*.{ts,tsx,js,jsx,py,go,rs,java}",
    },
    signal,
  );
}
