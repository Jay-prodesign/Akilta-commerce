# RUN-1 — P0-023 D-090 Adversarial Delta Against P0-026

Executed under `CR-V1 CONTINUOUS EXECUTION CONTRACT — af7acb7 → V1 CANDIDATE — 2026-08-20`
(Drive fileId `1bwlcgj9zYX5ExB5fiC46JUlfSsCfO5faD0OsxcvIEM4`), Section 4 RUN-1. Continuation of
existing P0-023 (security/reality-gate umbrella; see `release/OPEN_GATES.json` `SECURITY_RUNTIME`
gate and `docs/engineering/ACCEPTANCE_CRITERIA.md`), not a new task or framework.

## Scope

Extend adversarial D-090 reality-gate coverage against the Job/Run/outbox/quota/dispatch-safety
surfaces introduced at `af7acb7` (P0-026), per the contract's required coverage list:

| Required coverage | Result |
|---|---|
| RG-OUTBOX / RG-DUP / RG-AUTH-RACE / RG-SCOPE / RG-QUOTA / RG-LEARNING | RG-OUTBOX, RG-AUTH-RACE, RG-QUOTA now **IMPLEMENTED** for the Job/Run surface (see `ACCEPTANCE_CRITERIA.md`, updated this checkpoint). RG-DUP gained a Job-level app+DB dedup path (`jobDeduplicationKey`/`classifyJobSubmission` + `jobs` UNIQUE constraint). RG-SCOPE, RG-LEARNING: no Job/Run-specific gap found beyond what P0-026 and this delta already cover (`JOB-05`, `OUTBOX-04`, `QUOTA-04`, `QUOTA-08`); RG-LEARNING is not applicable to this surface at all (no learning/knowledge retrieval touches Job/Run). |
| Duplicate/out-of-order handling | `JOB-08`/`JOB-09` (application-level dedup key), `P0026-JOB-IDEMPOTENCY-UNIQUE` (DB level, pre-existing from P0-026) |
| Stale/dual worker rejection, where current runtime contracts expose it | **NOT_APPLICABLE** — verified by repository-wide search: no worker-lease/fencing-token concept exists anywhere in this repository's source. Recorded explicitly in `ACCEPTANCE_CRITERIA.md` rather than inventing lease/fencing semantics, which D-088 explicitly forbids as out-of-scope generic dispatch machinery. |
| Double-resume protection, where current wait/resume semantics are present | **NOT_APPLICABLE** — same basis: no WAITING/RESUME concept exists in this repository (that pattern belongs to a different project's orchestration bridge, not AI Commerce's Job/Run model). |
| Ambiguous prior external-effect settlement must never blindly replay mutation | `OUTBOX-05` — composes the new outbox delivery-tracking with the existing `action-settlement.ts` reconciliation contract; proves an `OUTCOME_UNKNOWN` settlement routes to `RECONCILE_PROVIDER_RESULT` and cannot unlock a second automatic delivery of the same outbox entry. |
| Tenant/workspace/integration preservation | `JOB-05` (cross-workspace child job rejected), `OUTBOX-04` (outbox workspace always derived from its job, never independently settable), `QUOTA-04`/`QUOTA-08` (tenant fairness; a reused reservation-id string across workspaces cannot cross-consume budget) |
| Secret/PII-safe failure evidence | `tests/contract/p0-026-source-safety.spec.mjs` (new) — source-level scan proving `job.ts`/`outbox.ts`/`quota-ledger.ts`/`dispatch-safety.ts` never reference a raw-secret-like or raw-payload field; the outbox contract is `payloadRef`-only. |

## Changed files (this checkpoint, relative to the P0-026 checkpoint `af7acb7`)

- `packages/events/src/job.ts`: added `jobDeduplicationKey`/`classifyJobSubmission` (RG-DUP, mirrors the existing `operational.ts` pattern exactly).
- `tests/contract/job-outbox.spec.ts`: +4 scenarios (`JOB-08`, `JOB-09`, `OUTBOX-04`, `OUTBOX-05`).
- `tests/contract/quota-ledger.spec.ts`: +1 scenario (`QUOTA-08`).
- `tests/contract/p0-026-source-safety.spec.mjs` (new): 5 scenarios.
- `scripts/run-staging-tests.mjs`: +1 line registering the new source-safety check.
- `docs/engineering/ACCEPTANCE_CRITERIA.md`: RG-OUTBOX/RG-AUTH-RACE/RG-QUOTA marked IMPLEMENTED with evidence refs; RG-DUP marked PARTIAL with the new Job-level evidence; explicit NOT_APPLICABLE notes for the stale-worker/double-resume adversarial categories.

## Checks (fresh, this checkpoint)

typecheck (main) PASS, typecheck (staging) PASS, lint PASS 0 errors, dependency-free suite **45/45**
(was 44/44 after P0-026; +1 new file `p0-026-source-safety.spec.mjs`, existing files gained
scenarios internally), vitest 6/6, real Workers smoke 1/1, `pnpm audit` clean.

## Status

`IMPLEMENTED / SELF-VALIDATED / PENDING_FINAL_BRAIN_VERIFICATION`. Per the contract's Global
Execution Rule, not stopping here — auto-advancing to RUN-2 (P0-021 observability/correlation
hardening).
