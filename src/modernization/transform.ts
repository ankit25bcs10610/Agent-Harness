import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import ts from "typescript";
import { applyPatch, unifiedDiff } from "../patch/engine";
import { canonicalizePath } from "../permission/match";
import type { TransformationResult } from "./types";

export async function renameTypeScriptIdentifier(input: {
  root: string;
  file: string;
  from: string;
  to: string;
  approvedFiles: readonly string[];
  authorize: (path: string) => Promise<boolean>;
  signal?: AbortSignal;
}): Promise<TransformationResult> {
  if (
    !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(input.from) ||
    !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(input.to)
  )
    throw new Error("identifier names must be valid source identifiers");
  if (input.from === input.to)
    return {
      changed: false,
      files: [],
      diff: "",
      reason: "identifier is already at the requested name",
    };
  const canonical = await canonicalizePath(input.file, input.root);
  if (!canonical.exists) throw new Error(`file does not exist: ${input.file}`);
  const path = canonical.target;
  const relativePath = relative(input.root, path);
  if (
    !input.approvedFiles.includes(input.file) &&
    !input.approvedFiles.includes(relativePath)
  )
    throw new Error(
      `file is outside the approved migration scope: ${input.file}`,
    );
  if (!(await input.authorize(relativePath)))
    throw new Error(`migration authorization denied: ${relativePath}`);
  if (input.signal?.aborted) throw new Error("transformation cancelled");
  const source = await readFile(path, "utf8");
  const scriptKind =
    path.endsWith(".tsx") || path.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const spans: { start: number; end: number }[] = [];
  function visit(node: ts.Node) {
    if (ts.isIdentifier(node) && node.text === input.from)
      spans.push({ start: node.getStart(sourceFile), end: node.getEnd() });
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (!spans.length)
    return {
      changed: false,
      files: [],
      diff: "",
      reason: `identifier not found: ${input.from}`,
    };
  let updated = source;
  for (const span of [...spans].reverse())
    updated = `${updated.slice(0, span.start)}${input.to}${updated.slice(span.end)}`;
  const diff = unifiedDiff(relative(input.root, path), source, updated);
  // Apply through the existing patch engine using the canonical absolute target.
  // The user-facing diff remains repository-relative and reviewable.
  const patchOptions = input.signal ? { signal: input.signal } : {};
  await applyPatch(
    input.root,
    unifiedDiff(path, source, updated),
    patchOptions,
  );
  return { changed: true, files: [relativePath], diff };
}
