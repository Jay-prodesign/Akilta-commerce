# RUN-3 — P0-022 Migration / Data-Compatibility Preparation

Executed under `CR-V1 CONTINUOUS EXECUTION CONTRACT — af7acb7 → V1 CANDIDATE — 2026-08-20`,
Section 4 RUN-3.

## Scope

Integrate migration `0002_job_run_outbox_quota.sql` with the existing relational foundation
(`0001_foundation.sql`) and prove every provider-independent compatibility property possible.
A real local/ephemeral PostgreSQL 16 runtime was available in this execution environment
(`postgresql-16` package pre-installed, no credentials/paid/production action required to use it),
so this run executed real `apply`/constraint/`down`/backup/restore evidence rather than recording
`NOT_RUN`.

## Method

Initialized an ephemeral PostgreSQL 16 cluster in `/tmp` (own data directory, own port 5433, own
Unix socket directory, `trust` auth, never bound beyond localhost, no system service touched, no
secrets/credentials involved, fully destroyed at the end of this run — `pg_ctl stop` + directory
removal). This is local test infrastructure only; nothing here is a runtime/provider promotion.

## Evidence

**0001 → 0002 structural compatibility**: `0001_foundation.sql` applied cleanly (38 tables), then
`0002_job_run_outbox_quota.sql` applied cleanly on top (3 new tables: `quota_reservations`, `jobs`,
`job_outbox`) with no conflicts. `0001` was not modified (already enforced by
`P0026-DOES-NOT-MODIFY-0001` in CI).

**Constraints/FKs/unique/idempotency/tenant binding** — 11 real adversarial inserts against the live
schema, exactly matching intended behavior:

| # | Case | Expected | Actual |
|---|---|---|---|
| T1 | Metered job (`metered_spend=TRUE`) without `quota_reservation_id` | REJECTED | `jobs_check` CHECK violation — REJECTED |
| T2 | Metered job with a real `quota_reservation_id` | ACCEPTED | INSERT 0 1 |
| T3 | Duplicate `(merchant_workspace_id, capability_ref, idempotency_key)` | REJECTED | UNIQUE violation — REJECTED |
| T4 | Child job with a real `parent_job_id` | ACCEPTED | INSERT 0 1 |
| T5 | Job with a nonexistent `parent_job_id` | REJECTED | FK violation (`jobs_parent_job_id_fkey`) — REJECTED |
| T6 | Outbox row for a real job | ACCEPTED | INSERT 0 1 |
| T7 | Duplicate `(merchant_workspace_id, topic, idempotency_key)` outbox entry (replay) | REJECTED | UNIQUE violation — REJECTED |
| T8 | Outbox row for a nonexistent job | REJECTED | FK violation (`job_outbox_job_id_fkey`) — REJECTED |
| T9 | `quota_reservations.status` outside the enum | REJECTED | CHECK violation — REJECTED |
| T10 | `reserved_amount <= 0` | REJECTED | CHECK violation — REJECTED |
| T11 | `jobs.status` outside the enum | REJECTED | CHECK violation — REJECTED |

All FK chains resolve through the pre-existing `merchant_workspaces`/`organizations` tenant tables
from `0001` (no parallel tenant model), matching D-088 S3 (universal workspace scope).

**Apply/down/rollback semantics**: `0002_job_run_outbox_quota.preproduction_rollback.sql` executed
cleanly — dropped `job_outbox`, `jobs`, `quota_reservations` in FK-safe order, `COMMIT`. Verified
post-rollback that all three tables are gone (`information_schema.tables` query returns 0 rows) and
that `0001`'s data (`merchant_workspaces` row) is completely untouched.

**Backup/restore procedure**: re-applied `0002`, inserted one real linked row set (job + its
quota reservation + its outbox entry), ran `pg_dump -Fc`, restored into a fresh database via
`pg_restore`, and verified: (a) all three rows restored with byte-identical values including the
FK-linked `quota_reservation_id`; (b) the `jobs_check` CHECK constraint was still live and correctly
rejected a post-restore invalid insert (same T1 case, re-run against the restored database).

## Known limitation

This is local/ephemeral PostgreSQL, not the eventual production-vendor runtime (Hyperdrive/managed
Postgres) — per the contract's own instruction, this run does not freeze a production-vendor choice.
Real production connectivity, Cloudflare Hyperdrive binding, and live-tenant backup/restore
procedures remain a separate, later, owner/provider-gated concern (RUN-4).

## Cleanup

Ephemeral cluster stopped and fully removed (`/tmp/pgdata-run3`, `/tmp/pgsock-run3`, dump file, all
deleted). `git status` confirms no stray files in the repository; port 5433 confirmed clear.

## Checks (repository, fresh, this checkpoint)

No source changes were required for this run (migration files were already correct from P0-026 /
RUN-1); this was pure verification. typecheck, typecheck:staging, lint, dependency-free suite
(45/45), vitest, real Workers smoke, and `pnpm audit` all remain green (unchanged from RUN-2's
checkpoint `18c6779`, re-confirmed clean working tree).

## Status

`IMPLEMENTED / SELF-VALIDATED / PENDING_FINAL_BRAIN_VERIFICATION`. Auto-advancing to RUN-4 (P0-024
owner-free runtime evidence) per the contract's Global Execution Rule.
