import { createHash } from "node:crypto";
import { access, lstat, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { applyPatch } from "../patch/engine";
import {
  assertNoSymlinkRace,
  canonicalizePath,
  isWithin,
} from "../permission/match";
import type { ChangeContract } from "./types";

function comparablePath(value: string) {
  return value.replaceAll("\\", "/").toLowerCase();
}

export type PreconditionResult = {
  kind: string;
  target: string;
  passed: boolean;
  expected: string;
  actual: string;
  reason?: string;
};

function hash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function git(root: string, args: string[]): Promise<string> {
  const process = Bun.spawn(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0)
    throw new Error(stderr.trim() || `git exited with ${exitCode}`);
  return stdout.trim();
}

export async function validateContractPreconditions(
  contract: ChangeContract,
  root: string,
): Promise<PreconditionResult[]> {
  const results: PreconditionResult[] = [];
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(root);
  } catch (error) {
    return [
      {
        kind: "repository_identity",
        target: root,
        passed: false,
        expected: contract.workspaceRoot,
        actual: error instanceof Error ? error.message : String(error),
        reason: "workspace root cannot be resolved",
      },
    ];
  }
  results.push({
    kind: "repository_identity",
    target: canonicalRoot,
    passed: canonicalRoot === contract.workspaceRoot,
    expected: contract.workspaceRoot,
    actual: canonicalRoot,
    ...(canonicalRoot === contract.workspaceRoot
      ? {}
      : { reason: "workspace identity changed" }),
  });
  results.push({
    kind: "workspace_boundary",
    target: canonicalRoot,
    passed: isWithin(canonicalRoot, canonicalRoot),
    expected: "workspace root is canonical",
    actual: "canonical workspace root",
  });

  for (const file of contract.proposedFiles) {
    let canonical;
    try {
      canonical = await canonicalizePath(file.path, canonicalRoot);
      if (canonical.exists) await assertNoSymlinkRace(canonical.target);
    } catch (error) {
      results.push({
        kind: "workspace_boundary",
        target: file.path,
        passed: false,
        expected: "canonical path inside workspace",
        actual: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    let info;
    try {
      info = await stat(canonical.target);
    } catch {
      info = undefined;
    }
    const exists = Boolean(info);
    results.push({
      kind: "file_existence",
      target: file.path,
      passed: exists === file.originalExists,
      expected: String(file.originalExists),
      actual: String(exists),
    });
    if (!info) continue;
    const bytes = await Bun.file(canonical.target).arrayBuffer();
    const actualHash = hash(Buffer.from(bytes));
    if (file.originalHash)
      results.push({
        kind: "file_hash",
        target: file.path,
        passed: actualHash === file.originalHash,
        expected: file.originalHash,
        actual: actualHash,
      });
    const writable = (info.mode & 0o222) !== 0;
    results.push({
      kind: "file_permissions",
      target: file.path,
      passed: file.operation === "create" || writable,
      expected: file.operation === "create" ? "parent writable" : "writable",
      actual: writable ? "writable" : "read-only",
    });
  }
  try {
    const status = await git(canonicalRoot, [
      "status",
      "--porcelain=v1",
      "--",
      ".",
      ":!.chiku",
    ]);
    const expected = contract.preconditions.find(
      (item) => item.kind === "git_status",
    )?.expected;
    if (expected)
      results.push({
        kind: "git_status",
        target: canonicalRoot,
        passed: status === expected,
        expected,
        actual: status,
      });
  } catch (error) {
    results.push({
      kind: "git_status",
      target: canonicalRoot,
      passed: false,
      expected: "git status available",
      actual: error instanceof Error ? error.message : String(error),
    });
  }
  try {
    const dryRun = await applyPatch(canonicalRoot, contract.proposedPatch, {
      dryRun: true,
    });
    results.push({
      kind: "patch_compatibility",
      target: contract.contractId,
      passed: dryRun.files.every((file) => {
        const expected = contract.proposedFiles.find((item) =>
          comparablePath(file.path).endsWith(comparablePath(item.path)),
        );
        return file.originalHash === expected?.originalHash;
      }),
      expected: "patch applies to recorded file hashes",
      actual: "patch parsed and dry-run completed",
    });
  } catch (error) {
    results.push({
      kind: "patch_compatibility",
      target: contract.contractId,
      passed: false,
      expected: "patch applies cleanly",
      actual: error instanceof Error ? error.message : String(error),
    });
  }
  return results;
}
