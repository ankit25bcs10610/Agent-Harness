# Advanced Security Audit — Chiku

Audit date: 2026-10-09 (Asia/Calcutta)  
Revision: `a0b2c6f548dcedd3001e697a8128c7d8d20e6084`  
Branch: `main`  
Environment: macOS development host, Bun 1.4.2, TypeScript validation, local deterministic fixtures.

## Executive summary

Chiku is suitable for controlled local development against repositories the operator trusts, with human approval enabled. It is **not safe to classify as a host-isolated autonomous execution sandbox**. The default `bash` tool uses `ProcessExecutor` without an isolation request, and `IsolationRegistry` has no registered backend in this repository. Working-directory checks and environment filtering reduce risk but do not provide OS-level containment.

Recommended verdict: **CONTROLLED INTERNAL PILOT**, limited to trusted repositories, interactive approval, non-sensitive host accounts, and no unattended execution. It is **NO-GO** for unattended execution against untrusted repositories and for enterprise claims requiring a real sandbox, hosted identity, or independent security validation.

## Scope and method

Inspected the agent loop, process executor/isolation, permission engine, patch engine, MCP client/manager, sessions, multi-agent runtime, providers, GitHub integration, evaluation code, package metadata, CI, and security scripts. Safe targeted tests were run locally. No real credentials, unknown MCP servers, live customer systems, destructive host commands, or paid model calls were used.

## Trust boundaries and attack surface

- User/model output → tool registry → deterministic permission engine.
- Tool registry → filesystem, child processes, Git, MCP, and external APIs.
- Repository content, MCP results, and terminal output → model context as lower-trust data.
- Worker agents → bounded scheduler, dedicated workspaces, capability allowlists, and Change Contracts.
- Sessions and audit data → local JSON persistence.
- Provider requests → configured external model provider; source context may leave the host according to provider configuration.

## Confirmed findings

### CHIKU-SEC-001 — Host process execution is not an OS sandbox

- Severity: **High** for untrusted repositories; confidence: high.
- Evidence: `src/tool/tools/bash.ts` constructs `new ProcessExecutor()` without an isolation policy. `src/process/executor.ts` calls `spawn(...)` directly. `src/process/isolation.ts` documents that no backend is enabled by default and only fails closed when a caller explicitly requests isolation.
- Impact: a permitted command can use the host process privileges, readable files, and network available to the user. CWD restrictions do not prevent access to unrelated readable paths or network destinations.
- Existing mitigations: direct argument spawning by default, explicit shell mode, filtered sensitive environment keys, timeout/output limits, cancellation, workspace CWD validation, and a new `requireIsolation` fail-closed contract.
- Required remediation: add and register an actually enforced OS/container/VM backend; the current `requireIsolation` contract now fails closed but cannot provide isolation by itself. Add runtime tests for host-file, network, privilege, and descendant-process isolation. Do not describe current behavior as sandboxing.

### CHIKU-SEC-002 — Remote MCP URL policy is incomplete

- Severity: **Medium/High** depending on configuration; confidence: medium.
- Evidence: `src/mcp/types.ts` accepts any valid URL. `src/mcp/client.ts` constructs `StreamableHTTPClientTransport` directly and does not show an allowlist, private-address/SSRF policy, or DNS rebinding defense.
- Impact: an authorized configuration could connect to unintended internal or metadata endpoints. This is configuration-controlled, not demonstrated against a live target.
- Status: unverified exploitability in this environment. No live network test was performed.
- Required remediation: explicit external-server allowlist and safe URL policy, DNS/IP checks appropriate to the deployment, transport authentication review, and controlled SSRF fixtures.

### CHIKU-SEC-003 — Audit coverage is local evidence, not tamper-resistant audit storage

- Severity: Medium; confidence: high.
- Evidence: security evidence and threat-model records are bounded and atomically persisted locally, but no authenticated remote audit sink or tamper-evident chain is configured.
- Impact: a user or compromised local process with filesystem access can modify local evidence. This prevents treating local records as independent compliance evidence.
- Required remediation: define a protected deployment audit service with authenticated append-only storage, key management, retention, and export controls. Keep local evidence explicitly classified as local engineering evidence.

## Verified controls

