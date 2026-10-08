import z from "zod";
import { listRepositoryFiles } from "../repository";
import type { Tool } from "../types";
import { workspaceRoot } from "../../workspace";

export const listFiles: Tool<any, unknown> = {
  name: "list_files",
  description:
    "List bounded repository files with paths, sizes, extensions, pagination, gitignore-aware exclusions, and binary-safe metadata.",
  parameters: z.object({
    path: z.string().optional(),
    glob: z.string().optional(),
    exclude: z.array(z.string()).optional(),
    respectGitignore: z.boolean().optional(),
    maxResults: z.number().int().positive().optional(),
    cursor: z.number().int().nonnegative().optional(),
    timeoutMs: z.number().int().positive().optional(),
  }),
  getPermissionKey: (args: any) => ({
    capability: "read",
    target: args.path ?? ".",
    explanation: `List repository files under: ${args.path ?? "."}`,
    risk: "normal",
  }),
  execute: async (args: any, signal, context) =>
    listRepositoryFiles(
      { root: await workspaceRoot(context?.workspace, args.path), ...args },
      signal,
    ),
};
