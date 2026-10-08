import { isAbsolute, relative, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import type { WorkspaceExecutionContext } from "./types";

export async function workspaceRoot(
  context: WorkspaceExecutionContext | undefined,
  requested?: string,
): Promise<string> {
  const base = context?.authorizedRoot ?? process.cwd();
  const target = await realpath(
    requested
      ? isAbsolute(requested)
        ? requested
        : resolve(base, requested)
      : base,
  );
  if (context) {
    const rel = relative(context.authorizedRoot, target);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw new Error("requested path is outside the active workspace");
  }
  return target;
}
