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

## One-time coding-start gate

Per D-067/AC-BUILD-001: this task remains `PREPARED_NOT_READY` / `STATUS: PREPARED_NOT_READY` and must
not enter `IN_PROGRESS` before (a) all of ACB-01..ACB-08 read PASS, and (b) an explicit owner
`APPROVE AC-BUILD-001` decision is recorded. Repository/bootstrap/task-packaging preparation — including
this document — does not itself consume or satisfy AC-BUILD-001.

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

This clarification narrows the verbatim "repository engineer/reviewer access verified" dependency above
to the actually-selected path; it does not remove or weaken it, and it does not assert that the
dependency is satisfied. **Open item:** doc 21's live GATES/PRECODE_REVIEW tab still records ACB-07 as
`PARTIAL_FIRST_ENGINEER_VERIFIED` with Second Engineer/reviewer path stated as independently unverified.
That is a specific, currently-live canonical record authored with D-086 already in view; this document
does not override it. If Brain adopts the selected-path reading above as sufficient, doc 21's ACB-07 row
needs an explicit Drive-side update to reflect that — this exec-plan alone does not constitute that
update.

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
- **BRANCH / WORKTREE:** to be created only after this task reaches READY and AC-BUILD-001 is approved;
  proposed short-lived branch `eng/p0-024a-runtime-baseline`.
- **BASE SHA:** `831abb78004b8beb417a99725c9ec13ab753cbc6` — RB-09 transfer head; PR #4 remains
  draft/unmerged and this binding does not authorize implementation or merge.
- **STATUS:** `PREPARED_NOT_READY` — must not enter `IN_PROGRESS` before live repository/bootstrap/
  readback and the applicable AC-BUILD-001 gate decision.

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

## Current readiness state (ACB-01..08) at materialization time

See the RB-14 AC_BUILD Readiness Bundle delivered alongside this document for the authoritative row-by-row
PASS/NOT_PASS mapping. Summary, re-verified directly against D-067/D-086 primary text: ACB-01/02/03 PASS;
ACB-05 PASS (durable exec-plan path/base-head binding + D-090 applicability mapping now exist in this
document, which was doc 21's own stated remediation criterion for this row — reviewer access is a
separate ACB-07 concern and is not propagated here); ACB-06 PASS (D-067 condition 6 requires expectations
to be *defined*, not executed — this document defines them; live CI execution is P0-024A
implementation/merge-admission scope, not a pre-coding-start requirement). ACB-04 and ACB-07 remain open:
the task's own DEPENDENCIES field requires "repository engineer/reviewer access verified," and while the
selected-path reading above (Implementer=Claude verified, Verifier=Brain via proven QA Verification
Bundle fallback, Second Engineer=optional/unassigned) is well-supported by D-067/D-086 primary text, doc
21's live GATES/PRECODE_REVIEW tab still records ACB-07 as `PARTIAL_FIRST_ENGINEER_VERIFIED` with an
independently-unverified Second Engineer/reviewer path as the stated reason. That is a specific,
currently-live canonical record this document does not unilaterally override; it requires an explicit
Drive-side reconciliation by Brain, not just a repository-side document, before ACB-04/07 can read PASS.
AC-BUILD-001 remains `ARMED_NOT_READY`.
