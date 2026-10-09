# Engineering design-partner readiness — Prompt 87

This is an internal implementation and validation record. It does not represent customer participation, a signed agreement, a security review by a customer, or a commercial outcome.

## Actual partner status

- Verified design-partner organizations: **0**
- Authorized private repositories: **0**
- Meetings, agreements, outreach, and charges: **0**
- Real coding-task outcomes: **none available**
- Synthetic fixture records: used only in automated tests

## Implemented in this iteration

Pilot request and evaluation lifecycle transitions now require an authenticated team membership, not only a caller-supplied organization ID. Sensitive transitions use the existing RBAC boundary: security review requires `policy:manage`, approval/authorization requires `tasks:approve`, and ordinary task lifecycle transitions require `tasks:write`. Cross-tenant and inactive memberships remain denied by the same authorization layer.

This prevents a same-tenant member from self-approving a pilot or bypassing security review. It does not create hosted authentication, organization provisioning, private repository access, or customer communications.

## Validation

| Command                               | Result                     |
| ------------------------------------- | -------------------------- |
| `bun run typecheck`                   | PASS                       |
| `bun test ./tests/unit/pilot.test.ts` | PASS — 6 tests, 0 failures |
| `bun run format:ci`                   | PASS                       |
| `bun test`                            | Pending final run          |

The pilot tests cover lifecycle ordering, tenant isolation, unknown cost handling, owner approval, and same-tenant member denial for security review and approval.

## Acceptance status

| Scenario                                                 | Status                                                          | Evidence or limitation                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Pilot request persists and validates                     | PASS                                                            | Versioned pilot schemas and lifecycle tests                                    |
| Unauthorized approval blocked                            | PASS                                                            | RBAC regression test                                                           |
| Organization ownership and tenant isolation              | PASS                                                            | Existing team and pilot tests                                                  |
| Membership and policy controls                           | PARTIAL                                                         | Local RBAC exists; hosted identity provisioning is absent                      |
| Approved repository scope                                | PARTIAL                                                         | Local workspace/permission boundaries exist; no partner repository authorized  |
| Independent coding evaluation                            | PASS for deterministic fixtures; NOT_RUN for real partner tasks | Evaluation harness exists, no authorized partner run                           |
| Failed tasks and unknown costs remain honest             | PASS                                                            | Pilot/evaluation metric tests                                                  |
| Feedback and support escalation                          | PARTIAL                                                         | Local feedback drafts exist; support desk is not connected                     |
| Pilot reporting and commercial handoff                   | PARTIAL                                                         | Lifecycle data exists; no real partner evidence or automatic commercial action |
| Full request → approval → evaluation → feedback workflow | NOT_RUN                                                         | No genuine organization or external service authorized                         |

## Quality gates

Core CLI, tenant checks, RBAC transition authorization, local independent grading, privacy-aware feedback, and honest cost semantics are locally covered. Authenticated hosted organizations, customer security reviews, private repository access, real coding outcomes, support operations, and commercial handoff remain unavailable or unverified. The implementation must not be described as enterprise-ready based on synthetic fixtures alone.

## Next action

Add a local, tenant-scoped pilot support/issue store with authenticated actor checks, explicit status transitions, version linkage, and no network delivery. Then connect it to actual pilot evaluation records and add an end-to-end controlled-fixture workflow.
