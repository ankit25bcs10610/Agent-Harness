# Independent Security Validation Report

Date: 2026-10-09 (Asia/Calcutta)
Commit: 207bcc5fabb5e473feb71c2cb9e02c75cf1f2f3d
Environment: macOS, Bun 1.4.2, local disposable fixtures.

## Executive assessment

The current controls withstand the tested path traversal, symlink, sensitive-file, patch authorization, cancellation, session, MCP-fixture, provider-error, crash-redaction, and multi-agent authorization scenarios.

Result: CONTROLLED PILOT, not Production GO. No OS-enforced isolation backend is registered, so host filesystem escape, network-disabled sandbox enforcement, mount restrictions, privilege restrictions, and runtime escape resistance are BLOCKED. Untrusted repositories and unattended autonomous execution remain out of scope.

## Baseline

The prior audit is recorded in docs/SECURITY_AUDIT_REPORT.md. The current remediation commit adds per-target authorization for multi-file patches and a fail-closed requireIsolation process policy.

## Adversarial test matrix

| ID     | Scenario                                 | Result                          | Evidence                                  |
| ------ | ---------------------------------------- | ------------------------------- | ----------------------------------------- |
| ADV-01 | Workspace traversal                      | PASS                            | tests/unit/permission.test.ts             |
| ADV-02 | Symlink escape and replacement race      | PASS                            | permission and patch tests                |
| ADV-03 | Unauthorized .env patch target           | PASS                            | multi-file patch regression               |
| ADV-04 | Approval reuse across capabilities       | PASS                            | capability-scoped permission tests        |
| ADV-05 | Concurrent patch modification            | PASS                            | patch engine tests                        |
| ADV-06 | Undo after changed content               | PASS                            | verified undo/hash tests                  |
| ADV-07 | Cancelled process                        | PASS                            | process cancellation tests                |
| ADV-08 | Unavailable secure backend               | PASS / fail closed              | requireIsolation test                     |
| ADV-09 | Actual host filesystem sandbox escape    | BLOCKED                         | no OS backend registered                  |
| ADV-10 | Network-disabled sandbox egress          | BLOCKED                         | no OS backend registered                  |
| ADV-11 | Sandbox resource-limit enforcement       | BLOCKED                         | no OS backend registered                  |
| ADV-12 | Orphan process cleanup                   | PASS in host fixture            | container descendant isolation not proven |
| ADV-13 | Malformed/oversized MCP data             | PASS                            | MCP fixtures                              |
| ADV-14 | Unauthorized destructive MCP call        | PASS                            | capability and Change Contract checks     |
| ADV-15 | Disconnected/stale MCP tool              | PASS                            | MCP lifecycle fixture                     |
| ADV-16 | MCP prompt-injection text                | PASS for authorization boundary | model campaign not run                    |
| ADV-17 | Repository prompt injection              | NOT_RUN                         | no live model campaign                    |
| ADV-18 | Worker privilege escalation              | PASS                            | multi-agent capability/workspace tests    |
| ADV-19 | Synthetic secret in crash/session output | PASS                            | crash and session tests                   |
| ADV-20 | Dependency advisory scan                 | BLOCKED                         | npm registry DNS failure                  |

Executed targeted suite: 59 passed, 0 failed, 127 assertions.

Additional results:

- bun run security:check: passed, 261 tracked files inspected.
- bun run typecheck: passed during remediation validation.
- bun audit --audit-level=high: BLOCKED by DNSResolveFailed contacting npm advisories.

## Findings

### SEC-VAL-001 — No enforceable OS sandbox backend

- Severity: High for untrusted repositories and unattended execution.
- Status: Confirmed design limitation.
- Evidence: src/process/isolation.ts has no backend registered; normal bash uses host spawn.
- Mitigations: direct spawning, filtered environment, workspace CWD checks, timeout, output bounds, cancellation, and requireIsolation fail-closed behavior.
- Risk: a permitted host command can access resources available to the local user outside the workspace.
- Required remediation: implement and runtime-test a supported container/VM/OS isolation backend.

### SEC-VAL-002 — Remote MCP SSRF policy not independently validated

- Severity: Medium/High depending on deployment.
- Status: Unverified, not a proven exploit.
- Evidence: HTTP transport exists; no authorized remote SSRF fixture was used.
- Required remediation: URL allowlists, private-address policy, DNS-rebinding defenses, and controlled remote fixtures.

### SEC-VAL-003 — Dependency advisory service unavailable

- Status: Blocked validation gap, not a vulnerability finding.
- Required remediation: rerun bun audit in network-enabled CI.

## Fixed and reverified

- Broad workspace patch authorization: multi-file patches authorize every target; a .env target is rejected without mutation.
- Secure execution without a backend: fails before process spawn.
- Workspace traversal and symlink escape: pass.
- Session synthetic-secret protection: pass in local fixtures.
- MCP authorization and stale lifecycle behavior: pass in local stdio fixtures.
- Worker workspace and capability boundaries: pass in deterministic tests.

## Security score and recommendation

Overall: 5.5/10 for controlled local pilot use; 2/10 for unattended untrusted-repository execution. This is not certification or an external audit.

Recommendation: CONTROLLED PILOT.

Allowed: trusted developers, trusted repositories, interactive approvals, and no real credentials in model context.

Blocked: unattended autonomous coding on untrusted repositories, host-isolation claims, unverified enterprise MCP deployment, and formal certification claims.

## Exact next remediation

Implement a supported OS-enforced process-isolation backend, register it only after capability checks, require it for untrusted-workspace execution, and add disposable runtime fixtures for host-file access, network egress, privilege, mounts, resource limits, and descendant cleanup.
