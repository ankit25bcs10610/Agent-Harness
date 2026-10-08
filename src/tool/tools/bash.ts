import type { Tool } from "../types";
import z from "zod";
import { ProcessExecutor } from "../../process/executor";

const executor = new ProcessExecutor();

export const bashTool: Tool<
  any,
  {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    durationMs: number;
    truncated: boolean;
    failure?: string;
  }
> = {
  name: "bash",
  description:
    "Run a non-interactive process in the project directory. Simple commands use direct argument-based spawning. Set shell=true only when pipes, chaining, redirects, command substitution, or other shell syntax is required. Output, timeout, cancellation, and failure metadata are returned.",
  parameters: z.object({
    command: z.string().describe("single non-interactive shell command to run"),
    shell: z
      .boolean()
      .optional()
      .describe("explicitly enable shell interpretation"),
    cwd: z.string().optional().describe("working directory for the process"),
    timeoutMs: z.number().int().positive().optional(),
    maxOutputChars: z.number().int().positive().optional(),
    env: z
      .record(z.string(), z.string())
      .optional()
      .describe("additional non-sensitive environment variables"),
  }),
  getPermissionKey: (args: any) => ({
    capability: "execute",
    target: args.command,
    explanation: `Run shell command: ${args.command}`,
    risk: "high",
  }),
  execute: async (args: any, signal, context) => {
    const result = await executor.run(
      {
        command: args.command,
        shell: args.shell,
        ...(context?.workspace?.authorizedRoot
          ? { workspaceRoot: context.workspace.authorizedRoot }
          : {}),
        cwd: args.cwd ?? context?.workspace?.cwd,
        timeoutMs: args.timeoutMs,
        maxOutputChars: args.maxOutputChars,
        env: (args.env ?? {}) as Record<string, string>,
      },
      signal,
    );
    if (result.failure) {
      throw new Error(JSON.stringify(result));
    }
    return result;
  },
};
