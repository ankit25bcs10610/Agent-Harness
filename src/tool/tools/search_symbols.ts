import z from "zod";
import { searchRepositorySymbols } from "../repository";
import type { Tool } from "../types";
import { workspaceRoot } from "../../workspace";

export const searchSymbols: Tool<any, unknown> = {
  name: "search_symbols",
  description:
    "Find common function, class, type, interface, enum, and variable declarations using a lightweight source-pattern index.",
  parameters: z.object({
    name: z.string().optional(),
    path: z.string().optional(),
    glob: z.string().optional(),
    exclude: z.array(z.string()).optional(),
    maxResults: z.number().int().positive().optional(),
    cursor: z.number().int().nonnegative().optional(),
    timeoutMs: z.number().int().positive().optional(),
  }),
  getPermissionKey: (args: any) => ({
    capability: "read",
    target: args.path ?? ".",
    explanation: `Search source symbols under ${args.path ?? "."}`,
    risk: "normal",
  }),
  execute: async (args: any, signal, context) => {
    if (args.name && !/^[A-Za-z_$][\w$]*$/.test(args.name))
      throw new Error("symbol name must be an identifier");
    return searchRepositorySymbols(
      args.name,
      { root: await workspaceRoot(context?.workspace, args.path), ...args },
      signal,
    );
  },
};
