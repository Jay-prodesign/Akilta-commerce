# AC-REPO-RECON-001 — Repo-Native Admission Plan

## Task identity and authority

Bounded task materialized per the canonical checkpoint (as relayed to this session)
titled `AC-REPO-RECON-001 BRAIN CHECKPOINT — 2026-09-23`:

> "Claude must materialize AC-REPO-RECON-001 as a repo-native admission plan against
> `main@8dd7343`, classifying source/commits KEEP / ADAPT / SUPERSEDE / DROP, preserving
> tests/evidence provenance and dependency order, and proposing smallest coherent
> admission slices. No feature coding, merge, PR close, provider/store action or D-106
> maturity promotion is authorized by this checkpoint."

**This document is planning/analysis output only.** No PR was merged or closed, no
branch was created or modified other than this file, and no provider/store action was
taken while producing it. State ceiling for this artifact: `IMPLEMENTED` (delivered
analysis), not `VERIFIED`/`COMPLETED` — the classification below is Claude's
recommendation; admission itself requires separate, explicit merge decisions.

## Evidence basis and its limits

Verified directly (not from a prior chat claim) as part of producing this plan:

- `main` current head: `8dd7343255c2ab037771d33f1f2c04ddbb84407f` — confirmed via
  `git fetch origin main` + `git log`. Contains repo bootstrap/governance
  (RB-08) and `AC-TEST-GAP-001` (PR #20, merged directly to `main`). No Meta-WhatsApp,
  Shopify connector, Control Center, or job/outbox invariant code exists on `main`.
- PRs #19, #21, #22, #23, #24, #25 (the Meta-WhatsApp Lane-A chain): individually
  re-verified via `pull_request_read(method=get)` per PR. **All six report
  `"merged": true`** with real `merged_at` timestamps and `merged_by`. This corrects the
  stale/unpopulated `merged` field seen on the same PRs in a bulk `list_pull_requests`
  response earlier in this task — the bulk-list field is not reliable for this repo's
  history and individual reads should be preferred for any merge-status-sensitive
  decision.
- The Meta-WhatsApp connector source itself (`connectors/meta-whatsapp/src/{port,dispatch,conversation-projection,fixtures,index}.ts` and their three contract specs) was
  read directly from the working tree on the current branch — not inferred from PR
  bodies.
- Full current PR/branch topology (`list_pull_requests(state=open)`, `list_branches`).

**Not yet diff-verified** (title/PR-body level only — flagged explicitly below wherever
it affects a classification call): PRs #4, #5, #6, #8, #9, #10, #11, #12, #13, #14, #15,
#16, #17, #18. Recommend a diff-level pass on any PR marked `ADAPT — needs diff review`
before it is actually admitted.

## Repo topology (open, unmerged-to-main)

```
main (8dd7343) — bootstrap/governance + AC-TEST-GAP-001 (#20)
│
├─ #1  dependabot/github_actions/actions/checkout-7        base: main
├─ #5  eng/ac-eng-task-001-exec-plan                        base: main
├─ #17 docs/rb05-stop-saturated-20260827                    base: main
├─ #18 chore/gitignore-staging-build                        base: main
│
└─ #4  eng/rb-09-staged-transfer                             base: main
    └─ #6  eng/p0-024a-runtime-baseline                      base: #4
        └─ #7  eng/p0-026-job-run-safety-invariants          base: #6
             (de facto integration branch — already contains the merged
              Meta-WhatsApp Lane-A chain: PR #19, #21, #22, #23, #24, #25)
            │
            ├─ #8  feat/control-center-route-matcher         base: #7
            ├─ #9  feat/control-center-operation-path         base: #7
            ├─ #10 docs/git-workflow-policy                   base: #7
            ├─ #11 feat/shopify-graphql-queries               base: #7
            │   └─ #13 feat/shopify-order-response-parser     base: #11
            ├─ #12 feat/shopify-product-response-parser       base: #7
            ├─ #14 docs/rb05-reconcile-20260827                base: #7
            ├─ #15 docs/acceptance-criteria-f1-f2-f3-backfill  base: #7
            └─ #16 fix/merchant-rule-latest-version-selection  base: #7
```

`main` is not the product baseline; the stack is diverged and pre-dates D-106. Neither
"main is the product" nor "merge the whole stack" is a valid admission strategy — the
classification below is deliberately per-slice.

## Classification

| # | Branch / PR | Class | Rationale |
|---|---|---|---|
| #4 | `eng/rb-09-staged-transfer` | **KEEP** | Root config + `packages/domain` transfer. Structural dependency for every downstream branch in the stack (Meta-WhatsApp connector, Shopify connector, and job/outbox invariants all import from `packages/domain`). Must be admitted first, in order. |
| #6 | `eng/p0-024a-runtime-baseline` | **KEEP** | Toolchain/runtime evidence baseline; #7 is based on it and depends on it structurally. No content reason to skip. |
| #7 | `eng/p0-026-job-run-safety-invariants` | **KEEP** | Job/Run + outbox idempotency invariants (`packages/events`) that the Meta-WhatsApp dispatch chain directly composes on (`stageJobWithOutbox`, `deliverOutboxRecord`), confirmed by direct read of `connectors/meta-whatsapp/src/dispatch.ts` logic described in PR #21. This is the load-bearing integration branch; admitting it also admits the already-merged, already-tested Meta-WhatsApp Lane-A chain as a unit (see below). |
| #19/#21/#22/#23/#24/#25 | Meta-WhatsApp Lane-A (port/mock, outbox dispatch, wiring-guard doc, propagation, conversation-projection, equal-timestamp test) | **KEEP, not separately gated** | Already merged into #7; travels with it. Provider-neutral (Lane A, D-103), mock-backed, no live Meta access required. D-106 changes WhatsApp from mandatory/primary to *optional* — it does not retire it. This is reusable domain logic (port interface, dispatch composition, conversation projection) independent of channel priority, so it is admitted as part of #7 with no rework required. It is, however, **not** on the critical path for the first D-106 closure slice — see "Next-slice note" below. |
| #16 | `fix/merchant-rule-latest-version-selection` | **KEEP — prioritize** | Title indicates a real correctness fix plus activation of 4 previously-silently-inert security/contract tests, not a docs/process record. Improves baseline integrity independent of D-106. Not diff-verified in this pass; recommend it be one of the first slices admitted after #7 given the "silently-inert test" framing is exactly the kind of latent-gap risk this repo's evidence discipline treats seriously. |
| #10, #14, #15 | `docs/git-workflow-policy`, `docs/rb05-reconcile-20260827`, `docs/acceptance-criteria-f1-f2-f3-backfill` | **KEEP** | Process/evidence-record PRs on #7. Append-only value, no code risk, no dependency conflict. Admit whenever convenient after #7. |
| #11, #13 | `feat/shopify-graphql-queries` → `feat/shopify-order-response-parser` | **KEEP** | Schema-validated GraphQL query documents + order-response parser. Titles indicate this is connector-layer groundwork (query shape + parsing), not a live-credential dependency. Directly serves the D-106 dependency-chain milestone "P0-027 read-only Shopify proof" once credential binding lands. Not diff-verified; recommend confirming no live-store assumption was baked in before treating as fully credential-independent. |
| #12 | `feat/shopify-product-response-parser` | **KEEP** | Same rationale as #11/#13; "wires field mappings together" per title — likely depends on #11's query documents at the content level even though its Git base is #7 directly. Recommend admitting after #11/#13 regardless of literal branch base, to avoid re-deriving field mappings against a query surface that may still change. |
| #8, #9 | `feat/control-center-route-matcher`, `feat/control-center-operation-path` | **ADAPT — needs diff review** | D-106 explicitly adds Control-Center scope (Page Assistant/distribution/billing/entitlement), but D-106 is at `DECIDED` maturity, not yet `SPECIFIED`, for that scope. These two PRs pre-date D-106 and may embed assumptions (e.g. which surfaces the router/operation-path need to support) that D-106's eventual Control-Center spec could change. Not a DROP — router shell and operation-path builder are generically useful scaffolding — but hold admission until D-106's Control-Center scope reaches `SPECIFIED`, then diff-review for fit rather than merging blind. |
| #5 | `eng/ac-eng-task-001-exec-plan` | **KEEP** | RB-14 exec-plan packaging only, base `main`, no stack dependency, no code risk. |
| #17 | `docs/rb05-stop-saturated-20260827` | **KEEP** | Process record, base `main`, independent. |
| #18 | `chore/gitignore-staging-build` | **KEEP** | Trivial, no dependency, no risk. |
| #1 | `dependabot/github_actions/actions/checkout-7` | **KEEP** | Routine dependency bump, standard triage, independent of the stack. |

No branch in the current topology is classified **SUPERSEDE** or **DROP** — everything
open is either structurally required, low-risk process record, or credible groundwork
that D-106 deprioritized rather than invalidated. The one live tension (#8/#9 vs.
D-106's not-yet-specified Control-Center scope) is handled as ADAPT rather than DROP
because the existing shell/operation-path work is generic enough to likely survive a
spec, not because it is definitely reusable as-is.

## Proposed smallest coherent admission slices, in dependency order

1. **Foundation spine (mandatory, strict order):** #4 → #6 → #7. Nothing else in the
   stack can be admitted to `main` without this; it also brings in the already-merged,
   already-tested Meta-WhatsApp Lane-A chain as a side effect.
2. **Independent, no-dependency, low-risk (can interleave anytime, any order):** #1,
   #5, #17, #18.
3. **Correctness fix (prioritize right after the spine):** #16.
4. **Process/evidence docs riding on #7:** #10, #14, #15.
5. **Shopify connector groundwork (critical path for D-106's P0-027 milestone):** #11 →
   #13, then #12.
6. **Control Center (hold):** #8, #9 — do not admit until D-106's Control-Center scope
   reaches `SPECIFIED`; diff-review at that point.

## Next-slice note for Brain's selection

D-106 makes Website AI Chat the primary native surface and WhatsApp optional. **No
branch or PR in the current topology implements a Website Chat surface** — this is a
genuine gap, not something this admission plan can classify, since it doesn't exist yet
as source. Per the D-106 dependency chain already on record (foundation contracts/state
machines/security → provider-neutral Website Chat golden slice → P0-027 read-only
Shopify proof → grounded proof → optional WhatsApp), the Meta-WhatsApp chain admitted in
slice 1 is *not* the next implementation target even though it is fully merged and
tested — it is prior-priority work correctly preserved, not the D-106 critical path
going forward.

This plan makes no selection itself — per the checkpoint's own text, "Brain then
selects the first D-106 implementation closure slice from returned evidence."
