# Prompt 21 implementation tracker

| Requirement                           | Status          | Evidence                                                                                                                |
| ------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| GitHub REST API client                | IMPLEMENTED     | `src/github/client.ts` uses injected `fetch`, standard GitHub API headers, and typed responses                          |
| Authentication and least privilege    | IN PROGRESS     | bearer token is required and never logged; token scopes are not yet introspected or enforced against an endpoint policy |
| Repository discovery                  | TESTED          | parses HTTPS and SSH GitHub remotes and retrieves repository metadata                                                   |
| PR preparation and creation           | TESTED          | typed `createPullRequest`; mutation is only performed when the caller invokes it                                        |
| Authorized branch publication         | NOT IMPLEMENTED | requires explicit workspace/git publication policy and user authorization                                               |
| AI code review                        | NOT IMPLEMENTED | no production review orchestration is connected yet                                                                     |
| CI check aggregation                  | TESTED          | check runs are normalized into pending/passed/failed counts                                                             |
| Review feedback resolution            | NOT IMPLEMENTED | no review-thread API or bounded repair workflow is connected                                                            |
| Multi-agent review integration        | NOT IMPLEMENTED | existing multi-agent review is local; GitHub review handoff is not wired                                                |
| Change Contract/workspace integration | IN PROGRESS     | client is transport-only; PR creation still needs contract/workspace evidence binding                                   |
| Merge-readiness analysis              | TESTED          | draft, mergeability, and check-run failures produce explicit reasons                                                    |
| Terminal commands                     | NOT IMPLEMENTED | no `/github` command surface has been added                                                                             |
| Crash recovery                        | NOT IMPLEMENTED | GitHub mutation intent/results are not persisted in sessions                                                            |
| Controlled end-to-end fixtures        | TESTED          | all mutations in `tests/unit/github.test.ts` use an injected local response fixture; no real repository mutation occurs |

The remaining items require integration with the existing workspace, Change Contract, session, review, and UI modules. This tracker deliberately does not claim them complete.
