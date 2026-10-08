import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { applyPatch, parsePatch } from "../patch/engine";
import { buildRepositoryIndex, analyzeImpact } from "../intelligence";
import { discoverVerificationCommands } from "../workflow/verify";
import { validateContractPreconditions } from "./preconditions";
import type { ChangeContract, ContractFileChange } from "./types";

export type PlanChangeInput = {
  root: string;
  taskId: string;
  sessionId: string;
  userRequest: string;
  objective: string;
  patch: string;
};

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

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function riskFor(files: ContractFileChange[], dependentFiles: string[]) {
  const reasons: string[] = [];
  let score = 0;
  for (const file of files) {
    if (file.operation === "delete") {
      score += 35;
      reasons.push(`deletes ${file.path}`);
    } else if (file.operation === "create") score += 5;
    else score += 10;
  }
  if (files.length > 3) {
    score += 15;
    reasons.push("changes multiple files");
  }
  if (dependentFiles.length > files.length) {
    score += 15;
    reasons.push("has dependent files");
  }
  const level =
    score >= 70
      ? "critical"
      : score >= 45
        ? "high"
        : score >= 20
          ? "medium"
          : "low";
  return {
    level,
    score: Math.min(100, score),
    reasons: reasons.length ? reasons : ["bounded source change"],
  } as const;
}

export async function planChange(
  input: PlanChangeInput,
): Promise<ChangeContract> {
  const root = await realpath(input.root);
  const patchFiles = parsePatch(input.patch);
  const preview = await applyPatch(root, input.patch, { dryRun: true });
  const index = await buildRepositoryIndex(
    { root },
    new AbortController().signal,
  );
  const paths = patchFiles.map((file) => file.path);
  const impact = analyzeImpact(index, paths);
  const currentStatus = await git(root, [
    "status",
    "--porcelain=v1",
    "--",
    ".",
    ":!.chiku",
  ]);
  const repositoryIdentity = await git(root, [
    "remote",
    "get-url",
    "origin",
  ]).catch(() => root);
  const head = await git(root, ["rev-parse", "HEAD"]).catch(
    () => "uncommitted",
  );
  const proposedFiles: ContractFileChange[] = [];
  for (const [indexNumber, file] of patchFiles.entries()) {
    const previewFile = preview.files[indexNumber];
    const existing = await stat(
      previewFile?.path ?? join(root, file.path),
    ).catch(() => undefined);
    const originalHash = previewFile?.originalHash ?? null;
    proposedFiles.push({
      path: file.path,
      operation: file.operation ?? "modify",
      originalExists: Boolean(existing),
      originalHash,
      proposedHash: previewFile?.proposedHash ?? null,
      mode: existing?.mode ?? null,
    });
  }
  const components = impact.map((item) => ({
    path: item.path,
    symbols: item.symbols,
    dependencies: index.edges
      .filter((edge) => edge.from === item.path)
      .map((edge) => edge.to),
  }));
  const risk = riskFor(
    proposedFiles,
    impact.filter((item) => !item.direct).map((item) => item.path),
  );
  const now = new Date().toISOString();
  const contract: ChangeContract = {
    contractId: randomUUID(),
    revision: 1,
    schemaVersion: 1,
    taskId: input.taskId,
    sessionId: input.sessionId,
    userRequest: input.userRequest,
    objective: input.objective,
    workspaceRoot: root,
    repositoryIdentity,
    proposedPatch: input.patch,
    proposedFiles,
    affectedComponents: components,
    preconditions: [
      {
        kind: "repository_identity",
        target: root,
        expected: repositoryIdentity,
      },
      { kind: "workspace_boundary", target: root, expected: root },
      ...proposedFiles.map((file) => ({
        kind: "file_hash" as const,
        target: file.path,
        expected: file.originalHash ?? "missing",
      })),
      {
        kind: "patch_compatibility",
        target: input.taskId,
        expected: "dry-run succeeds",
      },
      { kind: "git_status", target: root, expected: currentStatus },
      {
        kind: "symbol_dependency",
        target: root,
        expected: `${components.length} affected components at ${head}`,
      },
    ],
    impactAnalysis: {
      changedFiles: paths,
      dependentFiles: impact
        .filter((item) => !item.direct)
        .map((item) => item.path),
      symbols: components.flatMap((component) => component.symbols),
      reasons: impact.map((item) => `${item.path}: ${item.reason}`),
    },
    riskAssessment: risk,
    permissionRequirements: proposedFiles.map((file) => ({
      capability:
        file.operation === "create"
          ? "create"
          : file.operation === "delete"
            ? "delete"
            : "modify",
      target: file.path,
      explanation: `${file.operation} ${file.path} as part of contract ${input.taskId}`,
      risk: risk.level === "low" ? "normal" : "high",
    })),
    verificationPlan: (await discoverVerificationCommands(root)).map(
      (check) => ({ ...check, required: true }),
    ),
    rollback: {
      strategy: "patch-undo-token",
      undoToken: null,
      notes: "Record the apply_patch undo token before accepting the contract.",
    },
    status: "proposed",
    createdAt: now,
    updatedAt: now,
    evidenceReferences: [
      `git:${head}`,
      ...preview.files
        .filter((file) => file.changed)
        .map((file) => `diff:${relative(root, file.path)}`),
    ],
    outcome: null,
  };
  const validation = await validateContractPreconditions(contract, root);
  if (validation.some((item) => !item.passed))
    throw new Error(
      `contract preconditions are not stable: ${validation
        .filter((item) => !item.passed)
        .map((item) => item.kind)
        .join(", ")}`,
    );
  return contract;
}
