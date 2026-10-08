import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Capability, PermissionDecision, PermissionGrant } from "./types";

const CHAINING = /&&|\|\||[;|\u0060\n\r]|\$\(|>>|<<|[><]/;
const ALWAYS_ASK =
  /\brm\s+-[a-z]*r[a-z]*f\b|\bgit\s+push\s+.*(--force|-f)\b|\bgit\s+reset\s+.*--hard\b|\bgit\s+clean\s+.*-f\b|\bgit\s+branch\s+-D\b/i;
const SENSITIVE =
  /(^|[\\/])(?:\.env(?:\..*)?|\.ssh(?:[\\/]|$)|credentials?(?:\.|[\\/])|id_rsa(?:\.|$)|.*\.(?:pem|key|p12|pfx))$/i;

export function checkCommand(
  command: string,
  grants: PermissionGrant[],
): PermissionDecision {
  if (CHAINING.test(command) || ALWAYS_ASK.test(command)) return "ask";
  return grants.some(
    (item) =>
      item.capability === "execute" &&
      (item.scope === "exact"
        ? item.target === command
        : command === item.target || command.startsWith(item.target + " ")),
  )
    ? "allow"
    : "ask";
}

export function isSensitivePath(path: string): boolean {
  return SENSITIVE.test(path);
}

export function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function canonicalizeTarget(rawPath: string, projectRoot: string) {
  if (rawPath.includes("\0")) throw new Error("path contains a NUL byte");
  const root = await realpath(projectRoot);
  const candidate = isAbsolute(rawPath)
    ? resolve(rawPath)
    : resolve(root, rawPath);
  let current = candidate;
  const missing: string[] = [];
  while (true) {
    try {
      const resolved = await realpath(current);
      return {
        root,
        target: join(resolved, ...missing),
        exists: missing.length === 0,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current)
        throw new Error("path has no accessible ancestor");
      missing.unshift(current.slice(parent.length + 1));
      current = parent;
    }
  }
}

export async function canonicalizePath(rawPath: string, projectRoot: string) {
  const result = await canonicalizeTarget(rawPath, projectRoot);
  if (!isWithin(result.root, result.target))
    throw new Error("path escapes the workspace");
  return result;
}

export async function checkPath(
  rawPath: string,
  projectRoot: string,
  capability: Extract<Capability, "read" | "create" | "modify" | "delete">,
  grants: PermissionGrant[],
) {
  const result = await canonicalizePath(rawPath, projectRoot);
  if (isSensitivePath(result.target))
    return {
      decision: "deny" as const,
      target: result.target,
      reason: "sensitive file or credential path",
    };
  if (result.target.split("/").some((part) => part.startsWith("."))) {
    return {
      decision: "ask" as const,
      target: result.target,
      reason: "hidden path requires confirmation",
    };
  }
  const granted = grants.some(
    (item) =>
      item.capability === capability &&
      (item.scope === "exact"
        ? item.target === result.target
        : result.target === item.target ||
          result.target.startsWith(item.target + "/")),
  );
  return {
    decision: granted ? ("allow" as const) : ("ask" as const),
    target: result.target,
    reason: granted
      ? "matching capability-scoped grant"
      : capability + " operation on workspace path",
  };
}

export async function checkEdit(
  rawPath: string,
  projectRoot: string,
  grants: PermissionGrant[],
) {
  return checkPath(rawPath, projectRoot, "modify", grants);
}

export async function assertNoSymlinkRace(path: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink())
    throw new Error("target became a symbolic link during authorization");
}
