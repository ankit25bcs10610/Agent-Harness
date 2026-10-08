import z from "zod";
import { searchRepository } from "../repository";
import type { Tool } from "../types";
import { workspaceRoot } from "../../workspace";

export const searchFiles: Tool<any, unknown> = {
  name: "search_files",
  description:
    "Search repository text efficiently with ripgrep when available. Supports literal or regex queries, bounded results, pagination, exclusions, gitignore, cancellation, and time limits.",
  parameters: z.object({
    query: z.string().min(1),
    path: z.string().optional(),
    regex: z.boolean().optional(),
    glob: z.string().optional(),
    exclude: z.array(z.string()).optional(),
    respectGitignore: z.boolean().optional(),
    maxResults: z.number().int().positive().optional(),
    maxChars: z.number().int().positive().optional(),
    cursor: z.number().int().nonnegative().optional(),
    timeoutMs: z.number().int().positive().optional(),
  }),
  getPermissionKey: (args: any) => ({
    capability: "read",
    target: args.path ?? ".",
    explanation: `Search repository text under ${args.path ?? "."}: ${args.query}`,
    risk: "normal",
  }),
  execute: async (args: any, signal, context) => {
    if (!args.regex)
      args.query = args.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else {
      try {
        new RegExp(args.query);
      } catch (error) {
        throw new Error(
          `invalid regular expression: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    return searchRepository(
      args.query,
      { root: await workspaceRoot(context?.workspace, args.path), ...args },
      signal,
    );
  },
};
