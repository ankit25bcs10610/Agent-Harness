# Prompt 82 source-to-production audit

## Repository state

- Source revision inspected: `ae2f5f7cab5bd49a08399997d81d4657c66da0d2`
- Working tree before this report: only generated `.chiku/repository-index.json`
  and `.chiku/tasks/` were untracked.
- Runtime: Bun 1.4.2 on macOS arm64.
- No provider credentials, paid services, customer systems, or external
  mutations were used.

## Commands and evidence

| Command                        | Result                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `bun run typecheck`            | PASS                                                                                                            |
| `bun test`                     | PASS: 242 tests, 0 failures                                                                                     |
| `bun run format:ci`            | PASS                                                                                                            |
| `bun run security:check`       | PASS: 338 tracked files inspected                                                                               |
| `bun run package:check`        | PASS                                                                                                            |
| `bun run build`                | PASS                                                                                                            |
| `bun dist/chiku.js --help`     | PASS, exit 0                                                                                                    |
| `bun dist/chiku.js --version`  | PASS, exit 0                                                                                                    |
| `bun audit --audit-level=high` | BLOCKED: registry DNS resolution failed                                                                         |
| `bun run package:test`         | BLOCKED locally: npm dependency resolution stalled after registry DNS failure; no application error was emitted |

The package smoke path passed on the preceding pushed commit before the
Prompt 82 test-fixture-only change. A fresh clean-install result must be
re-run in a network-enabled CI environment before treating it as current
candidate evidence.

## Capability status

| Domain                                     | Status                                    | Evidence / limitation                                           |
| ------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------- |
| CLI boot, help, version, setup             | VERIFIED                                  | Built CLI and CLI tests                                         |
| Agent loop and tool dispatch               | VERIFIED for deterministic fixtures       | No live model task run                                          |
| Permissions, paths, symlinks, patch safety | VERIFIED for tested cases                 | No claim of OS sandboxing                                       |
| Git workspace and dirty-state protection   | VERIFIED for local fixtures               | Cross-platform execution requires CI                            |
| Sessions and interrupted tool recovery     | VERIFIED for tested cases                 | No production crash campaign                                    |
| Repository indexing/context                | VERIFIED for fixture repositories         | No large external repository benchmark                          |
| Local OpenAI-compatible provider           | PARTIAL                                   | Transport/capability fixtures; no live local backend            |
| OpenRouter provider                        | IMPLEMENTED_UNVERIFIED                    | No credential or paid request used                              |
| MCP/plugins                                | VERIFIED for controlled fixtures          | No untrusted external service                                   |
| IDE integration                            | IMPLEMENTED_UNVERIFIED                    | No end-to-end IDE session run                                   |
| GitHub integration                         | VERIFIED for controlled API fixtures      | No external mutation                                            |
| Remote workspaces                          | VERIFIED for local isolation fixtures     | No remote host tested                                           |
| Enterprise/team services                   | VERIFIED for local policy fixtures only   | No hosted identity/control plane                                |
| Billing                                    | VERIFIED for sandbox ledger fixtures only | Live billing not enabled                                        |
| Distribution                               | PARTIAL                                   | Build/package check pass; fresh install blocked by registry DNS |

## Acceptance scenarios

1. PASS — source build.
2. BLOCKED — fresh clean install currently requires npm registry access.
3. PASS — packaged help/version commands.
4. PASS — invalid provider/local endpoint policies fail safely.
5. PASS — injected provider fixtures; live provider NOT_RUN.
6. PASS — deterministic tool-call loop fixtures.
7. PASS — unauthorized tool calls blocked.
8. PASS — traversal/symlink protections.
9. PASS — symbol/index fixture.
10. PASS — index persistence/corruption tests.
11. PASS — dirty Git protection fixtures.
12. PASS — stale patch rejection.
13. PASS — configured verification fixtures.
14. PASS — failed verification reporting.
15. PASS — session persistence.
16. PASS — interrupted work does not replay unsafe actions.
17. PASS — optional services remain absent from local startup.
18. PASS — controlled MCP/plugin authorization fixtures.
19. NOT_RUN — authorized real coding model bug fix.
20. INSUFFICIENT_EVIDENCE — complete installed journey with a live model.

## Release gates

- G1 clean build: PASS.
- G2 clean installation: BLOCKED in this environment.
- G3 core loop: PASS for deterministic fixtures.
- G4 permissions: PASS for tested cases.
- G5 Git/source safety: PASS for tested cases.
- G6 verification integrity: PASS for tested cases.
- G7 session persistence: PASS for tested cases.
- G8 provider reporting: PARTIAL; live availability not tested.
- G9 optional-service isolation: PASS for local operation.
- G10 documentation: PASS for tested commands and documented limitations.
- G11 critical security/data-loss scope: CONDITIONAL; no unattended untrusted
  repository guarantee exists.
- G12 full developer journey: INSUFFICIENT_EVIDENCE.

## Highest-priority remaining work

1. Re-run clean package installation and `bun audit` on a network-enabled CI
   runner and record the resulting logs.
2. Run one authorized live-provider coding task in a disposable fixture repo,
   including independent verification and session resume.
3. Validate the packaged CLI on Windows and Linux and retain platform evidence.

No automatic commit, push, publication, deployment, billing activation, or
external communication was performed for this audit.
