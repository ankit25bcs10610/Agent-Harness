# Chaos Test Report

Date: 2026-10-09
Environment: macOS, Bun 1.4.2, disposable local fixtures, no paid provider calls.

## Executed scenarios

| Scenario                                        | Result             | Evidence                           |
| ----------------------------------------------- | ------------------ | ---------------------------------- |
| Provider timeout/failure/retry cancellation     | PASS               | tests/unit/provider-errors.test.ts |
| Process timeout and cancellation                | PASS               | tests/unit/process.test.ts         |
| Output limit and failed process                 | PASS               | tests/unit/process.test.ts         |
| Secure execution without backend                | PASS / fail closed | tests/unit/process.test.ts         |
| Stale and concurrent patch                      | PASS               | tests/unit/patch.test.ts           |
| Undo after protected state change               | PASS               | tests/unit/patch.test.ts           |
| Corrupt/incompatible session                    | PASS               | tests/unit/session.test.ts         |
| MCP disconnect/timeout/authorization fixture    | PASS               | tests/integration/mcp.test.ts      |
| Worker crash/recovery and workspace conflict    | PASS               | tests/unit/multiagent.test.ts      |
| Actual OS sandbox escape                        | BLOCKED            | no registered isolation backend    |
| Network-disabled sandbox egress                 | BLOCKED            | no registered isolation backend    |
| Disk exhaustion and native process-tree fixture | NOT_RUN            | requires disposable CI environment |

## Measurements

This run measured deterministic pass/fail behavior only. No task success rate, recovery latency SLO, orphan-process count, or production resource baseline is claimed because no long-running production workload was executed.

## Result

The tested recovery paths fail closed or return structured failure states. The system must not be labeled sandboxed until the blocked isolation scenarios run against an enforceable backend.
