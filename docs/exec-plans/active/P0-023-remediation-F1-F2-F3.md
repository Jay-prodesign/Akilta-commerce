# P0-023 Remediation — F1/F2/F3 (Brain CHANGES_REQUIRED on db5e81b)

Responds to `AI COMMERCE — CONTINUOUS RUN BRAIN AUDIT — CHANGES REQUIRED — db5e81b` (Drive fileId
`1xmCsw_drCGlU5rHuam0nSww1LMjBgAzBOIlxQyhMCbo`). Brain accepted RUN-1..RUN-4 as useful evidence and
did not require rework of that work; it rejected the `BLOCKED_ALL_EXTERNAL_GATES` stop as premature
and required three owner-free findings closed first.

## F1 — single-owner / recovery semantics

Brain's correction: repo absence of a lease/fencing concept is not valid grounds for `NOT_APPLICABLE`
when canonical P0-026 acceptance requires it for Job/Run + queued/retried external-effect execution.
WAITING/ANSWER/RESUME stays `NOT_APPLICABLE` (Brain explicitly accepted that basis — no actual async
human/reviewer wait state exists in frozen CR-V1's Job/Run path).

**Implementation** — smallest deterministic single-owner mechanism, not a generic workflow engine:
- `packages/events/src/job-lease.ts` (new): `acquireJobLease` (lease/heartbeat with a monotonically
  increasing fencing token — unclaimed or expired leases are always reclaimable, which *is* the
  crash/restart/orphan-reconciliation path with no separate detector needed) and
  `evaluateFencedOperation` (a token below the current floor is refused regardless of business
  validity — the stale/dual-worker rejection path).
- `migrations/0003_job_lease_quota_budget.sql`: `jobs.owner_lease_id`, `jobs.lease_expires_at`,
  `jobs.fencing_token` (additive-only, doesn't touch 0001/0002).
- `tests/contract/job-lease.spec.ts` (new, 6 scenarios): unclaimed-job acquisition, dual-worker
  rejection while actively held, same-owner renewal, crash/restart/orphan reconciliation via expiry,
  stale-token rejection, current-or-newer-token acceptance.
- Real Postgres evidence (`scripts/pg-remediation-evidence.mjs`, F1 section): 8 genuinely concurrent
  client connections race to claim the same job via
  `UPDATE jobs SET owner_lease_id=... WHERE owner_lease_id IS NULL OR lease_expires_at < now()
  RETURNING fencing_token` — exactly 1 of 8 wins, and the persisted row matches the winner exactly.

## F2 — D-090 I5 durable atomic quota evidence

Brain's correction: `AtomicQuotaLedger` is a real, useful pure-logic model, but an in-memory
single-process synchronization proof cannot by itself demonstrate multi-worker/process durable
atomic pre-spend reservation — that requires a real database.

**Implementation:**
- `migrations/0003_job_lease_quota_budget.sql`: new `quota_budgets` table (workspace+budget_key
  scoped running total with `limit_amount`/`used_amount` and a `CHECK (used_amount <= limit_amount)`)
  — the previously-existing `quota_reservations` table records individual reservation rows but has
  no DB-enforced aggregate ceiling; `quota_budgets` is the minimal addition that gives a single
  atomic `UPDATE ... WHERE used_amount + $amount <= limit_amount` a real row to arbitrate against.
- Real Postgres evidence (`scripts/pg-remediation-evidence.mjs`, F2 section): 10 genuinely
  concurrent client connections each attempt to reserve 1 unit against `limit_amount=5`. Result:
  **exactly 5 granted, 5 denied** — `used_amount` and the `quota_reservations` row count both match
  the granted total exactly. A second workspace's budget is proven unaffected (tenant isolation).
  Once workspace A is exhausted, a further attempt is deterministically denied.

## F3 — D-090 I1 durable outbox transaction evidence

Brain's correction: schema/constraint/apply/rollback/backup-restore evidence (RUN-3) is real but is
not the same as proving the job+outbox write is genuinely atomic under a real transaction, or that a
replayed submission is handled safely rather than merely rejected by a constraint.

**Real Postgres evidence** (`scripts/pg-remediation-evidence.mjs`, F3 section):
- **Rollback proof**: insert a job + its outbox row inside one transaction, then force a real
  constraint violation on a second statement in the *same* transaction before `COMMIT`. Result:
  neither the job row nor the outbox row persists (`jobs=0 outbox=0` after the forced rollback) —
  they only ever commit or roll back together.
- **Commit proof**: the same job+outbox pair, committed normally — both rows exist together
  afterward.
- **Replay/idempotency proof**: re-submitting the exact same logical job (same
  workspace+capability_ref+idempotency_key) via a real `INSERT ... ON CONFLICT (...) DO NOTHING` —
  the replay inserts zero rows and the original row's data is unchanged (still points at the
  original `job_id`), proving replay is handled as an explicit, safe no-op rather than merely an
  uncaught constraint error.

## Method (same discipline as RUN-3)

Ephemeral local PostgreSQL 16 (pre-installed, no credentials/paid/production action), own data
directory, own port (5434), own Unix socket directory, `trust` auth, never exposed beyond localhost.
`scripts/pg-remediation-evidence.mjs` (new, uses the already-declared `pg` dependency) applied
0001→0002→0003 cleanly, then ran all F1/F2/F3 scenarios via genuinely concurrent client connections
(real network round-trips, Postgres row-level locking arbitrates — not in-process JS scheduling).
**Every scenario passed on the first run.** Cluster fully stopped and removed afterward; `git status`
confirms no stray files.

```
PASS SETUP-0001-0002-0003-APPLIED-CLEAN
PASS F2-CONCURRENT-RESERVATION-NO-OVERSPEND -- granted=5 (expected 5)
PASS F2-USED-AMOUNT-MATCHES-GRANTED-EXACTLY -- used_amount=5
PASS F2-RESERVATION-ROW-COUNT-MATCHES-GRANTED -- rows=5
PASS F2-TENANT-ISOLATION-SECOND-WORKSPACE-UNAFFECTED -- workspace B used_amount=1
PASS F2-DETERMINISTIC-DENIAL-WHEN-EXHAUSTED -- result=DENY
PASS F3-FORCED-FAILURE-TRIGGERED-ROLLBACK
PASS F3-ROLLBACK-LEAVES-NEITHER-JOB-NOR-OUTBOX-ROW -- jobs=0 outbox=0
PASS F3-COMMIT-PERSISTS-JOB-AND-OUTBOX-TOGETHER -- job=PENDING outbox=PENDING
PASS F3-REPLAY-INSERT-SAFELY-NO-OPS -- replay rowCount=0
PASS F3-REPLAY-DID-NOT-MUTATE-ORIGINAL-ROW -- job_id=86dd8241-5d41-46d6-947b-4633785b7275
PASS F1-EXACTLY-ONE-CONCURRENT-CLAIM-WINS -- winners=1
PASS F1-WINNING-CLAIM-MATCHES-PERSISTED-STATE -- owner=worker-0 fencing_token=1
PG_REMEDIATION_EVIDENCE_PASS
```

`scripts/pg-remediation-evidence.mjs` is not wired into the CI-gated dependency-free suite (no
Postgres service exists in CI yet, per `release/OPEN_GATES.json` `POSTGRES_RUNTIME`); it is a
reusable, documented manual evidence generator, exactly matching RUN-3's precedent
(`node scripts/pg-remediation-evidence.mjs <connection-string>`).

## Extended P0-023/D-090 adversarial coverage (requirement #5)

Stale/dual owner and orphan recovery: `tests/contract/job-lease.spec.ts` (dependency-free) +
`scripts/pg-remediation-evidence.mjs` F1 section (real concurrent DB proof). Transaction
rollback, quota race, duplicate replay: `scripts/pg-remediation-evidence.mjs` F2/F3 sections (real
DB proof; not expressible as dependency-free source-level tests since they require genuine
multi-connection concurrency and real transaction semantics).

## Checks (fresh, this checkpoint)

typecheck (main) PASS 0 errors, typecheck (staging) PASS 0 errors, lint PASS 0 errors,
dependency-free suite **47/47** (was 45/45; +6 `job-lease.spec.ts` scenarios, +9
`schema-migration-0003.spec.mjs` scenarios), vitest 6/6, real Workers smoke 4/4 (unchanged), `pnpm
audit` clean, real local PostgreSQL 16 remediation evidence 13/13 PASS (all F1/F2/F3 scenarios).

## Status

`IMPLEMENTED / SELF-VALIDATED / PENDING_FINAL_BRAIN_VERIFICATION`. Per Brain's instruction #8,
resuming the continuous execution contract automatically after this checkpoint.
