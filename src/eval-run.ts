import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  createLocalProviderAdapter,
  completeStream,
  inspectLocalEndpoint,
  localEndpointFromEnv,
} from "./provider";
import { generateSystemPrompt } from "./context/system_prompt";
import { CONFIG, TOOLS } from "./config";
import { runLoop } from "./loop/loop";
import { createSession, saveSession } from "./session/store";
import type { PermSession, Asker } from "./permission/types";
import { isSensitivePath, isWithin } from "./permission/match";
import { runGit } from "./workspace/git";
import type { CompleteStreamFunc } from "./provider";

export type EvaluationRunOptions = {
  workspace: string;
  taskFile: string;
  resultFile: string;
  timeoutMs: number;
  model?: string;
  provider?: string;
};

type EvaluationStatus =
  "COMPLETED" | "REAL_MODEL_BLOCKED" | "HARNESS_BLOCKED" | "FAILED";

type EvaluationEvidence = {
  status: EvaluationStatus;
  startedAt: string;
  finishedAt: string;
  workspace: string;
  taskFile: string;
  model?: string;
  provider?: string;
  stopReason?: string;
  execution?: unknown;
  changedFiles?: string[];
  permissionAudit: PermSession["audit"];
  error?: string;
  note?: string;
};

function safeRelative(root: string, target: string): string | undefined {
  const rel = relative(root, target);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : undefined;
}

function evaluationPathAllowed(root: string, target: string): boolean {
  const rel = safeRelative(root, target);
  if (!rel || isSensitivePath(target)) return false;
  const first = rel.split(/[\\/]/, 1)[0];
  return first !== ".git" && first !== ".chiku";
}

function evaluationCommandAllowed(command: string): boolean {
  if (!command || /[;&|<>`$()\n\r]/.test(command)) return false;
  if (
    /\b(rm|sudo|curl|wget|ssh|scp|git\s+(push|reset|clean|checkout))\b/i.test(
      command,
    )
  )
    return false;
  return /^(?:bun\s+(?:test|run\s+(?:test|typecheck|lint|build))|npm\s+(?:test|run\s+(?:test|typecheck|lint|build))|pnpm\s+(?:test|run\s+(?:test|typecheck|lint|build))|yarn\s+(?:test|run\s+(?:test|typecheck|lint|build))|git\s+(?:status(?:\s+--short)?|diff(?:\s+--(?:name-only|stat))?))$/.test(
    command.trim(),
  );
}

function createEvaluationAsker(root: string, permissions: PermSession): Asker {
  return async (key) => {
    if (key.capability === "execute") {
      if (evaluationCommandAllowed(key.target)) return "allow-once";
      return "deny";
    }
    if (
      ["read", "create", "modify"].includes(key.capability) &&
      evaluationPathAllowed(root, key.target)
    )
      return "allow-once";
    return "deny";
  };
}

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function providerForEvaluation(
  model: string,
  provider: string | undefined,
): Promise<{
  complete: CompleteStreamFunc;
  provider: string;
}> {
  const local = provider === "local" || model.startsWith("local/");
  if (local) {
    const endpoint = localEndpointFromEnv();
    if (!endpoint)
      throw new Error("REAL_MODEL_BLOCKED: local provider is not configured");
    const inspection = inspectLocalEndpoint(endpoint);
    if (!inspection.allowed)
      throw new Error(
        `REAL_MODEL_BLOCKED: local endpoint rejected: ${inspection.reason}`,
      );
    const adapter = createLocalProviderAdapter(endpoint);
    if (!adapter.completeStream)
      throw new Error(
        "HARNESS_BLOCKED: local provider has no streaming adapter",
      );
    return {
      complete: adapter.completeStream,
      provider: endpoint.providerId ?? "local",
    };
  }
  if (process.env.CHIKU_EVAL_ALLOW_EXTERNAL_PROVIDER !== "1")
    throw new Error(
      "REAL_MODEL_BLOCKED: external provider use requires CHIKU_EVAL_ALLOW_EXTERNAL_PROVIDER=1",
    );
  return { complete: completeStream, provider: "openrouter" };
}

export async function runEvaluation(
  options: EvaluationRunOptions,
): Promise<EvaluationEvidence> {
  const started = new Date().toISOString();
  const root = resolve(options.workspace);
  const taskFile = resolve(options.taskFile);
  const resultFile = resolve(options.resultFile);
  const permissions: PermSession = { projectRoot: root, grants: [], audit: [] };
  let evidence: EvaluationEvidence;
  try {
    await access(root, constants.R_OK);
    const task = (await readFile(taskFile, "utf8")).trim();
    if (!task) throw new Error("HARNESS_BLOCKED: task file is empty");
    const model = options.model ?? process.env.CHIKU_MODEL ?? CONFIG.loopModel;
    const selectedProvider = options.provider ?? process.env.CHIKU_PROVIDER;
    const selected = await providerForEvaluation(model, selectedProvider);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    const session = createSession(task.slice(0, 80), "evaluation");
    const systemPrompt = await generateSystemPrompt();
    const ctx = {
      permissions,
      asker: createEvaluationAsker(root, permissions),
      signal: controller.signal,
      maxOutputChars: TOOLS.maxOutputChars,
      workspace: {
        workspaceId: randomUUID(),
        repositoryIdentity: root,
        authorizedRoot: root,
        cwd: root,
        sessionId: session.id,
        taskId: `evaluation-${session.id}`,
        signal: controller.signal,
        executionLimits: { wallClockMs: options.timeoutMs },
        contractIds: [] as string[],
      },
    };
    try {
      const output = await runLoop({
        messages: [{ type: "user", content: task }],
        complete: selected.complete,
        systemPrompt,
        config: {
          ...CONFIG,
          loopModel: model,
          wallClockMs: options.timeoutMs,
        },
        ctx,
        checkpoint: async (state) => {
          session.state = state;
          session.status = "active";
          session.updatedAt = new Date().toISOString();
          await saveSession(session, resolve(root, ".chiku", "sessions"));
        },
      });
      const changed = await runGit(root, ["diff", "--name-only"]).catch(
        () => "",
      );
      evidence = {
        status: output.stopReason === "stop" ? "COMPLETED" : "FAILED",
        startedAt: started,
        finishedAt: new Date().toISOString(),
        workspace: root,
        taskFile,
        model,
        provider: selected.provider,
        stopReason: output.stopReason,
        execution: output.execution,
        changedFiles: changed ? changed.split("\n").filter(Boolean) : [],
        permissionAudit: permissions.audit,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status: EvaluationStatus = message.startsWith("REAL_MODEL_BLOCKED")
      ? "REAL_MODEL_BLOCKED"
      : message.startsWith("HARNESS_BLOCKED")
        ? "HARNESS_BLOCKED"
        : "FAILED";
    evidence = {
      status,
      startedAt: started,
      finishedAt: new Date().toISOString(),
      workspace: root,
      taskFile,
      permissionAudit: permissions.audit,
      error: message,
    };
  }
  await atomicJson(resultFile, evidence);
  return evidence;
}
