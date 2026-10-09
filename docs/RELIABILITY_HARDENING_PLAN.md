# Reliability Hardening Plan

Date: 2026-10-09

## Baseline

- Bun typecheck: PASS
- Full deterministic suite: 164 passed, 0 failed, 412 assertions
- CLI build: PASS
- Security scan: PASS in the current validation baseline

## Confirmed controls

| Area                                  | Status  | Evidence                          |
| ------------------------------------- | ------- | --------------------------------- |
| Agent budgets and cancellation        | TESTED  | integration loop tests            |
| Provider failure classification/retry | TESTED  | provider error tests              |
| Process timeout/output/cancellation   | TESTED  | process tests                     |
| Patch concurrency and undo safety     | TESTED  | patch tests                       |
| Session corruption/recovery           | TESTED  | session tests                     |
| MCP lifecycle and authorization       | TESTED  | MCP integration tests             |
| Multi-agent workspace recovery        | TESTED  | multi-agent tests                 |
| OS-level process isolation            | BLOCKED | no enforceable backend registered |

## Priorities

### P0

1. Implement a supported OS/container/VM isolation backend.
2. Add disposable runtime tests for filesystem, network, privilege, mount, resource, and descendant cleanup guarantees.

### P1

1. Add chaos fixtures for MCP disconnect during uncertain side effects.
2. Add durable operation journals for multi-file mutations that can outlive a process.
3. Add CI jobs for network-enabled dependency advisories and supported native platform checks.

### P2

1. Add reliability SLO collection from real runs.
2. Add platform-specific orphan-process and disk-pressure tests.

No reliability claim should exceed the evidence in this plan.
