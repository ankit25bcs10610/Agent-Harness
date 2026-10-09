import { expect, test } from "bun:test";
import {
  GovernanceBroker,
  newGovernanceAction,
  policyDigest,
} from "../../src/governance";
import { runTool } from "../../src/tool/registry";

const identity = {
  actorId: "user-1",
  actorType: "human" as const,
  tenantId: "tenant-a",
  workspaceId: "workspace-a",
  sessionId: "session-a",
  credential: {
    id: "credential-a",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
};

const action = () =>
  newGovernanceAction({
    operation: "bash",
    capability: "execute",
    target: "git status",
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    risk: "normal",
    consequence: "execute a read-only status command",
  });

function policy(effect: "allow" | "deny" | "approval") {
  const base = {
    schemaVersion: 1 as const,
    policyId: "policy-a",
    organizationId: "tenant-a",
    version: 1,
    issuer: "local-admin",
    rules: [{ id: "rule-1", effect, capabilities: ["execute" as const] }],
  };
  return { ...base, provenance: { digest: policyDigest(base) } };
}

test("governance rejects expired or forged identity scope before execution", () => {
  expect(
    () =>
      new GovernanceBroker(
        {
          ...identity,
          credential: {
            ...identity.credential,
            expiresAt: new Date(Date.now() - 1).toISOString(),
          },
        },
        policy("allow"),
      ),
  ).toThrow("expired");
  const broker = new GovernanceBroker(identity, policy("allow"));
  expect(broker.authorize({ ...action(), tenantId: "tenant-b" })).toBe("DENY");
});

test("organization deny and system deny override lower-trust allow rules", () => {
  const broker = new GovernanceBroker(identity, policy("deny"));
  expect(broker.authorize(action())).toBe("DENY");
  const systemDenied = new GovernanceBroker(identity, policy("allow"), [
    "execute",
  ]);
  expect(systemDenied.authorize(action())).toBe("DENY");
});

test("approval is exact, scoped, expiring, and revocable", () => {
  const approvalBroker = new GovernanceBroker(identity, policy("approval"));
  const first = action();
  expect(approvalBroker.authorize(first)).toBe("REQUIRES_APPROVAL");
  const approval = approvalBroker.requestApproval(first, 10_000);
  expect(approvalBroker.authorizeApproved(first, approval.approvalId)).toBe(
    true,
  );
  expect(
    approvalBroker.authorizeApproved(
      { ...first, target: "git log" },
      approval.approvalId,
    ),
  ).toBe(false);
  approvalBroker.revokeApproval(approval.approvalId);
  expect(approvalBroker.authorizeApproved(first, approval.approvalId)).toBe(
    false,
  );
  expect(approvalBroker.audit.at(-1)?.target).toBe("git status");
});

test("policy provenance is schema-validated and unknown rules fail closed", () => {
  expect(
    () =>
      new GovernanceBroker(identity, {
        ...policy("allow"),
        provenance: { digest: "bad" },
      }),
  ).toThrow();
  const { provenance: _ignored, ...restrictedBase } = policy("allow");
  const restricted = {
    ...restrictedBase,
    rules: [
      {
        id: "rule-1",
        effect: "allow" as const,
        capabilities: ["execute" as const],
        operations: ["bash"],
      },
    ],
  };
  const broker = new GovernanceBroker(identity, {
    ...restricted,
    provenance: { digest: policyDigest(restricted) },
  });
  expect(
    broker.authorize({ ...action(), operation: "unknown-protected-operation" }),
  ).toBe("ERROR");
});

test("configured governance is enforced before the existing tool permission boundary", async () => {
  const broker = new GovernanceBroker(identity, policy("deny"));
  const result = await runTool(
    "bash",
    JSON.stringify({ command: "echo governed" }),
    {
      permissions: {
        projectRoot: process.cwd(),
        grants: [{ capability: "execute", scope: "prefix", target: "echo" }],
        audit: [],
      },
      asker: async () => "allow-once" as const,
      signal: new AbortController().signal,
      maxOutputChars: 2000,
      governance: broker,
    },
  );
  expect(result).toContain("governance decision DENY");
});

test("an exact human approval can be consumed at the tool boundary", async () => {
  const broker = new GovernanceBroker(identity, policy("approval"));
  const approval = broker.requestApproval(
    newGovernanceAction({
      operation: "bash",
      capability: "execute",
      target: "echo governed",
      tenantId: identity.tenantId,
      workspaceId: identity.workspaceId,
      risk: "high",
      consequence: "execute a reviewed command",
    }),
  );
  const result = await runTool(
    "bash",
    JSON.stringify({ command: "echo governed" }),
    {
      permissions: {
        projectRoot: process.cwd(),
        grants: [{ capability: "execute", scope: "prefix", target: "echo" }],
        audit: [],
      },
      asker: async () => "allow-once" as const,
      signal: new AbortController().signal,
      maxOutputChars: 2000,
      governance: broker,
      governanceApprovalId: approval.approvalId,
    },
  );
  expect(result).toContain("governed");
});
