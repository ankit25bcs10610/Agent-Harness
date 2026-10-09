# Performance Baseline

Date: 2026-10-09
Environment: macOS, Bun 1.4.2, local disposable fixtures.

## Deterministic baseline

Command:

    CHIKU_BENCHMARK_FILES=100 bun run benchmark:intelligence

Observed output from the current run:

    files=100, symbols=100, indexedMs=74, retrievalMs=1, results=20

This measures repository indexing and retrieval only. It does not measure model latency, first-token latency, token usage, monetary cost, coding-task success, or multi-agent quality.

## Validation baseline

- Full test suite: 166 passed, 0 failed, 417 assertions.
- TypeScript validation: passed.
- Security scan: previously passed on the current working tree before this routing change.

## Optimization policy

No model-routing quality improvement or cost reduction is claimed. Live provider metrics require explicit credentials, authorized tasks, and actual provider usage data. The new router records estimates only when versioned pricing metadata is supplied and fails closed on privacy, capability, or budget constraints.

## Next measurements

Run paired fixed-model and policy-routed coding fixtures with identical tasks, budgets, provider configuration, and independent verification. Report actual usage, latency, failure rate, and cost per verified success before changing defaults.
