import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkPermission } from "../permission/check";
import { bashTool } from "../tool/tools/bash";
import type { ToolContext } from "../tool/types";
import { ProcessExecutor } from "../process/executor";
import type { ToolCall } from "../provider";
import type {
  RepairHook,
  VerificationCheck,
  VerificationReport,
  WorkflowController,
  WorkflowEvents,
  WorkflowPolicy,
  WorkflowPhase,
} from "./types";

const CHECK_NAMES = ["typecheck", "lint", "test", "build"] as const;

export async function discoverVerificationCommands(
  root: string,
): Promise<{ name: string; command: string }[]> {
  try {
    const packageJson = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string>; packageManager?: string };
    const scripts = packageJson.scripts ?? {};
    const runner = packageJson.packageManager?.split("@")[0] ?? "bun";
    return CHECK_NAMES.filter((name) => typeof scripts[name] === "string").map(
      (name) => ({ name, command: `${runner} run ${name}` }),
    );
  } catch {
    return [];
  }
}

function filesFromCall(call: ToolCall): string[] {
  try {
    const args = JSON.parse(call.arguments) as Record<string, unknown>;
    if (typeof args.path === "string") return [args.path];
    if (typeof args.patch === "string") {
      return [...args.patch.matchAll(/(?:Update|Add|Delete) File: ([^\n]+)/g)]
        .map((match) => match[1]!)
        .filter(Boolean)
        .concat(
          [...args.patch.matchAll(/^\+\+\+ (?:b\/)?([^\t\n]+)/gm)]
            .map((match) => match[1]!)
            .filter(Boolean),
        );
    }
  } catch {
    /* malformed calls are reported by the normal tool path */
  }
  return [];
}

function phase(events: WorkflowEvents | undefined, value: WorkflowPhase) {
  events?.onPhase?.(value);
}

export function createWorkflowController(
  policy: WorkflowPolicy,
  ctx: ToolContext,
  events?: WorkflowEvents,
  repair?: RepairHook,
): WorkflowController {
  const observed = new Set<string>();
  let repairAttempts = 0;
  const executor = new ProcessExecutor();
  phase(events, "task_intake");
  phase(events, "repository_inspection");
  const execute = async (
    command: string,
    signal: AbortSignal,
  ): Promise<VerificationCheck> => {
    const allowed = await checkPermission(
      bashTool,
      { command },
      ctx.permissions,
      ctx.asker,
    );
    if (!allowed.ok)
      return {
        name: command.split(/\s+/)[2] ?? command,
        command,
        status: "untested",
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
        reason: allowed.reason,
      };
    const result = await executor.run(
      {
        command,
        cwd: policy.root,
        workspaceRoot: policy.root,
        timeoutMs: policy.commandTimeoutMs,
        maxOutputChars: policy.maxOutputChars,
      },
      signal,
    );
    const check: VerificationCheck = {
      name: command.split(/\s+/)[2] ?? command,
      command,
      status: result.failure || result.exitCode !== 0 ? "failed" : "passed",
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      ...(result.failure ? { reason: result.failure } : {}),
    };
    events?.onVerification?.(check);
    return check;
  };
  return {
    recordToolCall(call) {
      phase(
        events,
        call.name === "read_file" ||
          call.name === "list_files" ||
          call.name === "search_files" ||
          call.name === "search_symbols"
          ? "repository_inspection"
          : "proposed_changes",
      );
      phase(events, "permission_evaluation");
      if (
        call.name === "apply_patch" ||
        call.name === "str_replace" ||
        call.name === "write_file"
      )
        phase(events, "patch_execution");
      for (const file of filesFromCall(call)) observed.add(file);
    },
    async finalize(stopReason, signal) {
      if (!policy.enabled || observed.size === 0) return undefined;
      phase(events, "verification");
      const checks = await discoverVerificationCommands(policy.root);
      let results = await Promise.all(
        checks.map((check) => execute(check.command, signal)),
      );
      while (
        results.some((check) => check.status === "failed") &&
        repair &&
        repairAttempts < policy.maxRepairAttempts &&
        !signal.aborted
      ) {
        phase(events, "failure_analysis");
        repairAttempts++;
        phase(events, "bounded_repair");
        const report: VerificationReport = {
          phase: "final_evidence",
          changedFiles: [...observed],
          plannedFiles: policy.plannedFiles ?? [],
          checks: results,
          repairAttempts,
          passed: false,
          remainingRisks: [
            "repair was requested but verification is not yet passing",
          ],
        };
        if (!(await repair(report, signal))) break;
        phase(events, "verification");
        results = await Promise.all(
          checks.map((check) => execute(check.command, signal)),
        );
      }
      phase(events, "final_evidence");
      return {
        phase: "final_evidence",
        changedFiles: [...observed],
        plannedFiles: policy.plannedFiles ?? [],
        checks: results,
        repairAttempts,
        passed:
          results.length > 0 &&
          results.every((check) => check.status === "passed"),
        remainingRisks: [
          stopReason !== "stop"
            ? `agent stopped with ${stopReason}`
            : "No runtime verification exists for behavior not covered by discovered checks",
          ...(results.length === 0
            ? ["No supported verification scripts were discovered"]
            : []),
          ...(results.some((check) => check.status === "untested")
            ? [
                "One or more checks were not authorized or could not be executed",
              ]
            : []),
        ],
      };
    },
  };
}
