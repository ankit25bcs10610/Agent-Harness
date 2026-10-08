import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertNoSymlinkRace, canonicalizePath } from "../permission/match";

export type PatchHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
};
export type PatchFile = { path: string; oldPath?: string; hunks: PatchHunk[] };
export type PatchPreview = {
  path: string;
  diff: string;
  originalHash: string;
  changed: boolean;
};
export type PatchResult = {
  applied: boolean;
  dryRun: boolean;
  files: PatchPreview[];
  undoToken?: string;
  rolledBack?: boolean;
};

type StoredFile = {
  path: string;
  content: Buffer;
  mode: number;
  hash: string;
  appliedHash?: string;
};
type UndoRecord = { root: string; files: StoredFile[] };
const undoRecords = new Map<string, UndoRecord>();

function hash(content: Buffer | string) {
  return createHash("sha256").update(content).digest("hex");
}
function splitContent(content: string): {
  lines: string[];
  newline: string;
  trailing: boolean;
} {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const trailing = content.endsWith("\n") || content.endsWith("\r");
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (trailing) lines.pop();
  return { lines, newline, trailing };
}
function restoreContent(lines: string[], newline: string, trailing: boolean) {
  return lines.join(newline) + (trailing ? newline : "");
}

function parseHeader(value: string): [number, number] {
  const match = value.match(/^(\d+)(?:,(\d+))?$/);
  if (!match) throw new Error(`malformed hunk range: ${value}`);
  return [Number(match[1]), Number(match[2] ?? 1)];
}

export function parsePatch(input: string): PatchFile[] {
  if (!input.trim()) throw new Error("patch is empty");
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const files: PatchFile[] = [];
  let current: PatchFile | undefined;
  let hunk: PatchHunk | undefined;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line === "*** Begin Patch" || line === "*** End Patch") continue;
    const custom = line.match(/^\*\*\* (?:Update|Delete|Add) File: (.+)$/);
    const gitOld = line.match(/^--- (?:a\/)?(.+?)(?:\t.*)?$/);
    if (custom) {
      current = { path: custom[1]!, hunks: [] };
      files.push(current);
      hunk = undefined;
      continue;
    }
    if (gitOld) {
      const next = lines[++index];
      const gitNew = next?.match(/^\+\+\+ (?:b\/)?(.+?)(?:\t.*)?$/);
      if (!gitNew) throw new Error("patch is missing +++ file header");
      const parsedFile: PatchFile = { path: gitNew[1]!, hunks: [] };
      if (gitOld[1]) parsedFile.oldPath = gitOld[1];
      current = parsedFile;
      files.push(parsedFile);
      hunk = undefined;
      continue;
    }
    const range = line.match(/^@@ -(\d+(?:,\d+)?) \+(\d+(?:,\d+)?) @@/);
    if (range) {
      if (!current) throw new Error("hunk appears before a file header");
      const [oldStart, oldCount] = parseHeader(range[1]!);
      const [newStart, newCount] = parseHeader(range[2]!);
      hunk = { oldStart, oldCount, newStart, newCount, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (
      hunk &&
      (/^[ +\-]/.test(line) || line === "\\ No newline at end of file")
    ) {
      if (line !== "\\ No newline at end of file") hunk.lines.push(line);
      continue;
    }
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line === ""
    )
      continue;
    throw new Error(`malformed patch line ${index + 1}`);
  }
  if (!files.length || files.some((file) => !file.hunks.length))
    throw new Error("patch contains no complete hunks");
  for (const file of files)
    for (const item of file.hunks) {
      const oldCount = item.lines.filter((line) => line[0] !== "+").length;
      const newCount = item.lines.filter((line) => line[0] !== "-").length;
      if (oldCount !== item.oldCount || newCount !== item.newCount)
        throw new Error(`hunk count mismatch for ${file.path}`);
    }
  return files;
}

function applyFilePatch(
  content: string,
  file: PatchFile,
): { content: string; diff: string } {
  const original = splitContent(content);
  const result: string[] = [];
  let sourceIndex = 0;
  for (const hunk of file.hunks) {
    const start = hunk.oldStart - 1;
    if (start < sourceIndex || start > original.lines.length)
      throw new Error(`hunk location is outside ${file.path}`);
    result.push(...original.lines.slice(sourceIndex, start));
    sourceIndex = start;
    for (const line of hunk.lines) {
      const marker = line[0];
      const value = line.slice(1);
      if (marker === " ") {
        if (original.lines[sourceIndex] !== value)
          throw new Error(
            `stale context in ${file.path} at line ${sourceIndex + 1}`,
          );
        result.push(value);
        sourceIndex++;
      } else if (marker === "-") {
        if (original.lines[sourceIndex] !== value)
          throw new Error(
            `conflicting deletion in ${file.path} at line ${sourceIndex + 1}`,
          );
        sourceIndex++;
      } else if (marker === "+") result.push(value);
      else throw new Error(`invalid hunk marker in ${file.path}`);
    }
  }
  result.push(...original.lines.slice(sourceIndex));
  const updated = restoreContent(result, original.newline, original.trailing);
  return { content: updated, diff: unifiedDiff(file.path, content, updated) };
}

