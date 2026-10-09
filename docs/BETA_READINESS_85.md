# Private beta readiness — Prompt 85

This is a local engineering readiness record. It does not represent a live beta, real user research, or external distribution.

## Current participant and release status

- Verified real participants: **0**
- Synthetic fixture participants: used only in tests
- Invitations sent: **0**
- External messages: **0**
- Public or beta release published: **no**
- Live provider or hosted service calls: **not run**

## Implemented in this iteration

Participant enrollment now creates a random self-service access credential. Only its SHA-256 hash is persisted in the local beta store; the plaintext credential is returned once with the enrollment result. Participant lookup and consent withdrawal require that credential and reject wrong credentials with the same authorization error. Existing records without the new hash remain readable for administrative listing but cannot use self-service operations until re-enrollment, preserving stored data without weakening access control.

## Existing local controls

- Invitation tokens are random, hashed at rest, expiring, revocable, and single-use.
- Enrollment checks program capacity, platform, consent version, expiry, and duplicate contact hash.
- Feedback drafts are local, bounded, redacted, consent-gated, and version-linked.
- Crash diagnostics are local, bounded, redacted, and not automatically transmitted.
- Analytics are opt-in and exclude synthetic records from product metrics.
- Release artifacts have checksum/manifest validation.

## Validation executed

| Command                                           | Result                     |
| ------------------------------------------------- | -------------------------- |
| `bun run typecheck`                               | PASS                       |
| `bun test ./tests/unit/beta-participants.test.ts` | PASS — 3 tests, 0 failures |
| `bun run format:ci`                               | PASS                       |

The beta regression covers correct enrollment, secret non-persistence, wrong-token denial, authorized lookup, withdrawal, expiry, revocation, consent mismatch, platform mismatch, capacity, and duplicate enrollment.

## Acceptance status

| Scenario                                    | Status  | Reason                                                            |
| ------------------------------------------- | ------- | ----------------------------------------------------------------- |
| Beta configuration persists                 | PASS    | Versioned local program store exists                              |
| Valid invitation accepted                   | PASS    | Invitation/enrollment tests                                       |
| Expired/revoked invitation rejected         | PASS    | Invitation tests                                                  |
| Unauthorized participant access denied      | PASS    | Access-credential regression                                      |
| Duplicate enrollment handled                | PASS    | Contact hash and single-use invitation checks                     |
| Consent recorded and withdrawal processed   | PASS    | Versioned consent tests                                           |
| Package integrity and diagnostics redaction | PASS    | Existing release/crash/feedback tests                             |
| Clean installation and real coding task     | NOT_RUN | No external beta artifact or authorized provider run              |
| Feedback and bug-fix retest workflow        | PARTIAL | Local drafts exist; no live support/triage operation is connected |
| Safe beta update preserves sessions         | NOT_RUN | No external beta update was authorized                            |

## Quality gates

Enrollment, consent/privacy, diagnostic redaction, and synthetic/real record separation are locally tested. Verified installation, real coding-task acceptance, live feedback operations, beta updates, and critical-issue review remain NOT_RUN or BLOCKED until an authorized artifact, provider configuration, and human participants exist.

## Next engineering action

Connect participant-authenticated feedback and diagnostic submission to a local, tenant-scoped triage store with explicit consent, without adding network delivery or automatic outreach. Then add end-to-end fixture coverage for invitation → authenticated setup → coding result → feedback → triage.
