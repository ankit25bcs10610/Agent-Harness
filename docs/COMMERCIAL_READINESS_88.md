# Commercial readiness — Prompt 88

This is an internal commercial-integrity record. It does not represent a paying customer, live revenue, a published price list, or a production payment integration.

## Actual commercial status

- Verified paying customers: **0**
- Verified revenue, MRR, ARR, refunds, and provider fees: **none available**
- Live checkout or payment-provider account: **not configured**
- Sandbox transactions: **none run in this iteration**
- External outreach, charging, contracts, and subscription changes: **0**

## Implemented in this iteration

- Pricing and ledger amounts now require safe non-negative integer minor units before arithmetic or persistence.
- Added HMAC-SHA256 billing webhook signing and verification with constant-time signature comparison.
- Added a subscription-store `applyWebhook` entry point that verifies the provider payload before applying the existing idempotent, tenant-scoped subscription state machine.
- Added tests for forged signatures, valid signatures, duplicate events, out-of-order events, tenant isolation, and unsafe money values.

The existing `applyVerifiedEvent` method remains an internal trusted-event boundary for callers that already perform provider verification. Client-controlled `verified: true` data must not be treated as payment evidence; external integrations should use `applyWebhook`.

## Validation

| Command                                                                                                | Result                     |
| ------------------------------------------------------------------------------------------------------ | -------------------------- |
| `bun run typecheck`                                                                                    | PASS                       |
| `bun test ./tests/unit/pricing.test.ts ./tests/unit/ledger.test.ts ./tests/unit/subscriptions.test.ts` | PASS — 9 tests, 0 failures |
| `bun run format:ci`                                                                                    | PASS                       |
| `bun test`                                                                                             | Pending final run          |

## Acceptance status

| Scenario                                            | Status                         | Evidence or limitation                                       |
| --------------------------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| Customer interest and tenant access                 | PASS for local stores          | Existing lead/opportunity tests                              |
| Unsupported capability flagged                      | PASS                           | Existing edition/capability evidence                         |
| Approved catalog price and invalid price rejection  | PASS                           | Pricing tests                                                |
| Quote approval and draft contract boundaries        | PASS                           | Quote/contract tests                                         |
| Forged webhook rejected                             | PASS                           | New HMAC regression                                          |
| Duplicate/out-of-order billing events               | PASS                           | Subscription tests                                           |
| Verified subscription entitlement                   | PASS for signed fixture events | No live provider configured                                  |
| Currency-safe ledger arithmetic                     | PASS                           | Safe-integer ledger/pricing tests                            |
| Invoice, checkout, refunds, tax, and reconciliation | NOT_RUN                        | No provider adapter or authorized sandbox account configured |
| Full customer → payment → onboarding workflow       | NOT_RUN                        | No genuine customer or payment evidence exists               |

## Quality gates

Product licensing accuracy, approved local pricing, quote authorization, tenant isolation, idempotent subscription state, and currency-safe arithmetic are locally covered. Live payment verification, checkout, invoices, refunds, tax, customer onboarding, and revenue reporting remain unavailable or unverified. No sandbox record is counted as real revenue.

## Next action

Add a provider-neutral, persisted billing-event reconciliation record that compares verified provider events, subscription state, and ledger entries without mutating finalized financial records. Integrate a real sandbox adapter only after explicit provider credentials and authorization are supplied.
