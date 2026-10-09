# Independent repository evaluation — Prompt 84

This is a reproducibility record for the current local implementation. It does not claim a competitive benchmark result or model quality result.

## Evidence boundary

- Repository revision inspected: `ae2f5f7cab5bd49a08399997d81d4657c66da0d2`
- Runtime used: Bun 1.4.2 on macOS
- Provider calls: none
- Paid inference and competitor software: not run
- Evaluation mode: deterministic fixtures and injected adapters only

## Implemented in this iteration

Dedicated evaluation worktrees are now created under an external disposable temporary directory instead of inside the source fixture’s `.chiku` directory. The environment returns an explicit cleanup callback. Setup failures and normal evaluation completion both remove the temporary Git worktree registration and temporary directory on a best-effort basis. This protects fixture-local evaluation metadata from the evaluated agent and avoids counting that metadata as task output.

This is filesystem/worktree isolation only. It is not an OS sandbox and does not provide network, process, or kernel isolation.

## Executed validation

| Command                                    | Outcome                                         |
| ------------------------------------------ | ----------------------------------------------- |
| `bun run typecheck`                        | PASS                                            |
| `bun test ./tests/unit/evaluation.test.ts` | PASS — 14 tests, 0 failures                     |
| `bun test`                                 | Pending final run after this report was added   |
| `bun run format:ci`                        | PASS before this report; rerun with final suite |

The dedicated-workspace regression verifies that the worktree path is outside the source fixture and that cleanup completes. Existing evaluation tests also cover pinned revisions, trusted graders, redacted traces, budget violations, integrity checks, experiment persistence, recovery, and honest blocked isolation.

## Acceptance scenarios

| Scenario                                             | Status  | Evidence or limitation                                                           |
| ---------------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| Valid task metadata loads                            | PASS    | Zod task and suite tests                                                         |
| Invalid task metadata rejected                       | PASS    | Registry/schema tests                                                            |
| Source revision pinned                               | PASS    | Base-commit mismatch test                                                        |
| Dedicated workspace outside fixture                  | PASS    | New regression test                                                              |
| Protected grader execution                           | PARTIAL | Graders are application-controlled; no external hidden-grader bundle is supplied |
| Installed Chiku task adapter                         | NOT_RUN | No live model/provider run was authorized                                        |
| Missing provider handling                            | BLOCKED | Live provider credentials intentionally unavailable                              |
| Setup failure classification                         | PASS    | Fault and evaluation error paths                                                 |
| Budget timeout/limits                                | PASS    | Budget and timeout tests                                                         |
| Independent correctness grading                      | PASS    | Trusted grader tests                                                             |
| Multi-file correctness                               | NOT_RUN | No real repository task fixture supplied in this checkout                        |
| Attempt accounting                                   | PASS    | Persisted experiment/result tests                                                |
| Unknown token usage                                  | PASS    | Metrics tests preserve `null`                                                    |
| Duration measurement                                 | PASS    | Evaluation metrics and process tests                                             |
| Model/provider metadata                              | PARTIAL | Result schema supports execution data, but no live run was made                  |
| Source-grounded failure analysis                     | PASS    | Failure and improvement tests                                                    |
| Regression comparison                                | PASS    | Comparison and quality-gate tests                                                |
| Full fixture → execution → protected grading → rerun | NOT_RUN | Requires authorized installed-agent and task fixtures                            |

## Quality gates

- G1 reproducible environment: PASS for deterministic local fixtures.
- G2 installed agent execution: NOT_RUN.
- G3 protected graders: PARTIAL; application-controlled graders are protected from task metadata, but a separate hidden-grader package is not configured.
- G4 no solution leakage: PARTIAL; dedicated worktrees protect fixture-local metadata, but no hidden reference-solution fixture was supplied.
- G5 correctness scoring: PASS for registered deterministic graders.
- G6 attempt accounting: PASS for persisted result/experiment paths.
- G7 provider metadata: PARTIAL; live provider evidence is unavailable.
- G8 permission boundaries: PASS in existing permission and process tests.
- G9 evidence-grounded classification: PASS in local evaluation tests.
- G10 performance data: PASS for measured local duration; no coding-agent performance claim is made.
- G11 competitive claims: PASS; no competitor results are reported.
- G12 verified improvement/regression reporting: PARTIAL; the worktree-protection regression is tested, but no before/after real-agent run was authorized.

## Remaining blockers and next action

The next unfinished implementation is a real installed-CLI evaluation adapter that launches the packaged executable with an explicitly configured model/provider, captures its bounded trace and exit state, and refuses to run when the required provider or isolation guarantees are unavailable. It must be exercised only with an authorized fixture and must keep hidden graders outside the agent workspace.
