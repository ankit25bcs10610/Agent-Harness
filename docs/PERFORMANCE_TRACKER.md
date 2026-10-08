# Prompt 23 performance tracker

Measured baseline from `bun run benchmark:intelligence`: 100 files, 85 ms indexing, 1 ms retrieval, 20 results. This is a local baseline, not a speedup claim.

Repository indexing now emits opt-in measured durations for listing, parsing, and complete index construction through `IntelligenceOptions.onMetric`. The callback is disabled unless supplied.

Remaining work includes UI rerender profiling, request deduplication, freshness-aware index invalidation, session write batching, multi-agent scheduling benchmarks, and cross-platform profiling.