export function unifiedDiff(
  path: string,
  before: string,
  after: string,
): string {
  if (before === after) return "";
  const oldLines = splitContent(before).lines;
  const newLines = splitContent(after).lines;
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - suffix - 1] ===
      newLines[newLines.length - suffix - 1]
  )
    suffix++;
  const oldBody = oldLines.slice(prefix, oldLines.length - suffix);
  const newBody = newLines.slice(prefix, newLines.length - suffix);
  const oldCount = oldBody.length || 1;
  const newCount = newBody.length || 1;
  return (
    [
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -${prefix + 1},${oldCount} +${prefix + 1},${newCount} @@`,
      ...oldBody.map((line) => `-${line}`),
      ...newBody.map((line) => `+${line}`),
    ].join("\n") + "\n"
  );
}

export async function applyPatch(
  root: string,
  input: string,
  options: { dryRun?: boolean; signal?: AbortSignal } = {},
): Promise<PatchResult> {
  const files = parsePatch(input);
  const originals: UndoRecord["files"] = [];
  const previews: PatchPreview[] = [];
  for (const file of files) {
    if (options.signal?.aborted) throw new Error("patch cancelled");
    const canonical = await canonicalizePath(file.path, root);
    if (!canonical.exists) throw new Error(`file does not exist: ${file.path}`);
    await assertNoSymlinkRace(canonical.target);
    const info = await stat(canonical.target);
    const content = await readFile(canonical.target);
    if (content.includes(0))
      throw new Error(`binary file is not patchable: ${file.path}`);
    originals.push({
      path: canonical.target,
      content,
      mode: info.mode,
      hash: hash(content),
    });
    const result = applyFilePatch(content.toString("utf8"), {
      ...file,
      path: file.path,
    });
    previews.push({
      path: canonical.target,
      diff: result.diff,
      originalHash: hash(content),
      changed: result.content !== content.toString("utf8"),
    });
    if (!result.content)
      throw new Error(
        `patch would produce an empty file without explicit deletion support: ${file.path}`,
      );
  }
  if (options.dryRun) return { applied: false, dryRun: true, files: previews };
  const written: UndoRecord["files"] = [];
  try {
    for (const [index, file] of files.entries()) {
      if (options.signal?.aborted) throw new Error("patch cancelled");
      const original = originals[index]!;
      const canonical = original.path;
      await assertNoSymlinkRace(canonical);
      const current = await readFile(canonical);
      if (hash(current) !== original.hash)
        throw new Error(`file changed concurrently: ${file.path}`);
      const next = applyFilePatch(current.toString("utf8"), file).content;
      const temp = `${canonical}.chiku-patch-${process.pid}-${index}.tmp`;
      await writeFile(temp, next, { mode: original.mode });
      await rename(temp, canonical);
      await chmod(canonical, original.mode & 0o7777);
      written.push({
        ...original,
        appliedHash: hash(Buffer.from(next, "utf8")),
      });
    }
  } catch (error) {
    let rolledBack = true;
    for (const original of written.reverse()) {
      try {
        const current = await readFile(original.path);
        if (original.appliedHash && hash(current) === original.appliedHash)
          await writeFile(original.path, original.content, {
            mode: original.mode,
          });
        else rolledBack = false;
      } catch {
        rolledBack = false;
      }
    }
    throw new Error(
      `${error instanceof Error ? error.message : error}; rollback ${rolledBack ? "completed" : "incomplete"}`,
    );
  }
  const undoToken = randomToken();
  undoRecords.set(undoToken, { root, files: originals });
  return {
    applied: true,
    dryRun: false,
    files: previews,
    undoToken,
    rolledBack: false,
  };
}

function randomToken() {
  return createHash("sha256")
    .update(`${Date.now()}-${Math.random()}-${process.pid}`)
    .digest("hex");
}

export async function undoPatch(
  token: string,
  signal?: AbortSignal,
): Promise<{ undone: boolean; files: string[] }> {
  const record = undoRecords.get(token);
  if (!record) throw new Error("unknown or expired patch undo token");
  const restored: string[] = [];
  for (const file of record.files) {
    if (signal?.aborted) throw new Error("undo cancelled");
    await assertNoSymlinkRace(file.path);
    await writeFile(file.path, file.content, { mode: file.mode });
    await chmod(file.path, file.mode & 0o7777);
    restored.push(file.path);
  }
  undoRecords.delete(token);
  return { undone: true, files: restored };
}
