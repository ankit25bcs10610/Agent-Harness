# Release readiness

This checklist records executed evidence and does not authorize publication.

| Gate                                        | Status      | Evidence                                                                                     |
| ------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| Typecheck, tests, formatting                | TESTED      | CI and local validation commands                                                             |
| Cross-platform CI                           | IMPLEMENTED | Ubuntu, macOS, and Windows matrix                                                            |
| Package contents and clean install          | TESTED      | `package:check` and `package:test`                                                           |
| Credential-shaped content scan              | IMPLEMENTED | `security:check` scans tracked text files and fails closed on matches                        |
| High-severity dependency audit              | IMPLEMENTED | CI runs lockfile-aware `bun audit --audit-level=high`; local registry access was unavailable |
| Standalone Linux/Windows runtime            | BLOCKED     | operating systems unavailable locally; CI is required evidence                               |
| Real provider/GitHub/MCP external mutations | NOT RUN     | no credentials or authorized test repository supplied                                        |
| Release artifact publication                | NOT READY   | explicit user authorization is required                                                      |

The project must not be labeled beta-ready until the blocked platform checks and CI security gates pass on the target commit.
