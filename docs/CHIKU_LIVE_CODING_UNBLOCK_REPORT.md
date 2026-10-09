# Chiku Live Coding Unblock Report

Date: 2026-10-09

## Final verdict

**REAL_MODEL_BLOCKED**

The evaluator now has a production-connected `eval-run` command, but no live model execution was performed because the configured external provider is not explicitly authorized for evaluation and `openrouter.ai` is unreachable from this host. The original buggy fixture remains unmodified. No success is claimed.

## Repository and runtime

- Repository revision inspected: `9ca6e22df6ce860f7f4deb113a84ecca2ef57437`
- Working tree was already dirty; this change adds `src/eval-run.ts`, updates `src/cli.ts` and `tests/cli.test.ts`, and adds this report.
- Bun: 1.4.2
- Host: macOS Darwin 27.0.0 arm64
- Package: `chiku@1.0.0`

## Evaluation CLI implementation

Added:

```text
chiku eval-run --workspace <path> --task-file <path> --result-file <path> [--timeout-ms <n>]
```

The command invokes the existing `runLoop`, production tool registry, central permission checks, configured provider adapter, session checkpoint persistence, and abort budget. It writes structured JSON evidence atomically and returns nonzero for blocked or failed runs.

The evaluator policy is narrow and fail-closed:

- Allows only read/create/modify operations inside the selected workspace, excluding `.git`, `.chiku`, and sensitive paths.
- Allows only bounded local test, typecheck, lint, build, status, and diff command forms.
- Denies destructive shell commands, external access, delete operations, pushes, resets, clean operations, and path escapes.
- Does not persist blanket permission grants.
- Cloud provider use requires explicit `CHIKU_EVAL_ALLOW_EXTERNAL_PROVIDER=1`.
- Local provider use requires explicit `CHIKU_PROVIDER=local` or a `local/` model plus an allowed configured endpoint.

## Provider diagnostics

Executed diagnostics:

- `bun dist/chiku.js doctor`: exit `1`; provider reported `UNREACHABLE provider: getaddrinfo ENOTFOUND openrouter.ai`.
- `dscacheutil -q host -a name openrouter.ai`: no DNS answer.
- `curl -I --max-time 8 https://openrouter.ai/`: `Could not resolve host: openrouter.ai`.
- HTTP, HTTPS, and ALL proxy variables: unset.

This is a DNS/network availability blocker, not evidence of invalid credentials. TLS verification was not disabled and no DNS override or hardcoded IP was attempted.

## Local model status

The existing loopback OpenAI-compatible adapter remains supported and is selected only by explicit configuration. It validates endpoint policy, discovers models, supports streaming, tool schemas, cancellation, and incomplete usage handling. No local model server was running or authorized for this run, so local live coding is **NOT_RUN**.

## Prompt 102 fixture evidence

The disposable fixture was reused at `/private/tmp/chiku-real-bugfix-I4dneM/chiku-real-bugfix-test` with baseline commit `3371e3444e8ecf4af2cb840d713a0e3f48db39a3`.

- Visible baseline: **1 pass, 3 fail**.
- Independent hidden grader: **FAIL**, first failure was coupon incorrectly discounting shipping (`expected 2000, got 1875`).
- Independent correct reference: **PASS**.
- Fixture source was not manually repaired.
- Hidden grader and reference remained outside the agent workspace.

The built evaluator was then run against the fixture without provider opt-in. It returned `REAL_MODEL_BLOCKED`, wrote evidence to `/private/tmp/chiku-real-bugfix-I4dneM/eval-result-103.json`, and produced no target diff.

## Tests executed

- `bun run typecheck` — **PASS**.
- `bun test tests/cli.test.ts` — **PASS**, 6 tests.
- `bun run format:ci` — **PASS**.
- `bun run build` — **PASS**.
- `bun run test` — **PASS**, 277 tests across 72 files, 737 assertions.
- `bun dist/chiku.js eval-run ...` without external-provider authorization — **PASS as a blocker test**: returned `REAL_MODEL_BLOCKED` and did not modify the fixture.

## Acceptance scenarios

| Scenario                                   | Status  | Evidence                                                                                 |
| ------------------------------------------ | ------- | ---------------------------------------------------------------------------------------- |
| A01 packaged CLI starts                    | PASS    | Build, help, and version checks                                                          |
| A02 real Chiku loop is wired to evaluator  | PASS    | `eval-run` uses `runLoop`                                                                |
| A03 workspace restriction                  | PASS    | Narrow evaluator path policy and existing workspace tests                                |
| A04 trusted permission policy              | PASS    | Central `checkPermission` remains in `runTool`                                           |
| A05 protected operations denied            | PASS    | Evaluator denies delete, sensitive paths, external access, and destructive commands      |
| A06 provider failure classification        | PASS    | Doctor and provider diagnostics report unreachable state and nonzero exit                |
| A07 local provider configuration           | PASS    | Existing local-provider tests pass; live server not run                                  |
| A08 deterministic protocol fixture         | NOT_RUN | No separate controlled endpoint was started                                              |
| A09 buggy baseline fails                   | PASS    | 1/4 visible tests pass                                                                   |
| A10 reference passes hidden grader         | PASS    | `REFERENCE_PASS`                                                                         |
| A11 real model invoked                     | BLOCKED | DNS unavailable; cloud opt-in absent                                                     |
| A12 Chiku reads project files              | NOT_RUN | No model-backed execution                                                                |
| A13 Chiku applies patch                    | NOT_RUN | No model-backed execution                                                                |
| A14 visible tests pass after Chiku patch   | NOT_RUN | No Chiku patch                                                                           |
| A15 hidden grader passes after Chiku patch | NOT_RUN | No Chiku patch                                                                           |
| A16 unauthorized changes prevented         | PASS    | No target changes; policy and existing integrity tests pass                              |
| A17 session/process cleanup                | PASS    | Abort budget and checkpoint path compile and existing tests pass; live run not exercised |
| A18 evidence reports unknowns accurately   | PASS    | Structured `REAL_MODEL_BLOCKED` evidence written                                         |
| A19 integration regression coverage        | PASS    | CLI parsing/blocker coverage plus full suite                                             |
| A20 evidence-backed final verdict          | PASS    | Verdict is `REAL_MODEL_BLOCKED`, not success                                             |

## Remaining blockers and exact next action

1. Start or authorize a genuine compatible local model server, or explicitly authorize external provider evaluation with `CHIKU_EVAL_ALLOW_EXTERNAL_PROVIDER=1` and working DNS/HTTPS.
2. Run `chiku eval-run` against the unchanged fixture.
3. Independently run visible tests, the protected hidden grader, diff-scope checks, and cleanup checks.
4. Only then score real coding correctness or report `REAL_CODING_SUCCESS`.

No commit, push, paid inference request, deployment, or external publication was performed.
