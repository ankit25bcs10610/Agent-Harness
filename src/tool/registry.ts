import { checkPermission } from "../permission/check";
import type { Allowed } from "../permission/types";
import type { ToolSpec } from "../provider";
import { bashTool } from "./tools/bash";
import { loadSkill } from "./tools/load_skill";
import { fileRead } from "./tools/read_file";
import { strReplace } from "./tools/str_replace";
import { fileWrite } from "./tools/write_file";
import { listFiles } from "./tools/list_files";
import { searchFiles } from "./tools/search_files";
import { searchSymbols } from "./tools/search_symbols";
import { applyPatchTool } from "./tools/apply_patch";
import { truncateStrings } from "./truncate_tool";
import type { Tool, ToolContext } from "./types";
import z from "zod";
import {
  repoOverview,
  indexStatus,
  rebuildIndex,
  findSymbol,
  findDependenciesTool,
  findDependentsTool,
  retrieveCodeContext,
  analyzeChangeImpact,
} from "./tools/repo_intelligence";
import { listSkills, recommendSkill } from "./tools/skills";
import {
  createChangeContract,
  listChangeContracts,
  validateChangeContract,
} from "./tools/change_contract";

const tools: Tool<any, unknown>[] = [
  bashTool,
  fileRead,
  strReplace,
  fileWrite,
  loadSkill,
  listFiles,
  searchFiles,
  searchSymbols,
  applyPatchTool,
  repoOverview,
  findSymbol,
  findDependenciesTool,
  findDependentsTool,
  retrieveCodeContext,
  analyzeChangeImpact,
  listSkills,
  recommendSkill,
  createChangeContract,
  validateChangeContract,
  listChangeContracts,
];

export const registry: Record<string, Tool<any, unknown>> = Object.fromEntries(
  tools.map((tool) => [tool.name, tool]),
);

export function registerExternalTools(external: readonly Tool<any, unknown>[]) {
  for (const tool of external) {
    if (registry[tool.name]) continue;
    tools.push(tool);
    registry[tool.name] = tool;
  }
}

export function generateToolsArray(): ToolSpec[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.parameters),
  }));
}

export async function runTool(
  name: string,
  args: string,
  ctx: ToolContext,
): Promise<string> {
  const tool = registry[name];

  if (!tool) {
    return `Error: unknown tool "${name}"`;
  }
  if (ctx.allowedTools && !ctx.allowedTools.includes(name)) {
    return `Not allowed to run tool: ${name}, reason: agent capability policy denies this tool`;
  }

  let jsonParsed: unknown;
  try {
    jsonParsed = JSON.parse(args);
  } catch {
    return `Error: malformed JSON arguments for tool "${name}": ${args}`;
  }

  const parsedArgs = tool.parameters.safeParse(jsonParsed);
  if (!parsedArgs.success) {
    return `Error: invalid arguments for tool "${name}": ${parsedArgs.error.message}`;
  }
  if (
    ctx.requiredContractId &&
    ["apply_patch", "str_replace", "write_file"].includes(name)
  ) {
    const contractId =
      typeof parsedArgs.data === "object" &&
      parsedArgs.data !== null &&
      "contractId" in parsedArgs.data
        ? (parsedArgs.data as { contractId?: unknown }).contractId
        : undefined;
    if (contractId !== ctx.requiredContractId)
      return `Not allowed to run tool: ${name}, reason: required change contract ${ctx.requiredContractId} is not bound to this task`;
  }

  const allowedToRun: Allowed = await checkPermission(
    tool,
    parsedArgs.data,
    ctx.permissions,
    ctx.asker,
  );

  if (!allowedToRun.ok)
    return `Not allowed to run tool: ${name}, reason: ${allowedToRun.reason}`;

  try {
    const run = await tool.execute(parsedArgs.data, ctx.signal, ctx);
    return JSON.stringify(truncateStrings(run, ctx.maxOutputChars));
  } catch (error) {
    const message = error instanceof Error ? error.message : error;
    return truncateStrings(
      `Error: tool "${name}" failed: ${message}`,
      ctx.maxOutputChars,
    ) as string;
  }
}
