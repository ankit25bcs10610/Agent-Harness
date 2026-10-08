# Prompt 18 implementation tracker

This tracker distinguishes code that exists from behavior exercised by tests.

| Requirement                                          | Status      | Evidence                                                                                             |
| ---------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| Typed task/suite registry                            | TESTED      | `tests/unit/evaluation.test.ts`                                                                      |
| Git fixture discovery and dedicated worktree setup   | IN_PROGRESS | `src/evaluation/environment.ts`; safe-fixture path tested, dedicated setup needs a full fixture test |
| Real loop adapter                                    | IMPLEMENTED | `src/evaluation/adapters.ts`                                                                         |
| Multi-agent adapter boundary                         | IMPLEMENTED | coordinator-compatible injected adapter                                                              |
| Trusted graders and integrity checks                 | TESTED      | grader and scope/tampering tests                                                                     |
| Redacted correlated traces                           | TESTED      | trace and engine tests                                                                               |
| Runtime/token/cost metrics                           | TESTED      | null/unknown semantics and execution metrics                                                         |
| Security/adversarial evaluation                      | IN_PROGRESS | policy/integrity graders and isolation blocking; full adversarial matrix remains                     |
| Controlled fault injection                           | TESTED      | deterministic runtime-failure test adapter                                                           |
| Experiment persistence/resume                        | TESTED      | atomic store and no-replay resume test                                                               |
| Baseline/regression/quality gates                    | TESTED      | comparison and gate tests                                                                            |
| Model and single-vs-multi-agent orchestration        | IN_PROGRESS | configuration/comparison data model exists; live trial scheduler is not enabled                      |
| Context and repository-intelligence benchmark suites | NOT_STARTED | existing subsystems have independent tests, no Prompt 18 benchmark fixtures yet                      |
| Terminal inspection commands                         | IN_PROGRESS | list/results/trace/failures/security/compare inspection works; run orchestration is not UI-wired     |
| Full acceptance scenarios A–L                        | NOT_STARTED | no end-to-end suite has been executed for all scenarios                                              |
| Paid-provider benchmark execution                    | BLOCKED     | requires explicit provider credentials/consent and a suitable isolated environment                   |
