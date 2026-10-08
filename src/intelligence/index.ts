import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import {
  dirname,
  extname,
  join,
  normalize,
  relative,
  resolve,
} from "node:path";
import { parse } from "@typescript-eslint/typescript-estree";
import type { TSESTree } from "@typescript-eslint/typescript-estree";
import { listRepositoryFiles } from "../tool/repository";
import type {
  IntelligenceOptions,
  RepositoryIndex,
  RepositorySymbol,
  SymbolKind,
  RetrievalResult,
  IndexChanges,
} from "./types";

const DEFAULT_MAX_FILES = 10_000;
const DEFAULT_MAX_FILE_BYTES = 1_000_000;
const DEFAULT_EXCLUDES = [
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".chiku",
];

function language(path: string) {
  return /\.(tsx?|mts|cts)$/.test(path)
    ? "typescript"
    : /\.(jsx?|mjs|cjs)$/.test(path)
      ? "javascript"
      : "unknown";
}
function named(node: TSESTree.Node): string | undefined {
  const candidate =
    (
      node as TSESTree.Node & {
        id?: TSESTree.Identifier | null;
        key?: TSESTree.Node;
      }
    ).id ?? (node as TSESTree.Node & { key?: TSESTree.Node }).key;
  return candidate && candidate.type === "Identifier"
    ? candidate.name
    : undefined;
}
function exported(node: TSESTree.Node): boolean {
  return (
    node.type === "ExportNamedDeclaration" ||
    node.type === "ExportDefaultDeclaration"
  );
}
function symbolFrom(
  node: TSESTree.Node,
  path: string,
  container?: string,
): RepositorySymbol | undefined {
  const kindMap: Record<string, SymbolKind> = {
    FunctionDeclaration: "function",
    ClassDeclaration: "class",
    MethodDefinition: "method",
    TSInterfaceDeclaration: "interface",
    TSTypeAliasDeclaration: "type",
    VariableDeclaration: "variable",
  };
  const kind = kindMap[node.type];
  const name = named(node);
  if (!kind || !name || !node.loc) return undefined;
  return {
    id: `${path}:${node.loc.start.line}:${name}`,
    name,
    kind,
    path,
    language: language(path),
    startLine: node.loc.start.line,
    endLine: node.loc.end.line,
    exported: exported(node),
    ...(container ? { container } : {}),
  };
}
function parseFile(path: string, source: string) {
  const ast = parse(source, {
    loc: true,
    range: true,
    comment: false,
    jsx: /x$/.test(extname(path)),
    errorOnUnknownASTType: false,
    filePath: path,
  });
  const symbols: RepositorySymbol[] = [];
  const imports: { module: string; evidence: string }[] = [];
  const visit = (node: TSESTree.Node, container?: string) => {
    const symbol = symbolFrom(node, path, container);
    if (symbol) {
      symbols.push(symbol);
      container = symbol.name;
    }
    if (node.type === "ImportDeclaration" && node.source.value)
      imports.push({
        module: String(node.source.value),
        evidence: String(node.source.value),
      });
    if (node.type === "ExportNamedDeclaration" && node.source?.value)
      imports.push({
        module: String(node.source.value),
        evidence: String(node.source.value),
      });
    for (const value of Object.values(
      node as unknown as Record<string, unknown>,
    )) {
      if (Array.isArray(value)) {
        for (const child of value)
          if (child && typeof child === "object" && "type" in child)
            visit(child as TSESTree.Node, container);
      } else if (value && typeof value === "object" && "type" in value) {
        visit(value as unknown as TSESTree.Node, container);
      }
    }
  };
  visit(ast as unknown as TSESTree.Node);
  return { symbols, imports };
}
function resolveImport(
  path: string,
  module: string,
  files: Set<string>,
): string | undefined {
  if (!module.startsWith(".")) return undefined;
  const base = normalize(join(dirname(path), module)).replace(/^\.\//, "");
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    join(base, "index.ts"),
  ].find((candidate) => files.has(candidate));
}

