# P0-026 — Minimum Job/Run & External-Effect Safety Invariants (D-088 / D-090 I1, I3, I5)

**Document class:** Task record + implementation checkpoint (single coherent update), per the
Brain-directed continuous run-to-checkpoint policy for this task. Not a two-phase
packaging-then-implementation record like AC-ENG-TASK-001/P0-024A — this task's own authority
(`AI COMMERCE — P0-024A Brain Verification Result — PASS — dded3dc — 2026-08-19`, NEXT CURSOR
RESOLUTION) explicitly authorizes dispatch with `Owner gate: NONE for bounded reversible
implementation` and "stop only at IMPLEMENTED evidence checkpoint or a genuine existing hard-stop".

## Binding

| Field | Value |
|---|---|
| Prior verified checkpoint | `dded3dcff391dd75b23bb05e2efa4d2ad041456a` (P0-024A, Brain PASS, 2026-08-19) |
| Branch | `eng/p0-026-job-run-safety-invariants`, branched from `dded3dc` |
| P0-024A branch (`eng/p0-024a-runtime-baseline`) | untouched by this task; not reopened |
| AC-BUILD-001 | already consumed by P0-024A; not requested again |

## Task Contract (from Brain's NEXT CURSOR RESOLUTION)

- **TASK ID:** P0-026
- **GOAL:** Implement the already-frozen D-088/D-090 minimum Job/Run and external-effect safety
  invariants with executable source/schema/tests, reusing existing event/idempotency/orchestration
  contracts and avoiding a generic workflow framework.
