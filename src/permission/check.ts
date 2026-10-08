import type { Tool } from "../tool/types";
import { checkCommand, checkPath } from "./match";
import type {
  Allowed,
  Asker,
  PermissionDecision,
  PermissionKey,
  PermSession,
  UserDecision,
} from "./types";

function audit(
  permissions: PermSession,
  key: PermissionKey,
  decision: PermissionDecision | UserDecision,
  reason: string,
) {
  permissions.audit.push({
    at: new Date().toISOString(),
    capability: key.capability,
    target: key.target,
    decision,
    reason,
  });
}

export async function checkPermission(
  tool: Tool<any, unknown>,
  args: any,
  permissions: PermSession,
  asker: Asker,
): Promise<Allowed> {
  const rawKey = tool.getPermissionKey(args);
  if (!rawKey) return { ok: true };

  let key = rawKey;
  let decision: PermissionDecision;
  try {
    if (rawKey.capability === "execute") {
      decision = checkCommand(rawKey.target, permissions.grants);
    } else if (rawKey.capability !== "external") {
      const checked = await checkPath(
        rawKey.target,
        permissions.projectRoot,
        rawKey.capability,
        permissions.grants,
      );
      key = { ...rawKey, target: checked.target };
      decision = checked.decision;
      if (decision === "deny") {
        audit(permissions, key, decision, checked.reason);
        return { ok: false, reason: checked.reason };
      }
    } else {
      decision = "ask";
    }
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : "authorization path validation failed";
    audit(permissions, key, "deny", reason);
    return { ok: false, reason };
  }

  if (decision === "allow") {
    audit(permissions, key, decision, "capability grant matched");
    return { ok: true };
  }

  const userDecision = await asker(key, decision);
  audit(permissions, key, userDecision, key.explanation);
  if (userDecision === "deny")
    return {
      ok: false,
      reason: "User denied tool use with the provided arguments",
    };

  if (decision === "ask" && userDecision !== "allow-once") {
    permissions.grants.push({
      capability: key.capability,
      scope: userDecision === "allow-always-exact" ? "exact" : "prefix",
      target: key.target,
    });
  }
  return { ok: true };
}
