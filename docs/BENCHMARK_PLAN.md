# Benchmark Plan

Date: 2026-10-09

## Scope

Chiku uses the existing versioned evaluation framework under src/evaluation. It validates task schemas, disposable environments, trusted graders, redacted traces, integrity constraints, measured usage, failure classifications, baseline comparisons, and quality gates.

## Safety rules

- Benchmark definitions and graders remain application-controlled.
- Required isolation fails closed because no OS/container backend is registered.
- No paid provider calls or competitor tools are run automatically.
- Hidden tests and answer files are outside agent-declared paths.
- Fixture results are never presented as live model capability or official benchmark scores.

## Benchmark categories

1. Repository understanding and retrieval.
2. Bug fixes with independent verification.
3. Small feature changes.
4. Multi-file refactoring.
5. Test generation and defect detection.
6. Multi-agent planning, workspace isolation, review, and recovery.

## Required task record

Each task must include an immutable task ID/version, fixture commit, language/framework, instructions, allowed paths, budgets, verification commands, required isolation, trusted graders, and dataset provenance.

## Comparisons

Single-agent and multi-agent comparisons must use the same fixture, model, budgets, verification, and environment. Report correctness, duration, tokens, calls, conflicts, recovery, and cost separately. No superiority claim is valid without repeated measured runs.

## Current limitations

Live provider evaluations, official SWE-bench results, competitor comparisons, cost calibration, and isolated execution benchmarks are BLOCKED or NOT EXECUTED because credentials, authorized datasets, and an enforceable sandbox are unavailable.
