# Acceptance Criteria — Reality Gate Evidence Mapping

This document maps each Reality Gate (RG-*) to the executable evidence it requires. Listing a gate here does not mark it PASS; a gate is only PASS when the mapped evidence has actually been produced and captured in the repository (CI run, test output, audit output, etc.).

| Gate | Maps to invariant | Required evidence (when applicable) | Current status |
|---|---|---|---|
| RG-OUTBOX | I1 — External effect / durable outbox | Outbox table/queue implementation, transactional write test, replay/at-least-once delivery test | **MISSING** |
| RG-DUP | I2 — Idempotency | Idempotency-key test covering MerchantWorkspace + integration/provider account + operation + action scope | Not yet implemented |
| RG-SCOPE | I4 — Isolation | Tenant/workspace/integration isolation test, fail-closed-on-missing-scope test | Not yet implemented |
| RG-AUTH-RACE | I3 — Authority revalidation | Test proving revalidation of permission/approval/entitlement/kill-switch immediately before a queued or retried external effect | Not yet implemented |
| RG-LIFECYCLE | Engineer/Brain state ceiling | Test/process evidence that engineer output cannot self-promote past `IMPLEMENTED` | Not yet implemented |
| RG-LEARNING | I7 — Governed learning | Test proving Candidate/Observation/Evaluation/Superseded/Revoked/unapproved learning is mechanically excluded from ACTIVE retrieval | Not yet implemented |
| RG-QUOTA | I5 — Quota/concurrency | Atomic quota/cost reservation test, bounded concurrency test, tenant fairness test | **MISSING** |
| RG-AKILTA-CONTRACT | I6 — AKILTA boundary | Authenticated, anti-replay, versioned cross-project contract test; AI Commerce re-authorization test | Not yet implemented |

## Known current D-090 reality

- **I1 (transactional outbox): MISSING** — no outbox implementation exists in this repository yet.
- **I5 (atomic quota/cost reservation + concurrency/fairness): MISSING** — no implementation exists in this repository yet.
- All other applicable invariants remain PARTIAL or deferred, per existing authority, pending admitted product source and Brain-directed implementation work.

This repository bootstrap (RB-08) does not implement any of the missing product controls above. Implementation is out of scope for RB-08.
