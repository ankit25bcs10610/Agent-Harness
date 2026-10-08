import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { ProcessExecutor } from "../process/executor";
import { checkPermission } from "../permission/check";
import { bashTool } from "../tool/tools/bash";
import type { ToolContext } from "../tool/types";

export type EnvironmentInfo = {
  packageManager: "bun" | "npm" | "pnpm" | "yarn" | "unknown";
  lockfile?: string;
  runtimeFiles: string[];
  installCommand?: string;
};

export async function detectEnvironment(
  root: string,
): Promise<EnvironmentInfo> {
  const candidates: [EnvironmentInfo["packageManager"], string, string][] = [
    ["bun", "bun.lock", "bun install --frozen-lockfile"],
    ["npm", "package-lock.json", "npm ci"],
    ["pnpm", "pnpm-lock.yaml", "pnpm install --frozen-lockfile"],
    ["yarn", "yarn.lock", "yarn install --immutable"],
  ];
  for (const [packageManager, lockfile, installCommand] of candidates) {
    try {
      await access(join(root, lockfile), constants.R_OK);
      return {
        packageManager,
        lockfile,
        runtimeFiles: ["package.json", lockfile],
        installCommand,
      };
    } catch {
      // Continue to the next supported lockfile.
    }
  }
  return { packageManager: "unknown", runtimeFiles: [] };
}

export async function prepareEnvironment(
  root: string,
  context: ToolContext,
  install = false,
) {
  const environment = await detectEnvironment(root);
  if (!install || !environment.installCommand)
    return {
      environment,
      installed: false,
      reason: "installation not requested",
    };
  const allowed = await checkPermission(
    bashTool,
    { command: environment.installCommand },
    context.permissions,
    context.asker,
  );
  if (!allowed.ok)
    return { environment, installed: false, reason: allowed.reason };
  const result = await new ProcessExecutor().run(
    {
      command: environment.installCommand,
      cwd: root,
      workspaceRoot: root,
      timeoutMs: 120_000,
      maxOutputChars: context.maxOutputChars,
    },
    context.signal,
  );
  return {
    environment,
    installed: !result.failure && result.exitCode === 0,
    result,
  };
}
