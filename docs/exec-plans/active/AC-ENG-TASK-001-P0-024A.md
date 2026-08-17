# AC-ENG-TASK-001 / P0-024A — Repository Toolchain & Runtime Evidence Baseline

**Document class:** Task packaging only. This materializes the already-prepared first post-bootstrap
engineering task candidate from canonical Drive authority (doc 14 — Repository Bootstrap Manifest &
Initial Commit Plan, D-067/D-086/D-090 addenda; doc 21 — CR-V1 Implementation Backlog & Acceptance
Matrix, GATES/PRECODE_REVIEW tabs) into a durable repository record, per the D-086 repository-native
execution bootstrap addendum. **It does not execute P0-024A and does not authorize implementation.**

## Binding

| Field | Value |
|---|---|
| Bound to (RB-09 transfer head) | `831abb78004b8beb417a99725c9ec13ab753cbc6` |
| Transfer branch / PR | `eng/rb-09-staged-transfer` / PR #4 (draft, unmerged — untouched by this document) |
| Imported source state | `IMPORTED_STAGED_UNVERIFIED / NOT_RELEASEABLE` |
| AC-BUILD-001 | `ARMED_NOT_READY` |
| Materialized on branch | `eng/ac-eng-task-001-exec-plan` (separate from PR #4; no product/source changes) |

This binding is a documentation reference only. `831abb78004b8beb417a99725c9ec13ab753cbc6` is not an
ancestor of this branch's history; it identifies the exact transfer state this task contract applies
against, per D-090/ACB-04/ACB-05 requirements.

## One-time coding-start gate — CONSUMED

Per D-067/AC-BUILD-001, canonical Drive record (00 ACTIVE EXECUTION SNAPSHOT, write-lock
`AC-GOV-098-ACBUILD-CONSUME`): `AC_BUILD: CONSUMED / OWNER_APPROVED_2026-08-17T11:01+03:00`. Brain closed
RB-14 (`AC-GOV-097-RB14-FINAL`, ACB-01..ACB-08 exact PASS against this document's `READY` state at head
`b646ca6a40942b07ab16fdca1e8a14c5b86cd3c7`) and then recorded the owner's exact `APPROVE AC-BUILD-001`.
This was independently verified against the live Drive write-lock and Command Center documents before
this task transitioned below — not accepted on assertion alone. The Drive record itself states
`IMPLEMENTATION_STARTED: NO until First Engineer returns live repo evidence of the READY -> IN_PROGRESS
transition; owner approval authorizes dispatch but does not fabricate repo state.` This document, and the
implementation branch/checkpoints described below, are that returned evidence.

RB-08/RB-09/RB-14 are not reopened by this update, and AC-BUILD-001 approval is not requested again.

## Task Contract (verbatim from canonical Drive authority)

- **TASK ID:** AC-ENG-TASK-001 / P0-024A
- **GOAL:** Convert the repository/runtime blocker into measured local repository evidence by
  establishing deterministic package install/lockfile/CI and a local Workers-compatible smoke baseline
  without requiring production/provider credentials.
- **WHY:** Most CR-V1 foundation code/contracts/tests are already staged; reimplementing P0-001..P0-023
  would duplicate work. P0-024 is the first unresolved engineering-evidence wave that the
  repository/runtime surface materially unlocks.
- **SCOPE:** repository toolchain/runtime evidence subset of P0-024 only.
- **EXISTING CONTRACT / AUTHORITY:** Drive doc 03 D-045; doc 13; doc 14; doc 15 D-086; doc 21
  P0-024/G-AC-BUILD-001/RUNBOOK; doc 28; current staged package/transfer manifest.

### Allowed changes
- Exact dependency installation and lockfile generation.
- Repository scripts/CI wiring needed to execute existing staged checks.
- Local Wrangler/workerd/Workers smoke setup.
- Minimal corrections strictly required for transferred code to install/typecheck/test in the canonical
  repository.
- Evidence/task-record updates.

### Forbidden changes
- CR-V1 scope expansion.
- Architecture redesign.
- Connector/provider schema invention.
- Production deployment.
- Cloudflare account mutation.
- Hyperdrive/managed-PostgreSQL provisioning.
- Real Queue/provider calls.
- Secrets.
- Customer/store data.
- Pricing/brand/public-site work.
- AKILTA canonical writes.

- **DEPENDENCIES:** RB-08 PASS; RB-09 transfer/readback PASS; repository engineer/reviewer access
  verified; AC-BUILD-001 approval if Brain classifies any step as the first real product/source-code
  implementation transition rather than pure bootstrap preparation.
- **RISK CLASS:** HIGH — runtime/toolchain evidence can expose dependency, CI and environment defects,
  but external production effects are forbidden.

#### Selected execution / review path (D-067 condition 7 / D-086)

Per D-086, canonical roles are capability roles and "no task receives automatic dual-model review";
Second Engineer provides "selective independent review... when applicable," not a mandatory second
identity on every task. The path selected for this task is:

- **Implementer (First Engineer) = Claude.** Access verified: live branch/commit/push/PR evidence exists
  across RB-08, RB-09 and this exec-plan (PR #5).
- **Verifier = AI Commerce Brain**, via the D-086 QA Verification Bundle fallback transport when Brain
  lacks direct private-repository access. This transport is not hypothetical — it is the same mechanism
  already used and accepted for RB-09 verification.
- **Second Engineer (Codex) = optional/selective backup reviewer, not currently assigned.** Its
  independent GitHub read/review path is `NOT_VERIFIED`; per D-086 this is non-blocking unless/until it
  is explicitly assigned to this task or a risk/defect signal triggers selective review.
  `SECOND_ENGINEER_BACKUP_PATH = NOT_VERIFIED / NON_BLOCKING_UNTIL_ASSIGNED`.

**Resolution:** the verbatim "repository engineer/reviewer access verified" dependency above is satisfied
by the selected path — it never required an independently-verified Second Engineer/reviewer identity as
a precondition; D-086 explicitly rules out automatic dual-model review, and D-067 condition 7 verifies
access "for the selected execution path," not for every capability role in the abstract. This was
reconciled at the Drive canonical layer (doc 21 GATES/PRECODE_REVIEW: ACB-07 = `PASS`, matching this
exact reasoning, with `SECOND_ENGINEER_BACKUP_PATH = NOT_VERIFIED / NON_BLOCKING_UNTIL_ASSIGNED` recorded
alongside it — not fabricated Codex access) before this document's status was updated below. Second
Engineer/Codex remains genuinely unassigned and unverified for this task; that fact is preserved, not
hidden — it is simply no longer a blocking pre-start dependency for the currently selected path.

### Acceptance criteria
Fresh canonical-repo install is deterministic; lockfile exists and direct dependency pins match current
authority; typecheck/lint/applicable existing unit/contract/security suites run with exact results; local
Worker smoke produces measured evidence or a precise fail-closed blocker; no secrets/PII; dependency/
license/security deltas recorded; no provider/runtime maturity is inflated beyond evidence.

### Tests required
Install/frozen-lockfile repeatability; strict TypeScript; lint; existing applicable unit/contract/security
suites; local Workers smoke; dependency/license/security checks supported by the activated CI/toolchain.

### QA context required
Transfer checksum/diff, base SHA, CI logs/check summaries, dependency delta, changed files, P0-024
acceptance mapping and any runtime limitation.

### Expected evidence
Repo/branch/base SHA; lockfile hash; CI/check results; local runtime smoke result; dependency/license/
security output; exact unresolved remote DB/Queue/provider gaps.

### Definition of Done
Task is Done only when: every acceptance-criteria item above is satisfied with produced evidence: every
required test category has an exact pass/fail result recorded (no silent skip); the expected-evidence
list is fully populated with real artifacts (not asserted prose); every touched D-090 invariant below has
its required Reality-Gate evidence or an explicit `NOT_APPLICABLE`/`DEFERRED-BY-ACTIVATION` justification;
and engineer output is recorded as one of `IMPLEMENTED`, `BLOCKED`, or `ESCALATION_REQUIRED` — never
`VERIFIED` or `COMPLETED` (that state requires separate Brain/Second-Engineer verification authority).

- **EXPECTED ENGINEER OUTPUT:** `IMPLEMENTED`, `BLOCKED` or `ESCALATION_REQUIRED` only; never
  `VERIFIED`/`COMPLETED`.
- **NEXT AUTHORITY:** AI Commerce Brain / Verifier.
- **ASSIGNED CAPABILITY ROLE:** First Engineer; Second Engineer for selective independent review if
  risk/defect signals require it.
- **CURRENT OPERATIONAL WORKER:** Claude (preferred First Engineer); Codex (preferred Second Engineer);
  mapping remains replaceable under D-086 — capability role is authoritative, not vendor name.
- **BRANCH / WORKTREE:** `eng/p0-024a-runtime-baseline`, branched from RB-09 transfer head
  `831abb78004b8beb417a99725c9ec13ab753cbc6` (not from `main`) so the staged source this task installs,
  typechecks and tests is the actual RB-09-transferred code.
- **BASE SHA:** `831abb78004b8beb417a99725c9ec13ab753cbc6` — RB-09 transfer head; PR #4 remains
  draft/unmerged and this binding does not authorize merge.
- **STATUS:** `IN_PROGRESS` — AC-BUILD-001 consumed (owner-approved 2026-08-17T11:01+03:00), work
  dispatched onto `eng/p0-024a-runtime-baseline`. See the D-086 QA Verification Bundle delivered alongside
  this update for exact checkpoint evidence. Engineer output ceiling remains `IMPLEMENTED` /
  `BLOCKED` / `ESCALATION_REQUIRED` — never `VERIFIED`/`COMPLETED`.

## D-090 Engineering Invariants — Applicability for this task

Root `AGENTS.md` mandatory invariant summary (I1–I7), per D-090:

1. **I1** — Persist committed Action Intent before external effect; durable outbox/inbox-equivalent
   atomic boundary where DB/queue/provider split exists.
2. **I2** — Idempotency identity must include MerchantWorkspace + exact integration/provider account +
   canonical operation + logical action scope.
3. **I3** — Revalidate current permission/approval/entitlement/capability-evidence/ProcessingPolicy/
   integration/freshness/kill-switch immediately before queued/retried external effect.
4. **I4** — Tenant/workspace/integration isolation is structural and fail-closed; unscoped
   repository/data access is prohibited.
5. **I5** — Metered/bulk work reserves quota/cost atomically before fan-out; bounded
   concurrency/provider backpressure/tenant fairness.
6. **I6** — AKILTA and AI Commerce do not share domain/DB/credential authority; cross-project calls use
   authenticated anti-replay versioned contracts and AI Commerce re-authorizes commerce actions.
7. **I7** — Candidate/Observation/Evaluation/Superseded/Revoked/unapproved learning is mechanically
   excluded from ACTIVE merchant truth/rule retrieval; promotion/training/data-use eligibility remain
   separate.

Applicable violation = build failure / mandatory review reject. Types/comments/framework behavior alone
are not evidence.

### Repository-governance projection

**IN_SCOPE** at RB-08 — required evidence is live repository readback showing the three repository
engineering surfaces (`AGENTS.md`, `docs/engineering/IMPLEMENTATION_RULES.md`,
`docs/engineering/ACCEPTANCE_CRITERIA.md`) plus task-record schema and CI/test navigation.

### Per-invariant applicability to the P0-024A toolchain-only diff

| Invariant | Applicability to P0-024A diff | Reason | Expected evidence |
|---|---|---|---|
| I1 / RG-OUTBOX | `NOT_APPLICABLE` (unless a transferred correction touches this boundary) | P0-024A is toolchain/runtime-evidence scope only; it performs no merchant/provider external effect. | None required for this task's own diff. Existing staged-code I1 debt is tracked separately below — `IN_SCOPE NOW`, not opened as a new WIP lane by this task. |
| I2 / RG-DUP | `NOT_APPLICABLE` (unless a transferred correction touches this boundary) | No idempotency-identity code is authored or modified by pure toolchain/CI/lockfile work. | Same as I1 — existing staged-code debt tracked separately, `IN_SCOPE NOW`. |
| I3 / RG-AUTH-RACE | `NOT_APPLICABLE` (unless a transferred correction touches this boundary) | No permission/approval/entitlement revalidation path is touched by toolchain setup. | Existing staged-code debt tracked separately, `IN_SCOPE NOW`. |
| I4 / RG-SCOPE | `NOT_APPLICABLE` (unless a transferred correction touches this boundary) | No tenant/workspace/integration isolation code is touched by toolchain setup. | Existing staged-code debt tracked separately, `IN_SCOPE NOW`. |
| I5 / RG-QUOTA | `NOT_APPLICABLE` (unless a transferred correction touches this boundary) | No metered/bulk/fan-out code is touched by toolchain setup. | Existing staged-code debt tracked separately, `IN_SCOPE NOW`. |
| I6 / cross-project boundary | `IN_SCOPE` — binding now at the general-invariant level | AKILTA/AI Commerce isolation is a structural project-boundary rule, not conditional on this diff touching transport code. | `DEFERRED-BY-ACTIVATION` specifically for the **RG-AKILTA-CONTRACT executable transport test** — that evidence is only required once a real AKILTA↔AI Commerce transport implementation task exists. No such task exists yet. |
| I7 / RG-LEARNING | `NOT_APPLICABLE` (unless a transferred correction touches this boundary) | No learning-candidate/retrieval-eligibility code is touched by toolchain setup. | Existing staged-code debt tracked separately, `IN_SCOPE NOW`. |

### Existing staged-code invariant debt (independent of P0-024A, not created or closed by it)

Per D-090/G-ENG-REALITY-090 current state (`I1 MISSING; I2 PARTIAL; I3 PARTIAL; I4 PARTIAL; I5 MISSING;
I6 PARTIAL; I7 PARTIAL`), the RB-09-transferred staged source already carries I1/RG-OUTBOX, I2/RG-DUP,
I3/RG-AUTH-RACE, I4/RG-SCOPE, I5/RG-QUOTA and I7/RG-LEARNING debt on its own affected source/test
boundaries. This debt is `IN_SCOPE NOW` and must be absorbed by the next normal verification/change that
actually touches those boundaries — it is explicitly **not** P0-024A's responsibility to open as a new
WIP lane, and P0-024A gets no invariant PASS credit merely by being packaged or by RB-09 transfer parity.

### Governing rule for defects discovered during future execution

If bootstrap/transfer reveals that current staged code can no longer compile or execute the D-090-mapped
tests, P0-024A execution (when it eventually runs) may perform only minimal task-authorized corrections
or return `ESCALATION_REQUIRED`; it may not hide the defect or mark an invariant satisfied without
evidence.

## Current readiness state (ACB-01..08) at this update

Per Drive canonical doc 21 GATES/PRECODE_REVIEW (reconciled under AC-GOV-096-RB14-SELECTED-PATH,
independently re-verified against primary source, not accepted on assertion alone): ACB-01/02/03/05/06/07
read `PASS`; ACB-08 reads `PASS_VISIBLE`. ACB-04 was blocked only on this repository task's status field,
which this update sets to `READY`. This document does not itself declare ACB-04 `PASS` or emit the
`⚠️ OWNER ACTION REQUIRED` alert — per D-086, that verdict belongs to Brain's final RB-14 verification
pass reading this updated task status back from the repository. AC-BUILD-001 remains `ARMED_NOT_READY`
until that verification completes and, separately, until explicit owner `APPROVE AC-BUILD-001` is
recorded. This update does not execute P0-024A and does not merge any PR.
