# Benchmark Results

Date: 2026-10-09
Commit: 207bcc5fabb5e473feb71c2cb9e02c75cf1f2f3d
Runtime: Bun 1.4.2 on macOS

## Safe local measurement

Command:

    CHIKU_BENCHMARK_FILES=100 bun run benchmark:intelligence

Measured output:

    files=100
    symbols=100
    indexedMs=62
    retrievalMs=1
    results=20

This is a repository-indexing microbenchmark only. It is not a coding-task success rate, model benchmark, competitor comparison, or production SLO.

## Framework validation

The deterministic evaluation suite currently passes 164 tests, 0 failures, and 412 assertions. It covers trusted graders, trace redaction, integrity checks, failure injection, experiment persistence/resume, provider failures, workspaces, permissions, sessions, and multi-agent scheduling.

## Not executed or blocked

| Evaluation                                     | Status       | Reason                                     |
| ---------------------------------------------- | ------------ | ------------------------------------------ |
| Live model coding tasks                        | NOT EXECUTED | no paid-provider authorization             |
| Official SWE-bench score                       | NOT EXECUTED | no pinned authorized dataset/evaluator run |
| Single-agent vs multi-agent quality comparison | NOT EXECUTED | no approved live task campaign             |
| Competitor comparison                          | NOT EXECUTED | no authorized competitor installations     |
| Cost per successful task                       | BLOCKED      | provider usage/pricing unavailable         |
| OS-isolated benchmark execution                | BLOCKED      | no registered isolation backend            |
| Dependency advisory benchmark                  | BLOCKED      | registry DNS unavailable during audit      |

## Failure analysis and backlog

The highest-priority benchmark gap is a disposable end-to-end coding fixture executed through the real loop with an independent grader under an enforceable sandbox. Next, add paired single/multi-agent runs with repeated trials and preserve machine-readable results. Do not publish a success rate until those runs produce actual evidence.
