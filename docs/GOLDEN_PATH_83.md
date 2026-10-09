# Golden-path validation (Prompt 83)

This document records the validation evidence for the current Chiku checkout. It is an engineering record, not a claim that every product scenario is complete.

## Scope

- Tested checkout: `ae2f5f7cab5bd49a08399997d81d4657c66da0d2`
- Runtime: Bun 1.4.2, macOS developer environment
- Validation date: 2026-10-09
- Provider calls: none; all tests use deterministic fixtures or injected transports

## Changes in this iteration

The CLI configuration boundary now accepts only the providers implemented by the runtime (`openrouter` and `local`). Unknown values such as `ollama` fail during config loading instead of being accepted and silently routed elsewhere. Environment overrides are validated by the same schema. Setup and diagnostics describe local endpoint mode separately, and runtime startup failures return a concise actionable error with a non-zero exit status.

## Executed checks

| Check                          | Result                       |
| ------------------------------ | ---------------------------- |
| `bun run typecheck`            | PASS                         |
| `bun test ./tests/cli.test.ts` | PASS (4 tests)               |
| `bun test`                     | PASS (242 tests, 0 failures) |
| `bun run format:ci`            | PASS                         |
| `bun run build`                | PASS                         |
| `bun run package:check`        | PASS                         |

## Golden-path status

The local CLI path is validated through unit and integration coverage for argument parsing, provider selection, local endpoint policy, workspace discovery, permissions, patching, verification, session recovery, and package metadata. The following remain explicitly incomplete or environment-dependent:

- The `setup` command is a read-only diagnostic guide, not an interactive provider wizard.
- No paid or live model request was made, so real provider reachability and model quality are NOT_RUN.
- Clean-directory package installation smoke testing is BLOCKED in this environment when the package manager needs registry access; DNS/registry access is unavailable. Building a tarball is not treated as installation evidence.
- Windows and Linux execution were NOT_RUN locally; CI remains the source of evidence for those platforms.
- Hosted team, billing, MCP server, and external GitHub workflows are not part of the local golden-path claim.

## Security and honesty constraints

Credentials are not written by the CLI setup path. Local mode only accepts a loopback endpoint and does not fall back to cloud routing when local configuration is incomplete. No unsupported provider, live customer, benchmark, payment, release, or cross-platform result is represented as successful here.

## Next unfinished action

Add and validate a real interactive first-run setup flow that persists only non-secret configuration, then run it in a clean disposable home directory with a fixture local provider. Keep live-provider and external-service checks separate from deterministic CI tests.
