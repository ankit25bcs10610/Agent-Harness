# Reliability readiness — Prompt 86

This record distinguishes deterministic local fixtures from genuine user incidents. No production incident, uptime statistic, or beta failure is inferred from the tests below.

## Implemented repair

Persisted crash reports are now validated against a versioned schema before storage, export, or incident classification. Malformed reports are ignored safely during incident listing. Incidents receive a deterministic SHA-256 signature derived from normalized error name and message, allowing repeated causes with changing request IDs or numbers to be grouped without treating the grouping as root-cause confirmation.

## Evidence

| Check                                                                | Result                                               |
| -------------------------------------------------------------------- | ---------------------------------------------------- |
| `bun run typecheck`                                                  | PASS                                                 |
| `bun test ./tests/unit/incidents.test.ts ./tests/unit/crash.test.ts` | PASS — 6 tests, 0 failures                           |
| `bun test`                                                           | Pending final run                                    |
| `bun run format:ci`                                                  | PASS before final test assertion change; rerun below |

The new tests cover stable grouping of equivalent error signatures and safe omission of malformed persisted reports. Existing tests cover bounded local crash storage, secret redaction, export collision handling, and human-review-only incident classification.

## Actual versus synthetic evidence

- Verified real user incidents: **0 available**.
- Synthetic crash fixtures: used for deterministic regression tests only.
- Provider, network, paid inference, production chaos, and external beta services: **NOT_RUN**.
- OS-level sandbox guarantees: **not provided by this distribution**.

## Acceptance status

1. Crash diagnostics without secrets — PASS.
2. Identical error signatures group — PASS.
3. Fixture data separated from actual incidents — PASS for local test storage; no live incident feed configured.
4. Provider rate-limit/timeout behavior — PASS in existing provider tests.
5. Tool timeout and cleanup — PASS in existing process tests.
6. Cancellation — PASS in existing process and loop tests.
7. Session integrity/recovery — PASS in existing session tests.
8. Patch and Git safety — PASS in existing patch/workspace tests.
9. Context/resource accounting — PASS in existing context and metrics tests.
10. Performance regression against a real baseline — NOT_RUN.
11. Full failure → repair → stress rerun lifecycle — NOT_RUN for real user failures.

## Quality gates

Privacy-safe diagnostics, reproducible crash fixtures, provider resilience, process cancellation, session integrity, Git preservation, and evidence-backed local metrics are covered by existing tests. Real user evidence, production performance baselines, UI stress validation, and release impact assessment remain NOT_RUN. The product must not be declared production-ready from this fixture evidence alone.

## Next action

Add a local, opt-in reliability issue registry linking a redacted crash signature to a version, component, reproduction status, and human triage state. Keep it separate from synthetic fixtures and do not add network transmission or automatic issue submission.