- **AUTHORITY MAPPING (doc 07 Decision Log, "CONTROL→EXECUTION MAPPING"):** I1/RG-OUTBOX -> P0-026
  implementation (+P0-023 verification, out of this task's scope); I3/RG-AUTH-RACE -> P0-026
  (+P0-023); I5/RG-QUOTA -> P0-026 (+P0-023). P0-023 itself (independent verification pass) is a
  separate task and not attempted here.
- **EXISTING CONTRACT / AUTHORITY:** D-088 (Pre-Code Job Safety, Cost Admission, Tenant Scope &
  Extensible Dispatch Invariants); D-090 (AI Commerce Engineering Invariants & Implementation Reality
  Gate), invariants I1/I3/I5; `AGENTS.md`, `docs/engineering/ACCEPTANCE_CRITERIA.md`.
- **SCOPE:** the minimum Job/Run schema (`merchant_workspace_id`, `capability_ref`,
  `quota_reservation_id`, `parent_job_id`) plus the three safety invariants D-088/D-090 require before
  any of this schema can carry real spend/dispatch. Explicitly **not** in scope: a generic
  capability/Job dispatcher, real DB/Queue/provider wiring, or P0-023's independent verification pass.

### Allowed changes
- New domain/events source implementing Job/Run, outbox, and quota-reservation contracts.
- One additive migration (`migrations/0002_*.sql`) + matching preproduction rollback.
- New dependency-free tests covering RG-OUTBOX, RG-AUTH-RACE, RG-QUOTA.
- Minimal, behavior-preserving refactor of existing `apps/api/src/action-engine.ts` to make its
  authority/approval/kill-switch composition reusable at a second (dispatch-time) call site.
- Evidence/task-record updates.

### Forbidden changes (held)
- CR-V1 scope expansion; architecture redesign.
- A generic Job dispatcher/workflow framework (explicitly forbidden by D-088's own text).
- Modifying `migrations/0001_foundation.sql` (this task's migration is additive-only).
- Reopening or modifying `eng/p0-024a-runtime-baseline` / P0-024A's verified state.
- Production deployment, Cloudflare account mutation, real Queue/provider calls, secrets, customer
  data, AKILTA canonical writes.

### Acceptance criteria
Each of D-090 I1/I3/I5 has executable source, an additive schema change carrying the D-088 minimum
Job/Run fields, and a dependency-free test suite producing the exact evidence
`docs/engineering/ACCEPTANCE_CRITERIA.md` maps to RG-OUTBOX / RG-AUTH-RACE / RG-QUOTA. Existing
action-engine behavior is unchanged (its own pre-existing test suite still passes byte-for-byte on the
same assertions). No new dependency, no float money columns, no secret-value columns.

### Tests required
Strict TypeScript (main + staging); lint; full existing dependency-free/security/contract suite
(regression-safe); new job/outbox, dispatch-safety, and quota-ledger suites; new schema-migration
scenarios for `migrations/0002_*.sql`.

### Definition of Done
`IMPLEMENTED` only — never `VERIFIED`/`COMPLETED`. Every acceptance-criteria item above has produced
evidence (not asserted prose); the checkpoint below is real command output from this exact commit.

- **EXPECTED ENGINEER OUTPUT:** `IMPLEMENTED`, `BLOCKED`, or `ESCALATION_REQUIRED` only.
- **NEXT AUTHORITY:** AI Commerce Brain / Verifier.
- **CURRENT OPERATIONAL WORKER:** Claude (First Engineer), per D-096 Codex suspension through V1.

## D-088 minimum schema — what was implemented

Per D-088 DECISION §§1-4, the minimum Job/Run reference is:

| D-088 field | Enforcement |
|---|---|
| `merchant_workspace_id` | `NOT NULL` FK to `merchant_workspaces` on both `jobs` and `quota_reservations`; `JobRecord.merchantWorkspaceId` required in domain type. |
| `capability_ref` | `NOT NULL TEXT`; domain-level `createJob` rejects a blank value (`CAPABILITY_REF_REQUIRED`). Deliberately **not** resolved through a generic capability dispatcher — D-088 explicitly defers "exact broad lifecycle orchestration, reusable generic workflow infrastructure" as provisional/evidence-timed. |
| `quota_reservation_id` | Nullable column; `CHECK (metered_spend = FALSE OR quota_reservation_id IS NOT NULL)` at the DB layer and the equivalent domain-level rejection (`QUOTA_RESERVATION_REQUIRED_FOR_METERED_SPEND`) in `createJob` — D-088 S1's pre-spend cost admission. |
| `parent_job_id` | Nullable, self-referencing FK; only ever set by `createChildJob`, so a child job can never exist without a real, workspace-matching parent already committed — D-088 S2's bounded child-work linkage. `projectParentAggregateStatus` implements the "parent status is an aggregate projection of child truth" / "ambiguous outcome is not blindly retried as a failure" rule from the same section. |

## D-090 invariants — what was implemented

### I1 / RG-OUTBOX (`packages/events/src/outbox.ts`, `migrations/0002_*.sql` `job_outbox` table)
`stageJobWithOutbox` builds a job and its outbox record together so they can never diverge in
identity (jobId/workspace/idempotencyKey); the migration's `UNIQUE (merchant_workspace_id, topic,
idempotency_key)` gives the real transactional/replay-safe boundary. `deliverOutboxRecord` proves
at-least-once delivery still fires the external effect exactly once (`OUTBOX-03`).

### I3 / RG-AUTH-RACE (`apps/api/src/dispatch-safety.ts`)
`action-engine.ts`'s authority + approval + kill-switch-gate composition was extracted (behavior
unchanged) into `evaluateActionSafety`, so it can be called a second time by
`revalidateBeforeDispatch` immediately before a queued/retried external effect actually fires, using
freshly-supplied (not cached) state. Six adversarial `DISPATCH-0*` tests prove a kill switch flipped,
an approval expired, a membership deactivated, or a capability regressed *after* the original
prepare-time ALLOW is still caught at dispatch time.

### I5 / RG-QUOTA (`packages/events/src/quota-ledger.ts`, `migrations/0002_*.sql` `quota_reservations`
table)
`AtomicQuotaLedger.reserveAtomic` builds on the existing pure `authorizeBudgetConsume` (budget.ts) and
performs its read-then-write with no `await` in between, giving the same exclusivity a DB row-level
atomic `UPDATE` gets from a lock (`QUOTA-03`: 10 concurrent attempts against limit=5 grant exactly 5).
`boundedConcurrencyRun` bounds in-flight work (`QUOTA-05`) without letting one tenant's
exhaustion/backlog block another's independent reservation (`QUOTA-04` tenant fairness).

## Implementation checkpoint (D-086 resume/takeover record)

- **BRANCH:** `eng/p0-026-job-run-safety-invariants`
- **BASE:** `dded3dcff391dd75b23bb05e2efa4d2ad041456a` (Brain-verified PASS)
- **STATUS:** `IMPLEMENTED`
- **CHANGED FILES:** `apps/api/src/action-engine.ts` (behavior-preserving refactor), `apps/api/src/dispatch-safety.ts` (new), `packages/domain/src/ids.ts` (+`JobId`/`QuotaReservationId`/`OutboxId`), `packages/events/src/job.ts` (new), `packages/events/src/outbox.ts` (new), `packages/events/src/quota-ledger.ts` (new), `packages/events/src/index.ts` (+3 exports), `migrations/0002_job_run_outbox_quota.sql` + `.preproduction_rollback.sql` (new), `scripts/run-staging-tests.mjs` (+1 line, registers the new schema-migration check), `tests/contract/job-outbox.spec.ts`, `tests/contract/quota-ledger.spec.ts`, `tests/contract/schema-migration-0002.spec.mjs`, `tests/security/dispatch-safety.spec.ts` (all new).
- **RESTRICTIONS HELD:** no production deployment, no provider-authentic calls, no secrets, no Cloudflare account/Hyperdrive/Queue provisioning, no customer data, no AKILTA writes, no CR-V1/architecture change, no generic dispatcher/workflow framework, `migrations/0001_foundation.sql` unmodified.
- **NEXT EXACT ACTION:** Brain QA of this checkpoint; this engineer's output ceiling is `IMPLEMENTED`, not `VERIFIED`/`COMPLETED`.
