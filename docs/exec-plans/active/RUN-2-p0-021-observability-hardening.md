# RUN-2 — P0-021 Observability / Correlation Hardening

Executed under `CR-V1 CONTINUOUS EXECUTION CONTRACT — af7acb7 → V1 CANDIDATE — 2026-08-20`,
Section 4 RUN-2. Continuation of existing P0-021 (`packages/events/src/observability.ts`,
`tests/contract/observability.spec.ts`).

## Scope

Make source-level observability reflect Job/Run/outbox/quota/dispatch-safety without turning
telemetry into business truth, per the contract's required chain: preserve run/job/correlation
IDs, queue/retry/error states, tenant-scoped usage/cost, safe error taxonomy. No new observability
platform; runtime exporter/backend remains out of scope (unchanged, still runtime-gated).

## Changes

- `packages/domain/src/errors.ts`: +2 `ErrorCode` values — `QUOTA_RESERVATION_DENIED`,
  `DISPATCH_REVALIDATION_DENIED`.
- `packages/events/src/observability.ts`: descriptors for both new codes (compiler-enforced
  exhaustiveness via the existing `satisfies Record<ErrorCode, ErrorDescriptor>`); `jobId?: JobId`
  added to `StructuredLogRecord` and `MetricPoint` for Job/Run correlation; 5 new `MetricName`
  values (`job_dispatch_attempt_count`, `job_dispatch_denied_count`, `outbox_delivery_count`,
  `outbox_replay_prevented_count`, `quota_reservation_denied_count`).
- `apps/api/src/dispatch-safety.ts`: `RevalidateBeforeDispatchDecision`'s `DENY` branch now also
  carries `code: 'DISPATCH_REVALIDATION_DENIED'` alongside the existing free-text `reason`.
- `packages/events/src/quota-ledger.ts`: `ReserveQuotaResult`'s `DENY` branch now also carries
  `code: 'QUOTA_RESERVATION_DENIED'`.
- `tests/contract/observability.spec.ts`: +4 scenarios covering the new metric names, PII/secret
  safety of a `MetricPoint` carrying `jobId`, and that both new DENY paths actually surface the new
  error-taxonomy code (not just decorative additions to the enum).

No new observability platform, exporter, or backend was added or changed.

## Checks (fresh, this checkpoint)

typecheck (main) PASS, typecheck (staging) PASS, lint PASS 0 errors, dependency-free suite 45/45
(same file count as RUN-1 — this work extended existing files rather than adding new ones), vitest
6/6, real Workers smoke 1/1, `pnpm audit` clean.

## Status

`IMPLEMENTED / SELF-VALIDATED / PENDING_FINAL_BRAIN_VERIFICATION`. Auto-advancing to RUN-3 (P0-022
migration/data-compatibility preparation) per the contract's Global Execution Rule.
