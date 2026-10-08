# Change Contract Engine tracker

This tracker covers the Prompt 15 requirements included in the supplied specification. A requirement is marked `TESTED` only when a corresponding automated test executes.

| Requirement                                                           | Status      | Evidence                                                                                           |
| --------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| Repository audit and implementation tracker                           | TESTED      | `src/contract/*`, this document                                                                    |
| Zod contract schema and nested validation                             | TESTED      | `src/contract/types.ts`, `tests/unit/contract.test.ts`                                             |
| Contract creation and serialization                                   | TESTED      | planner and contract tests                                                                         |
| Immutable revisions and comparison                                    | TESTED      | `reviseContract`, `compareContracts`, contract tests                                               |
| Deterministic patch-backed planning                                   | TESTED      | `src/contract/planner.ts`, contract tests                                                          |
| Repository identity and Git status evidence                           | TESTED      | planner/precondition integration test                                                              |
| Workspace, file existence, hash, permissions, and patch preconditions | TESTED      | precondition regression tests                                                                      |
| Persisted contract history                                            | TESTED      | store round-trip test                                                                              |
| Contract-aware patch execution boundary                               | TESTED      | apply-patch contract integration test                                                              |
| Human approval and final verification workflow                        | IN_PROGRESS | Existing permission and workflow engines are reused; approval UI remains in the existing tool path |

The supplied attachment ends while listing precondition requirements. Requirements after that point cannot be verified from the provided document and are intentionally not invented here.
