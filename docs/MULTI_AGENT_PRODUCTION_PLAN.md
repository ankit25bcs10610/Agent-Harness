# Multi-Agent Production Plan

Date: 2026-10-09

## Verified baseline

The current coordinator, scheduler, runtime, task graph, communication bus, workspaces, contracts, review loop, and persisted agent sessions are integrated. The current deterministic baseline is 164 passing tests, including multi-agent scheduling, workspace isolation, contract binding, recovery, review repair, and conflict detection.

## Implemented and tested

- Typed task decomposition with bounded graph depth and cycle rejection.
- Dependency-aware scheduling with configurable parallelism.
- Per-agent tool allowlists, budgets, cancellation, and dedicated write workspaces.
- Persisted task/execution state with running work recovered as blocked.
- Structured handoff messages with bounded validation.
- Change Contract binding for delegated writes.
- Review and repair loops with bounded attempts.
- Explicit conflict detection during workspace integration.

## Remaining production work

### P0

1. Require a real OS-enforced sandbox before running workers against untrusted repositories. Current process isolation fails closed when requested, but no backend is registered.
2. Add disposable end-to-end fixtures that execute bug-fix and feature tasks through the real coordinator and verify repository outcomes independently.

### P1

1. Add durable worker heartbeat/liveness events and crash reconciliation.
2. Add explicit uncertain-side-effect state for MCP calls interrupted after dispatch.
3. Add measured multi-agent versus single-agent benchmarks using identical fixtures.
4. Add CI jobs for the disposable integration suite.

### P2

1. Add richer terminal task/dependency/resource views.
2. Add platform-specific worktree and cancellation validation.

## Safety boundary

No live provider, GitHub repository, customer repository, or untrusted command execution is used by deterministic CI tests. Fixture-provider results must remain separate from real-model capability claims.
