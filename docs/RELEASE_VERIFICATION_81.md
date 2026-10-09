# Prompt 81 release verification

## Candidate identity

- Base source revision: `d80d4b3ca26210362d42f2139c1486bbefcfe4e3`
- Working tree: dirty, with uncommitted implementation and generated local
  fixture state. This is not an immutable release candidate.
- Environment: macOS Darwin, Bun 1.4.2, arm64 Apple Silicon.
- No paid provider, customer environment, production service, or real secret
  was used.

## Executed evidence

| Command                          | Result                                  |
| -------------------------------- | --------------------------------------- |
| `bun run typecheck`              | PASS                                    |
| `bun test`                       | PASS: 242 tests, 0 failures             |
| `bun run format:ci`              | PASS                                    |
| `bun run security:check`         | PASS: 312 tracked files inspected       |
| `bun run build`                  | PASS                                    |
| `bun run package:check`          | PASS                                    |
| `bun run package:test`           | PASS                                    |
| `bun run release:checksums`      | PASS                                    |
| `bun run release:manifest`       | PASS                                    |
| `bun dist/chiku.js --help`       | PASS, exit 0                            |
| `bun dist/chiku.js local-status` | EXPECTED CONFIGURATION_REQUIRED, exit 1 |

Artifact hashes from the build immediately before this report:

```text
dist/chiku.js     4d352ecef3291a5e7e73f8354c8127eb74dc836fc6f2a9960a89cec21563c904
dist/chiku.js.map fc623c4172e472e1d98914c54943d813029368533ee57a393a7bc1812492441c
```

## Capability matrix

| Area                                            | Status                               | Evidence / limitation                                          |
| ----------------------------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| Core loop, tools, permissions, sessions         | VERIFIED                             | Full deterministic and integration suite                       |
| Repository intelligence and impact analysis     | VERIFIED                             | Source-grounded unit fixtures                                  |
| Patch, conflict, undo, and Git workspace safety | VERIFIED                             | Workspace and patch regression tests                           |
| Multi-agent scheduling and recovery             | VERIFIED                             | Bounded scheduler/workspace fixtures                           |
| Modernization and test engineering              | PARTIAL                              | Controlled fixtures; no real customer repository task          |
| Security remediation and red-team harness       | VERIFIED for fixtures                | Synthetic isolated fixtures only                               |
| OpenRouter provider path                        | IMPLEMENTED_UNVERIFIED here          | No credential or live request used                             |
| Local OpenAI-compatible backend                 | PARTIAL                              | Injected transport and policy tests; no live backend available |
| MCP and plugin boundaries                       | VERIFIED for fixtures                | Controlled server/plugin tests; no untrusted external server   |
| IDE integration                                 | IMPLEMENTED_UNVERIFIED               | No supported IDE end-to-end run in this environment            |
| GitHub integration                              | VERIFIED for controlled API fixtures | No external mutation performed                                 |
| Remote workspaces                               | VERIFIED for local fixtures          | No remote host or transport tested                             |
| Enterprise identity/tenant policy               | VERIFIED for local fixtures          | No hosted identity service tested                              |
| Billing and financial ledger                    | VERIFIED for sandbox fixtures        | Live billing intentionally not enabled                         |
| Cross-platform distribution                     | PARTIAL                              | macOS package path tested; Windows/Linux not run here          |

## Acceptance scenarios

1. PASS — package build/install smoke test.
2. PASS — setup/doctor and CLI parsing fixtures.
3. PARTIAL — local endpoint policy is tested; no live local backend.
4. PASS — repository discovery fixtures.
5. NOT_RUN — no real provider-backed coding task authorized.
6. PASS — multi-file patch fixtures.
7. PASS — central permission and governance tests.
8. PASS — dirty-worktree protection fixtures.
9. PASS — stale/conflicting patch fixtures.
10. PASS — session recovery fixtures.
11. PASS — bounded loop checkpoint tests.
12. PASS — bounded multi-agent workspace tests.
13. PASS — modernization fixtures.
14. PASS — migration transformation and verification fixtures.
15. PARTIAL — test discovery/mutation is tested; model-generated tests are not.
16. PASS — mutation testing detects weak fixtures.
17. PASS — authorized security fixtures.
18. PASS — security remediation regression fixtures.
19. PASS — source-grounded impact tests.
20. PASS — independent fixture grader rejects invalid outcomes.
21. NOT_RUN — IDE end-to-end task.
22. PASS — read-only GitHub API fixtures.
23. PASS — MCP/plugin permission bypass fixtures.
24. PARTIAL — local data-flow policy is tested, live backend unavailable.
25. PASS — remote workspace isolation fixtures.
26. PASS — tenant boundary fixtures.
27. PASS — governance policy fixtures.
28. PASS — sandbox billing reconciliation fixtures.
29. PASS — crash/fault and recovery fixtures.
30. INSUFFICIENT_EVIDENCE — complete installed developer journey with a real
    authorized model and all applicable advanced gates.

## Quality gates and scope decisions

| Gate / scope                          | Decision                                                  |
| ------------------------------------- | --------------------------------------------------------- |
| G1 installed CLI                      | PASS for macOS/Bun package smoke                          |
| G2 genuine coding correctness         | INSUFFICIENT_EVIDENCE                                     |
| G3 permission boundaries              | PASS for tested fixtures                                  |
| G4 Git/source integrity               | PASS for tested fixtures                                  |
| G5 session recovery                   | PASS for tested conditions                                |
| G6 advanced features                  | PARTIAL                                                   |
| G7 provider claims                    | PARTIAL / live availability not tested                    |
| G8 integrations/platforms             | PARTIAL                                                   |
| G9 critical security/data-loss scope  | CONDITIONAL; no unattended untrusted-repository guarantee |
| G10 operations/financial scope        | PASS for local/sandbox fixtures only                      |
| G11 documentation/claims              | PASS, with limitations documented                         |
| G12 immutable candidate evidence      | NOT_READY; working tree is dirty                          |
| Scope A: local developer private beta | INSUFFICIENT_EVIDENCE                                     |
| Scope B: public developer CLI         | INSUFFICIENT_EVIDENCE                                     |
| Scope C: advanced coding features     | CONDITIONAL_GO only for individually tested features      |
| Scope D: hosted team beta             | NO_GO                                                     |
| Scope E: enterprise evaluation        | NO_GO                                                     |
| Scope F: live commercial billing      | NO_GO                                                     |

## Remaining P0/P1 blockers

1. Run an authorized real provider-backed coding task and independent
   verification in a disposable repository.
2. Validate the packaged CLI on supported Windows/Linux environments and record
   platform-specific installation evidence.
3. Provide an OS-enforced sandbox backend before making unattended or
   untrusted-repository execution claims.

No automatic commit, push, merge, publication, deployment, billing activation,
or external communication was performed.