- Workspace canonicalization, traversal rejection, hidden/sensitive-path handling, and symlink-race checks: tested.
- Multi-file patch authorization now enumerates and authorizes each target independently; a patch containing a forbidden `.env` target is rejected without mutation.
- Patch stale-context, concurrent modification, rollback-conflict, and newline-preservation behavior: tested.
- Tool argument validation, unknown-tool rejection, output truncation, and capability-scoped approvals: tested.
- Process timeouts, cancellation, output limits, environment filtering, and explicit isolation failure: tested. These are not OS sandbox proof.
- MCP stdio fixture lifecycle, schema validation, capability checks, missing credentials, and timeout behavior: tested.
- Session atomic persistence, invalid JSON recovery, schema incompatibility, unfinished tool-call recovery, and credential exclusion: tested.
- Multi-agent bounded scheduling, dedicated workspaces, capability policies, Change Contracts, and recovery states: tested.
- Security evidence and threat-model records: schema-validated, bounded, atomic, and review-expiry aware.

## Security test matrix

| Scenario | Result | Evidence |
|---|---|---|
| Path traversal / workspace escape | PASS | `tests/unit/permission.test.ts` |
| Symlink escape and replacement race | PASS | `tests/unit/permission.test.ts`, patch tests |
| Sensitive direct file access | PASS | permission tests |
| Multi-file patch with forbidden target | PASS | `tests/unit/patch.test.ts` |
| Stale/concurrent patch and safe undo | PASS | patch tests |
| Process timeout/cancellation/output bound | PASS | `tests/unit/process.test.ts` |
| Requested unavailable isolation | PASS / fail-closed | process tests |
| Actual host filesystem sandbox escape | NOT_RUN | no enforceable backend is registered |
| Network-disabled sandbox egress | NOT_RUN | no enforceable backend is registered |
| MCP stdio lifecycle and authorization | PASS | `tests/integration/mcp.test.ts` |
| Remote MCP SSRF defense | NOT_RUN | no authorized remote fixture supplied |
| Session secret persistence | PASS for synthetic fixtures | session tests |
| Multi-agent authorization/workspace isolation | PASS for deterministic fixtures | multi-agent tests |
| Dependency audit | BLOCKED | npm registry DNS resolution failed during `bun audit` |

Executed targeted suite: **44 passed, 0 failed, 95 assertions**.  
Executed security scan: **260 tracked files inspected, passed**.

## Scorecard

Scores are engineering assessment scores, not certification:

| Category | Score | Basis |
|---|---:|---|
| Sandbox isolation | 2/10 | No registered OS-enforced backend |
| Filesystem security | 8/10 | Canonical paths, symlink checks, sensitive paths tested |
| Permission architecture | 8/10 | Central registry and per-target patch authorization tested |
| Patch safety | 8/10 | Hash/precondition/rollback protections tested |
| MCP security | 5/10 | Stdio and capability checks tested; remote SSRF policy incomplete |
| Prompt-injection resistance | 6/10 | Deterministic authorization is independent of model text; broader adversarial corpus remains |
| Multi-agent authorization | 7/10 | Bounded workers, workspaces, and contracts tested |
| Secret management | 6/10 | Redaction/filtering/session exclusion tested; OS keychain and full egress policy absent |
| Supply chain | 5/10 | Lockfile and CI checks exist; advisory query was unavailable |
| CI/CD security | 6/10 | CI/security checks exist; full external workflow review not performed here |
| Session privacy | 7/10 | Atomic, bounded, schema-checked local persistence |
| Runtime resilience | 7/10 | Budgets, cancellation, retries, and recovery tested |

## Prioritized remediation

### P0

1. Implement and register a real OS/container/VM isolation backend for supported platforms.
2. Add runtime isolation fixtures proving host-file, network, privilege, mount, and descendant-process controls.
3. Make secure execution policy explicit for untrusted repositories and fail closed.

### P1

1. Add remote MCP URL allowlists and SSRF/DNS-rebinding defenses.
2. Complete adversarial prompt-injection fixtures across repository, MCP, GitHub, and tool outputs.
3. Add protected/tamper-evident audit storage for hosted deployments.
4. Re-run dependency advisories from a network-enabled authorized CI environment.

### P2

1. Add platform-native validation for Windows and Linux.
2. Add keychain-backed credential storage where supported.
3. Expand security evidence export and controlled procurement workflows.

## Production verdict

**CONTROLLED INTERNAL PILOT** only. Local interactive use with trusted repositories and explicit approvals is supported by the executed deterministic evidence. Untrusted-repository autonomous execution, unattended host execution, enterprise sandbox guarantees, independent audit claims, and remote MCP security are not validated.

No certification, penetration test, customer approval, or production security approval is claimed.

## Exact next action

Implement the first supported OS-enforced isolation backend and integrate it into `ProcessExecutor` under an explicit secure-execution policy, then run actual runtime escape fixtures. Until that evidence exists, retain the controlled-pilot/no-go scope for untrusted autonomous execution.
