# AI Commerce — GitHub PR Workflow Adoption + Open-PR Checkpoint — 2026-08-26

Responds to the Founder instruction to (1) adopt the branch/PR lifecycle as this
repository's engineering default and reconcile it with repo-local operating rules/task
records, and (2) reconcile live repo/PR state before any new task. Leaves a checkpoint
for independent Brain review; nothing here is merged or self-declared complete.

## 1 — Workflow adopted

`docs/engineering/GIT_WORKFLOW.md` (new) + `AGENTS.md` cross-link, in PR #10. See that
PR/doc for the full lifecycle. Summary: no direct push to `main`; one branch per
bounded/coherent implementation; Draft until implemented, Ready for Review once
tested+validated; independent Brain review/approval required before merge; engineers
never self-approve; defects fixed on the same branch/PR; post-merge validation before
`COMPLETED`.

## 2 — Declined out-of-scope instruction (explicit flag, not silent)

The same instruction asked to "fresh-read current canonical R19 + HANDOFF_HEAD_REV 4 and
continue from the V2-APP-001 → V2-CDO-006 / 33f95a3 checkpoint." Fresh Drive read
confirms these are **AKILTA-core / AJANS project records**, not AI Commerce:

- `AKILTA — V2 Near-Horizon Commercial, Pricing & Claim Readiness — R19` and
  `AKILTA — V2 Client Portal Production Activation Readiness Gate — R19`.
- `V2-APP-001 — CURRENT Continuous-Train Head — Minimum Logged-in Application Shell...`
  and `V2-CDO-006 — PREAUTHORIZED Conditional Continuation — Minimum Logged-in Client
  Portal UI Slice`.
- `02 — AKILTA Current Project State` and `01 — AJANS Master Execution Contract` live
  under a materially different Drive parent folder than the AI Commerce workspace.

Per `AGENTS.md`'s AKILTA-boundary invariant (D-090 #6) and `CLAUDE.md`'s explicit project
isolation rule ("This repository belongs exclusively to the AI Commerce / AKILTA
Commerce project... must not be used as a shared or merged engineering workspace" with
AKILTA core), this is **not in-scope work for this repository/session**. It was declined
rather than attempted, guessed, or silently dropped. `AGENTS.md` was updated (in PR #10)
to record this exact conflict type explicitly for future sessions. If this AKILTA-core
task genuinely needs engineering action, it requires a separate session with the correct
AKILTA-core repository attached — not this one.

The CR-E1/CR-E2/CR-E3 evidence-closure work referenced in the same instruction belongs to
that same out-of-scope AKILTA-core task chain and was not touched for the same reason.

## 3 — Live repo / open-PR reconciliation (fresh, this checkpoint)

Branch: currently on `docs/git-workflow-policy` @ `8a7f50e13ac0617362f9a6d851f19b479c84abfa`
(clean, pushed). All open PRs on `Jay-prodesign/Akilta-commerce`, fresh-read via the
GitHub API:

| PR | Head → Base | Head SHA | Draft | Depends on |
|---|---|---|---|---|
| #4 | `eng/rb-09-staged-transfer` → `main` | `831abb7` | Draft | — |
| #5 | `eng/ac-eng-task-001-exec-plan` → `main` | `cc07a47` | Draft | — |
| #6 | `eng/p0-024a-runtime-baseline` → `eng/rb-09-staged-transfer` | `dded3dc` | Draft | #4 |
| #7 | `eng/p0-026-job-run-safety-invariants` → `eng/p0-024a-runtime-baseline` | `0969728` | Ready | #6, #4 |
| #8 | `feat/control-center-route-matcher` → `eng/p0-026-job-run-safety-invariants` | `f1d448c` | Ready | #7 |
| #9 | `feat/control-center-operation-path` → `eng/p0-026-job-run-safety-invariants` | `2edadfe` | Ready | #7 |
| #10 | `docs/git-workflow-policy` → `eng/p0-026-job-run-safety-invariants` | `8a7f50e` | Ready | #7 |

(#1 is an unrelated Dependabot PR, not part of this chain.)

None of #4/#5/#6 were opened or modified this session; they are historical, from the
P0-024A lint-architecture-escalation period, and remain exactly as Brain last left them
(`ESCALATION_REQUIRED_LINT_ARCHITECTURE` per doc 25's status overlay). #7/#8/#9/#10 were
opened this session per the new workflow — #7 as a retroactive consolidation of prior
direct-pushed work, #8/#9/#10 as new bounded-implementation PRs.

## 4 — Checks / validation evidence

Each of #7, #8, #9, #10 carries its own fresh validation table in its PR description
(main + staging typecheck, lint, dependency-free staging suite, vitest, `pnpm audit`,
and for #7/#8 a real `vite build`). No repository CI workflow currently reports status
checks on any of these PRs (`get_status` for #8 returned 0 statuses) — local validation
evidence in each PR body is what exists right now; this is itself a known gap, not a
concealed one.

## 5 — Known blockers / risks

- **Stacking order**: #7 depends on #6 and #4; #8/#9/#10 depend on #7. None may merge
  before its dependency, in that order.
- **#4/#5/#6 are stale, unresolved escalations** from mid-August
  (`ESCALATION_REQUIRED_LINT_ARCHITECTURE`, 31 lint errors at that time, per doc 25's
  overlay) that predate all of #7/#8/#9/#10's actual content. Brain/Founder should
  confirm whether #4/#5/#6 are still expected to merge as-is, need rework, or should be
  superseded — this is a real open question, not resolved by this checkpoint.
- **No CI**: no GitHub Actions status is attached to any of these PRs. All evidence is
  local-run and self-reported by this engineer pending independent Brain verification.
- **Shopify/Meta gates unchanged**: none of #7/#8/#9/#10 touch or claim to resolve
  `SHOPIFY_TARGET_CONTEXT_ACCESS_GATE` or Meta `BLOCKED_BY_PROVIDER_ACCESS`.

## 6 — Merge readiness

**Not merged. Not ready to merge.** Per the newly-adopted workflow, none of #7/#8/#9/#10
may merge before independent Brain review + PASS, and not before #6/#4 merge first given
the stacking. This record is the consolidated checkpoint for that review; per the
Founder's explicit instruction, no new source task (`V2-CDO-007`/`V2-CDO-008` — also
confirmed AKILTA-core, out of scope here regardless) is started before that PASS lands.

## Status

`IMPLEMENTED` (workflow doc + this reconciliation record; ceiling per `AGENTS.md` —
`VERIFIED`/`COMPLETED` require Brain). Awaiting independent Brain review of #7, #8, #9,
#10 and a decision on #4/#5/#6.
