export type Capability =
  "read" | "create" | "modify" | "delete" | "execute" | "external";

export type PermissionDecision = "allow" | "deny" | "ask";

export type PermissionKey = {
  capability: Capability;
  target: string;
  explanation: string;
  risk: "normal" | "high";
};

export type PermissionGrant = {
  capability: Capability;
  scope: "exact" | "prefix";
  target: string;
};

export type PermissionAuditEvent = {
  at: string;
  capability: Capability;
  target: string;
  decision: PermissionDecision | UserDecision;
  reason: string;
};

export type PermSession = {
  projectRoot: string;
  grants: PermissionGrant[];
  audit: PermissionAuditEvent[];
};

export type Allowed = { ok: true } | { ok: false; reason: string };

export type UserDecision =
  "allow-once" | "allow-always-exact" | "allow-always-prefix" | "deny";

export type Asker = (
  key: PermissionKey,
  decision: PermissionDecision,
) => Promise<UserDecision>;
