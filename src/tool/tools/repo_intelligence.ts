import { z } from "zod";
import {
  buildRepositoryIndex,
  findDependencies,
  findDependents,
  findSymbols,
  analyzeImpact,
  loadRepositoryIndex,
  retrieve,
  saveRepositoryIndex,
} from "../../intelligence";
import type { Tool } from "../types";
import { workspaceRoot } from "../../workspace";
const root = z.string().optional();
const permission = (operation: string, target: unknown) => ({
  capability: "read" as const,
  target: typeof target === "string" ? target : ".",
  explanation: `${operation} repository structure`,
  risk: "normal" as const,
});
export const repoOverview: Tool<any, unknown> = {
  name: "repo_overview",
  description: "Build a bounded structural repository overview.",
  parameters: z.object({ root }),
  getPermissionKey: (args) => permission("Inspect", args.root),
  execute: async (args: any, signal, context) => {
    const directory = await workspaceRoot(context?.workspace, args.root);
    const index = await buildRepositoryIndex({ root: directory }, signal);
    await saveRepositoryIndex(
      index,
      `${directory}/.chiku/repository-index.json`,
    );
    return {
      files: index.files.length,
      symbols: index.symbols.length,
      edges: index.edges.length,
      languages: [...new Set(index.files.map((file) => file.language))],
      errors: index.errors,
    };
  },
};
export const indexStatus: Tool<any, unknown> = {
  name: "index_status",
  description: "Report repository index freshness and diagnostics.",
  parameters: z.object({ root }),
  getPermissionKey: (args) => permission("Inspect index status for", args.root),
  execute: async (args: any, _signal, context) => {
    const directory = await workspaceRoot(context?.workspace, args.root);
    const index = await loadRepositoryIndex(
      `${directory}/.chiku/repository-index.json`,
    );
    return index
      ? {
          indexed: true,
          createdAt: index.createdAt,
          files: index.files.length,
          symbols: index.symbols.length,
          edges: index.edges.length,
          errors: index.errors,
        }
      : { indexed: false };
  },
};
export const rebuildIndex: Tool<any, unknown> = {
  name: "rebuild_index",
  description: "Rebuild and persist the repository intelligence index.",
  parameters: z.object({ root }),
  getPermissionKey: (args) => permission("Rebuild index for", args.root),
  execute: async (args: any, signal, context) => {
    const directory = await workspaceRoot(context?.workspace, args.root);
    const index = await buildRepositoryIndex({ root: directory }, signal);
    await saveRepositoryIndex(
      index,
      `${directory}/.chiku/repository-index.json`,
    );
    return {
      files: index.files.length,
      symbols: index.symbols.length,
      edges: index.edges.length,
      errors: index.errors,
    };
  },
};
export const analyzeChangeImpact: Tool<any, unknown> = {
  name: "analyze_change_impact",
  description: "Identify evidence-based dependent files for changed paths.",
  parameters: z.object({
    paths: z.array(z.string().min(1)).min(1),
    root,
    depth: z.number().int().min(1).max(8).optional(),
  }),
  getPermissionKey: (args) => permission("Analyze impact for", args.root),
  execute: async (args: any, signal, context) =>
    analyzeImpact(
      await buildRepositoryIndex(
        { root: await workspaceRoot(context?.workspace, args.root) },
        signal,
      ),
      args.paths,
      args.depth ?? 2,
    ),
};
export const findSymbol: Tool<any, unknown> = {
  name: "find_symbol",
  description: "Find parsed symbol definitions.",
  parameters: z.object({ query: z.string().min(1), root }),
  getPermissionKey: (args) => permission("Search", args.root),
  execute: async (args: any, signal, context) =>
    findSymbols(
      await buildRepositoryIndex(
        { root: await workspaceRoot(context?.workspace, args.root) },
        signal,
      ),
      args.query,
    ),
};
export const findDependenciesTool: Tool<any, unknown> = {
  name: "find_dependencies",
  description: "Find bounded file dependencies.",
  parameters: z.object({
    path: z.string().min(1),
    root,
    depth: z.number().int().min(1).max(8).optional(),
  }),
  getPermissionKey: (args) => permission("Inspect dependencies for", args.path),
  execute: async (args: any, signal, context) =>
    findDependencies(
      await buildRepositoryIndex(
        { root: await workspaceRoot(context?.workspace, args.root) },
        signal,
      ),
      args.path,
      args.depth ?? 1,
    ),
};
export const findDependentsTool: Tool<any, unknown> = {
  name: "find_dependents",
  description: "Find bounded file dependents.",
  parameters: z.object({
    path: z.string().min(1),
    root,
    depth: z.number().int().min(1).max(8).optional(),
  }),
  getPermissionKey: (args) => permission("Inspect dependents for", args.path),
  execute: async (args: any, signal, context) =>
    findDependents(
      await buildRepositoryIndex(
        { root: await workspaceRoot(context?.workspace, args.root) },
        signal,
      ),
      args.path,
      args.depth ?? 1,
    ),
};
export const retrieveCodeContext: Tool<any, unknown> = {
  name: "retrieve_code_context",
  description: "Retrieve bounded symbol locations relevant to a task.",
  parameters: z.object({
    query: z.string().min(1),
    root,
    maxResults: z.number().int().min(1).max(100).optional(),
  }),
  getPermissionKey: (args) => permission("Retrieve", args.root),
  execute: async (args: any, signal, context) =>
    retrieve(
      await buildRepositoryIndex(
        { root: await workspaceRoot(context?.workspace, args.root) },
        signal,
      ),
      args.query,
      args.maxResults ?? 20,
    ),
};
