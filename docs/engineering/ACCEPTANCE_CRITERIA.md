# Acceptance Criteria — Reality Gate Evidence Mapping

This document maps each Reality Gate (RG-*) to the executable evidence it requires. Listing a gate here does not mark it PASS; a gate is only PASS when the mapped evidence has actually been produced and captured in the repository (CI run, test output, audit output, etc.).

| Gate | Maps to invariant | Required evidence (when applicable) | Current status |
|---|---|---|---|
| RG-OUTBOX | I1 — External effect / durable outbox | Outbox table/queue implementation, transactional write test, replay/at-least-once delivery test | **IMPLEMENTED** (Job/Run scope) — `packages/events/src/outbox.ts`, `migrations/0002_job_run_outbox_quota.sql` (`job_outbox`), `tests/contract/job-outbox.spec.ts` OUTBOX-01/03/04/05 |
| RG-DUP | I2 — Idempotency | Idempotency-key test covering MerchantWorkspace + integration/provider account + operation + action scope | PARTIAL — pre-existing `operational_events`/`action_executions` DB-level coverage (see `tests/contract/schema-migration.spec.mjs` `DB-03-IDEMPOTENCY-UNIQUE`) plus new Job-level app + DB dedup: `packages/events/src/job.ts` `jobDeduplicationKey`/`classifyJobSubmission`, `jobs` `UNIQUE` constraint, `tests/contract/job-outbox.spec.ts` JOB-08/09 |
| RG-SCOPE | I4 — Isolation | Tenant/workspace/integration isolation test, fail-closed-on-missing-scope test | Not yet implemented (as a dedicated RG-SCOPE suite); tenant-scope checks exist ad hoc in `action-engine.spec.ts` (`CAPABILITY-WRONG-WORKSPACE-DENY` etc.) and in the new Job/outbox/quota tests (`JOB-05`, `OUTBOX-04`, `QUOTA-04`, `QUOTA-08`) |
| RG-AUTH-RACE | I3 — Authority revalidation | Test proving revalidation of permission/approval/entitlement/kill-switch immediately before a queued or retried external effect | **IMPLEMENTED** — `apps/api/src/dispatch-safety.ts` (`revalidateBeforeDispatch`), `tests/security/dispatch-safety.spec.ts` DISPATCH-01..06 |
| RG-LIFECYCLE | Engineer/Brain state ceiling | Test/process evidence that engineer output cannot self-promote past `IMPLEMENTED` | Not yet implemented |
| RG-LEARNING | I7 — Governed learning | Test proving Candidate/Observation/Evaluation/Superseded/Revoked/unapproved learning is mechanically excluded from ACTIVE retrieval | Not yet implemented |
| RG-QUOTA | I5 — Quota/concurrency | Atomic quota/cost reservation test, bounded concurrency test, tenant fairness test | **IMPLEMENTED** — `packages/events/src/quota-ledger.ts` (`AtomicQuotaLedger`, `boundedConcurrencyRun`), `migrations/0002_job_run_outbox_quota.sql` (`quota_reservations`), `tests/contract/quota-ledger.spec.ts` QUOTA-01..08 |
| RG-AKILTA-CONTRACT | I6 — AKILTA boundary | Authenticated, anti-replay, versioned cross-project contract test; AI Commerce re-authorization test | Not yet implemented (deferred-by-activation until a real cross-project transport exists) |

## Known current D-090 reality

- **I1 (transactional outbox):** IMPLEMENTED for the Job/Run surface (P0-026 + RUN-1 adversarial delta, checkpoint `af7acb7` and the RUN-1 checkpoint following it). Not yet extended to every other external-effect boundary in the repository (`operational_events`/`action_executions` predate this and use their own DB-level idempotency, not this outbox).
- **I5 (atomic quota/cost reservation + concurrency/fairness):** IMPLEMENTED for the Job/Run surface, same checkpoints as I1 above.
- **I3 (authority revalidation immediately before dispatch/retry):** IMPLEMENTED via `dispatch-safety.ts`, reusing `action-engine.ts`'s existing authority/approval/kill-switch composition unchanged.
- All other applicable invariants remain PARTIAL or deferred, per existing authority, pending admitted product source and further Brain-directed implementation work.
- "Stale/dual worker rejection" and "double-resume protection" adversarial categories (raised for P0-023) are **NOT_APPLICABLE** to the current Job/Run model: this repository has no worker-lease/fencing-token or WAITING/RESUME concept anywhere in source (verified by repository-wide search). D-088 explicitly defers "broad lifecycle orchestration" and a generic dispatcher; inventing lease/fencing semantics here would be exactly that forbidden generic framework. Revisit only if/when a real dispatcher task is explicitly authorized.

This repository bootstrap (RB-08) did not implement any of the above; P0-026 and its RUN-1 adversarial delta are the first implementations, scoped to the Job/Run/outbox/quota/dispatch-safety surface only.
