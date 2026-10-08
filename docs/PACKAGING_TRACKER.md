# Prompt 19 implementation tracker

| Requirement                                       | Status      | Evidence                                                                           |
| ------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| Provider-independent CLI help/version             | TESTED      | `tests/cli.test.ts`, direct Bun smoke                                              |
| Typed argument validation and workspace selection | TESTED      | CLI tests and `--workspace` parser                                                 |
| Diagnostics command                               | TESTED      | `bun src/index.tsx doctor`                                                         |
| Real bundled CLI build                            | TESTED      | `scripts/build-cli.ts`, `bun run build`                                            |
| Package metadata/bin allowlist                    | TESTED      | `package.json`, `npm pack --dry-run`                                               |
| Clean npm tarball install and executable smoke    | TESTED      | `tests/package-smoke.ts`                                                           |
| Bun installation                                  | IN_PROGRESS | bundled executable uses Bun; global registry installation not published            |
| Portable user/project data                        | TESTED      | platform home APIs plus project `.chiku`; explicit config loading is tested        |
| Sessions/skills after installation                | IN_PROGRESS | existing stores remain project-aware; clean installed interactive scenario pending |
| Artifact checksums                                | IMPLEMENTED | `scripts/checksums.ts`; release artifact generation not published                  |
| GitHub Actions package validation                 | IMPLEMENTED | three-runner matrix, build, package, smoke, checksum steps                         |
| Standalone binary compilation                     | TESTED      | `bun run build:binary` and binary help/version on macOS arm64                      |
| Standalone Linux/Windows runtime validation       | BLOCKED     | those operating systems are unavailable in this workspace                          |
| Public npm/release publication                    | NOT_STARTED | intentionally requires explicit authorization                                      |