export async function buildRepositoryIndex(
  options: IntelligenceOptions,
  signal: AbortSignal,
): Promise<RepositoryIndex> {
  const started = performance.now();
  const root = await realpath(options.root);
  const listedStarted = performance.now();
  const listed = await listRepositoryFiles(
    {
      root,
      maxResults: options.maxFiles ?? DEFAULT_MAX_FILES,
      exclude: [...DEFAULT_EXCLUDES, ...(options.exclude ?? [])],
    },
    signal,
  );
  options.onMetric?.({
    name: "repository.list",
    durationMs: performance.now() - listedStarted,
    items: listed.results.length,
  });
  const files = listed.results.filter(
    (file) =>
      language(file.path) !== "unknown" &&
      (file.bytes ?? 0) <= (options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES),
  );
  const fileSet = new Set(files.map((file) => file.path));
  const symbols: RepositorySymbol[] = [];
  const edges: RepositoryIndex["edges"] = [];
  const errors: string[] = [];
  const hashes = new Map<string, string>();
  const parseStarted = performance.now();
  for (const file of files) {
    if (signal.aborted) throw new Error("repository indexing cancelled");
    try {
      const source = await readFile(join(root, file.path), "utf8");
      hashes.set(file.path, createHash("sha256").update(source).digest("hex"));
      const parsed = parseFile(file.path, source);
      symbols.push(...parsed.symbols);
      for (const item of parsed.imports) {
        const target = resolveImport(file.path, item.module, fileSet);
        if (target)
          edges.push({
            from: file.path,
            to: target,
            kind: "imports",
            evidence: item.evidence,
          });
      }
    } catch (error) {
      errors.push(
        `${file.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  options.onMetric?.({
    name: "repository.parse",
    durationMs: performance.now() - parseStarted,
    items: files.length,
  });
  const result: RepositoryIndex = {
    root,
    createdAt: new Date().toISOString(),
    files: files.map((file) => ({
      path: file.path,
      hash: hashes.get(file.path) ?? "",
      bytes: file.bytes ?? 0,
      language: language(file.path),
    })),
    symbols,
    edges,
    errors,
  };
  options.onMetric?.({
    name: "repository.index",
    durationMs: performance.now() - started,
    items: result.files.length,
  });
  return result;
}
export function findSymbols(
  index: RepositoryIndex,
  query: string,
): RepositorySymbol[] {
  const value = query.toLowerCase();
  return index.symbols.filter((symbol) =>
    symbol.name.toLowerCase().includes(value),
  );
}

export function findDependencies(
  index: RepositoryIndex,
  path: string,
  depth = 1,
): string[] {
  return traverse(index, path, depth, "from");
}
export function findDependents(
  index: RepositoryIndex,
  path: string,
  depth = 1,
): string[] {
  return traverse(index, path, depth, "to");
}
function traverse(
  index: RepositoryIndex,
  path: string,
  depth: number,
  side: "from" | "to",
): string[] {
  const found = new Set<string>();
  let frontier = new Set([path]);
  for (let level = 0; level < depth; level++) {
    const next = new Set<string>();
    for (const edge of index.edges) {
      const source = side === "from" ? edge.from : edge.to;
      const target = side === "from" ? edge.to : edge.from;
      if (frontier.has(source) && !found.has(target)) {
        found.add(target);
        next.add(target);
      }
    }
    frontier = next;
  }
  return [...found].sort();
}
export function retrieve(
  index: RepositoryIndex,
  query: string,
  maxResults = 20,
): RetrievalResult[] {
  const terms = new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9_$]+/)
      .filter((term) => term.length > 2),
  );
  return index.symbols
    .map((symbol) => ({
      symbol,
      score: [...terms].filter(
        (term) =>
          symbol.name.toLowerCase().includes(term) ||
          symbol.path.toLowerCase().includes(term),
      ).length,
    }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.symbol.path.localeCompare(b.symbol.path),
    )
    .slice(0, maxResults)
    .map(({ symbol }) => ({
      path: symbol.path,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      reason: `symbol match: ${symbol.name}`,
      symbols: [symbol.id],
    }));
}
export async function saveRepositoryIndex(
  index: RepositoryIndex,
  path: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: 1, index }), "utf8");
  await rename(temporary, path);
}
export async function loadRepositoryIndex(
  path: string,
): Promise<RepositoryIndex | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as {
      version?: number;
      index?: RepositoryIndex;
    };
    return value.version === 1 &&
      value.index &&
      Array.isArray(value.index.files) &&
      Array.isArray(value.index.symbols)
      ? value.index
      : undefined;
  } catch {
    return undefined;
  }
}

export function reconcileIndex(
  previous: RepositoryIndex | undefined,
  current: RepositoryIndex,
): IndexChanges {
  const before = new Map(
    (previous?.files ?? []).map((file) => [file.path, file.hash]),
  );
  const after = new Map(current.files.map((file) => [file.path, file.hash]));
  return {
    added: [...after.keys()].filter((path) => !before.has(path)).sort(),
    modified: [...after.keys()]
      .filter(
        (path) => before.has(path) && before.get(path) !== after.get(path),
      )
      .sort(),
    deleted: [...before.keys()].filter((path) => !after.has(path)).sort(),
  };
}

export function analyzeImpact(
  index: RepositoryIndex,
  paths: string[],
  depth = 2,
) {
  const affected = new Set<string>(paths);
  for (const path of paths)
    for (const dependent of findDependents(index, path, depth))
      affected.add(dependent);
  return [...affected].sort().map((path) => ({
    path,
    direct: paths.includes(path),
    reason: paths.includes(path) ? "changed file" : "imports a changed file",
    symbols: index.symbols
      .filter((symbol) => symbol.path === path)
      .map((symbol) => symbol.id),
  }));
}
