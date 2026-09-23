# AC-REPO-RECON-001 — Repo-Native Admission Plan (v2 — corrected)

## Revision note

v1 of this artifact (commit `661da61c8f492ca1d9f55e70b35f49189e304dc4`, exact-head CI run
`35895122756` = SUCCESS) received Brain review `BRAIN REVIEW — AC-REPO-RECON-001 —
CHANGES_REQUIRED` (doc 25, superseding the earlier PASS/VERIFIED for that head). Five
corrections were required; this revision applies all five in the same task/PR/branch. A
finding-to-change map is at the bottom of this document.

## Task identity and authority

Governed by `AC-REPO-RECON-001 — FINAL CLAUDE EXECUTION CONTRACT` (doc 25). Authorized
mutation for this task: create/update one task branch and one artifact
(`docs/exec-plans/active/AC-REPO-RECON-001-admission-plan.md`), and open/update one PR
containing only that artifact. **Not authorized**: feature coding, historical PR
merge/close/rebase, product/dependency/migration/test-runner/README/CLAUDE/AGENTS
mutation, provider/store/production action, or D-106/D-107 maturity promotion. State
ceiling: `IMPLEMENTED / AWAITING BRAIN REVIEW` — never `VERIFIED`/`COMPLETED` (self-declared).

## Fresh-read baseline for this revision

- `main` re-verified via `git fetch origin main`: still `8dd7343255c2ab037771d33f1f2c04ddbb84407f`, unchanged since v1.
- Task branch/PR unchanged before this revision: `claude/github-branch-protection-access-o1g5m7`, PR #26, prior head `661da61c8f492ca1d9f55e70b35f49189e304dc4`.
- All 15 relevant branches (`eng/rb-09-staged-transfer`, `eng/p0-024a-runtime-baseline`,
  `eng/p0-026-job-run-safety-invariants`, and the twelve branches for PRs #5/#8–#18) were
  re-fetched fresh from `origin` for this revision. No PR in #4–#18 has merged, closed, or
  changed base since v1.
- **Method change from v1**: v1's PR classifications were built from PR titles/bodies
  (explicitly flagged as a limitation in v1). This revision replaces every classification
  with a direct `git diff`/`git merge-base` read against the actual branch content —
  titles and bodies are no longer treated as evidence of file-level content.

## The six outcomes (verbatim from the FINAL CLAUDE EXECUTION CONTRACT)

Every PR #4–#18 below gets exactly one of: `ADMIT_BY_SLICE`, `REBASE_AND_ADAPT`,
`KEEP_AS_EVIDENCE`, `SUPERSEDED_CLOSE_CANDIDATE`, `FOLD_INTO_ADMISSION`,
`STILL_REQUIRED_DEPENDENCY`. This replaces v1's informal KEEP/ADAPT/SUPERSEDE/DROP scheme
per finding #1.

## Admission slice model (A0–A6, verbatim from the contract)

- **A1** — foundation/toolchain/domain/authz/commerce/AI + necessary migrations/tests, excluding stale current-looking product/release authority.
- **A2** — Job/Run/outbox/quota/recovery/observability safety.
- **A3** — merchant-rule latest-version correction + activation of silently inert contract/security tests.
- **A4** — Shopify read primitives and normalized response handling.
- **A5** — Control Center runtime/router/path mechanics, adapted later to D-106 IA.
- **A6** — Meta provider-neutral adapter mechanics, retained as optional channel capability.
- **A0** — repository operational-projection remediation (README.md/CLAUDE.md stale pre-D-106 wording) — separately prepared as `AC-REPO-PROJECTION-106`, explicitly **not** part of this task's mutations.

Per finding #1: A1 and A6 do **not** travel together as a side effect of admitting #7.
Each slice is admitted independently; #7's Meta-WhatsApp content (already merged inside
it as PR #19/21/22/23/24/25) is provenance-tagged as A6 and stays a separate, non-automatic
admission decision even though it physically lives inside the #7 diff.

## Foundation spine — diff/source-verified (finding #2, first slice)

Direct `git diff --stat`/`--dirstat` against fetched branches (not PR-API title/body):

**PR #4 `eng/rb-09-staged-transfer`** (base `main`) — 179 files, +18,881/−98 lines.
Real content confirmed present: `packages/domain/src` (10.6%), `packages/authz/src`
(5.5%), `packages/commerce-contract/src` (3.9%), `packages/ai-gateway/src` (3.3%),
`packages/events/src` (4.4%), `packages/merchant-rules/src` (1.1%),
`packages/truth-policy/src` (1.1%), `apps/api/src` (4.4%), `apps/control-center/src`
(3.3%), stub connectors `connectors/{ideasoft,ikas,ticimax,tsoft,meta-whatsapp}` (2.6%
combined — evidence-gated stubs only, no live provider assumptions), `migrations/`
(1.6%), `release/` (15.6%), `scripts/` (1.1%), and test suites under `tests/contract/`
(18.9%) and `tests/security/` (11.1%). This is materially broader than A1's own
definition (it also carries apps/api, apps/control-center and connector stubs) —
recorded honestly rather than force-fit; see disposition table.
**Classification: `ADMIT_BY_SLICE` (A1, broadened — see note in table).**

**PR #6 `eng/p0-024a-runtime-baseline`** (base #4) — 47 files, +3,824/−182 lines.
Confirmed: `.github/workflows/` CI pipeline (install → typecheck → typecheck:staging →
lint → test → test:vitest → test:worker → audit → license scan, replacing the RB-08
placeholder), dependency pin bump (`hono` 4.12.32→4.12.34), `pnpm-lock.yaml` (+3,194
lines, first real lockfile), branded-primitive narrowing hardening across
`packages/{domain,authz,commerce-contract,ai-gateway,events}/src`, and a new
`tests/contract/branded-primitive-narrowing.spec.ts` (156 lines). **Classification:
`ADMIT_BY_SLICE` (A1 — toolchain/CI/dependency-pin layer of the same slice as #4).**

**PR #7 `eng/p0-026-job-run-safety-invariants`** (base #6) — 62 files, +4,213/−227 lines.
Confirmed: `tests/security/dispatch-safety.spec.ts` (203 lines, new), Job/Run
worker-runtime smoke test, `packages/events/src` (9.6%), plus first admission of
`connectors/shopify/src` (3.2%) and `apps/control-center/` (9.6% combined) as
dependencies, and (via the six already-merged child PRs #19/21/22/23/24/25 living
inside this branch) the full Meta-WhatsApp Lane-A source. **Classification:
`ADMIT_BY_SLICE` (A2, primary) — the Meta-WhatsApp content inside it is separately
tagged `A6` per the no-automatic-admission correction above; it is provenance-preserved
but not implied-admitted merely because #7 is.**

## Required PR disposition table — all of #4–#18, diff-verified

| PR | Branch | Merge-base w/ #7 tip | Own-commit content (exact paths) | Outcome | Slice | Notes |
|---|---|---|---|---|---|---|
| #4 | `eng/rb-09-staged-transfer` | — (base `main`) | 179 files — see foundation spine above | `ADMIT_BY_SLICE` | A1 | First in dependency order; nothing else can be admitted before it. |
| #6 | `eng/p0-024a-runtime-baseline` | — (base #4) | 47 files — see foundation spine above | `ADMIT_BY_SLICE` | A1 | Depends on #4. |
| #7 | `eng/p0-026-job-run-safety-invariants` | — (base #6) | 62 files — see foundation spine above | `ADMIT_BY_SLICE` | A2 (+A6 carried, separately gated) | Depends on #4→#6. |
| #8 | `feat/control-center-route-matcher` | `0969728b` (stale — predates #19–#25 merge into #7) | `apps/control-center/src/App.tsx` (new), `route-matcher.ts` (new), `main.tsx` (mod), `FRONTEND_STAGING_STATUS.json` (mod), `tests/contract/control-center-route-matcher.spec.ts` (new) | `REBASE_AND_ADAPT` | A5 (HOLD) | Router mechanics reusable; must rebase onto current #7 tip (missing 6 later commits) **and** wait for D-106 Control-Center scope to reach `SPECIFIED` before IA fit review — two independent blockers, not one. |
| #9 | `feat/control-center-operation-path` | `0969728b` (stale, same as #8) | `apps/control-center/src/operation-path.ts` (new), `tests/contract/control-center-operation-path.spec.ts` (new) | `REBASE_AND_ADAPT` | A5 (HOLD) | Transport-contract path mechanics reusable; same two blockers as #8. |
| #10 | `docs/git-workflow-policy` | `0969728b` (stale) | `AGENTS.md` (mod), `docs/engineering/GIT_WORKFLOW.md` (new), `docs/exec-plans/active/AC-github-pr-workflow-adoption-20260826.md` (new) | `FOLD_INTO_ADMISSION` | A1 | Governance-relevant (touches AGENTS.md), not a pure record — fold into A1 rather than admit standalone, so the AGENTS.md edit is reviewed alongside the rest of the foundation diff, not in isolation. Needs rebase (stale base). |
| #11 | `feat/shopify-graphql-queries` | `0969728b` (stale) | `connectors/shopify/src/index.ts` (mod), `queries.ts` (new), `tests/contract/shopify-connector-queries.spec.ts` (new) | `REBASE_AND_ADAPT` | A4 | Needs rebase. Must be admitted **before** #12 and #13 — both touch `connectors/shopify/src/index.ts` / build on this file, real merge-order dependency, not just a suggestion. |
| #12 | `feat/shopify-product-response-parser` | `0969728b` (stale) | `connectors/shopify/src/index.ts` (mod), `parse-product-response.ts` (new), `tests/contract/shopify-connector-product-response-parser.spec.ts` (new) | `REBASE_AND_ADAPT` | A4 | **Also modifies `connectors/shopify/src/index.ts`, same file #11 modifies** — real conflict risk since #12's Git base is #7 directly, not #11. Must be re-based onto #11's result (not #7) before admission, despite what its recorded PR base says. |
| #13 | `feat/shopify-order-response-parser` | (base is #11, not #7) | `connectors/shopify/src/parse-order-response.ts` (new), `tests/contract/shopify-connector-order-response-parser.spec.ts` (new) — 3 files, +163 lines, diffed directly against #11 | `REBASE_AND_ADAPT` | A4 | Correctly stacked on #11 already. Admission order within A4: #11 → #13 → #12 (reconciled onto #13's result). |
| #14 | `docs/rb05-reconcile-20260827` | `0969728b` (stale) | `docs/exec-plans/active/AC-rb05-reconcile-checkpoint-20260827.md` (new) | `KEEP_AS_EVIDENCE` | — | Per Brain finding #3: historical/superseded checkpoint record, never active "admit whenever convenient" instruction. Preserve as evidence; do not treat its own contents as current authority. |
| #15 | `docs/acceptance-criteria-f1-f2-f3-backfill` | `0969728b` (stale) | `docs/engineering/ACCEPTANCE_CRITERIA.md` (mod) | `FOLD_INTO_ADMISSION` | A1 | Small, single-file backfill; fold into A1 rather than stand alone. Needs rebase. |
| #16 | `fix/merchant-rule-latest-version-selection` | `0969728b` (stale) | `packages/merchant-rules/src/rules.ts` (mod, the actual fix), `tests/contract/{commerce-contract,event-lineage}.spec.ts` (mod), `tests/security/{support-core,tenant-authz}.spec.ts` (mod) — 5 files | `ADMIT_BY_SLICE` | A3 | Real correctness bug (`resolveRuleGroup()` was selecting the oldest eligible rule version, not newest, in security-critical Merchant Rule resolution) plus activation of 4 previously-silently-passing (assert-nothing) test files. Needs rebase (trivial — 5 isolated files, no shared-path conflict with #8–#15). See AC-TEST-GAP-001 relationship below. |
| #17 | `docs/rb05-stop-saturated-20260827` | — (base `main`, stale — predates PR #20 merge) | `docs/exec-plans/active/AC-rb05-stop-saturated-20260827.md` (new); **also silently deletes `docs/exec-plans/active/AC-TEST-GAP-001-staging-runner-evidence-mismatch.md` relative to current `main`** (branch predates that file's merge) | `KEEP_AS_EVIDENCE` | — | Per Brain finding #3, same treatment as #14. **Unsafe to merge as-is**: must rebase onto current `main` first, or merging would delete the AC-TEST-GAP-001 record. |
| #18 | `chore/gitignore-staging-build` | — (base `main`, stale, same issue as #17) | `.gitignore` (mod, adds `.staging-build/`); same AC-TEST-GAP-001-deletion risk as #17 | `ADMIT_BY_SLICE` | A1 | Trivial, correct fix (this exact gap was independently hit and worked around by hand during this task — see Evidence basis). Needs rebase onto current `main` first for the same reason as #17. |
| #5 | `eng/ac-eng-task-001-exec-plan` | — (base `main`, stale, same issue as #17/#18) | `docs/exec-plans/active/AC-ENG-TASK-001-P0-024A.md` (new); same AC-TEST-GAP-001-deletion risk | `KEEP_AS_EVIDENCE` | — | Same rebase requirement as #17/#18 before it is safe to merge. |
| #1 | `dependabot/github_actions/actions/checkout-7` | — (base `main`) | `.github/workflows/*` version bump only | `ADMIT_BY_SLICE` | A1 (CI layer) | Routine, independent, admit any time after rebase-safety check against current `main`. |

## AC-TEST-GAP-001 ↔ PR #16 relationship (finding #4)

Read directly from `docs/exec-plans/active/AC-TEST-GAP-001-staging-runner-evidence-mismatch.md`
on `main` (merged via PR #20). **These are the same defect *class* but a different root
cause, in different files, with different fixes:**

- **PR #16's defect (already fixed there)**: `tests/security/support-core.spec.ts`,
  `tests/security/tenant-authz.spec.ts`, `tests/contract/commerce-contract.spec.ts`, and
  `tests/contract/event-lineage.spec.ts` **compiled and ran** (via
  `scripts/run-staging-tests.mjs`'s `.ts` auto-discovery) but had no assertion loop over
  their exported `..._SCENARIOS` arrays — they always exited 0 while checking nothing.
  PR #16 added the missing loops.
- **AC-TEST-GAP-001's defect (still unfixed, out of scope here)**: 12 `.mjs` files
  (`tests/contract/{commercial-ready-e6-review-template,design-partner-e5-admission-template,ikas-e2-admin-api-reference,ikas-normalized-mapping-gap,internal-dogfood-auth-perimeter-admission,meta-e3-acceptance-template,normalized-contract-cross-provider-pressure,owned-dogfood-e4-admission-template,provenance,provider-reference-profile,source-timestamp-schema,tsoft-normalized-mapping-gap}.spec.mjs`)
  are **never invoked at all** by the runner, because `.mjs` discovery is a
  hand-maintained 6-file allowlist that doesn't include them — not a no-op-assertion bug.
  AC-TEST-GAP-001's own record explicitly states its fix is **not** made there and
  remains a separate, not-yet-scheduled follow-up.
- **Sequencing implication**: AC-TEST-GAP-001 has no dependency on PR #16 or vice versa —
  they touch disjoint files. AC-TEST-GAP-001 should be sequenced **after** whichever slice
  admits `scripts/run-staging-tests.mjs`'s current form (i.e. after A1, since the runner
  script itself is foundation-layer), not bundled into A3 with PR #16. Not fixed in this
  task per the contract's explicit instruction.

## Per-slice detail: inputs, dependencies, excluded paths, verification, rollback

**A1 (PR #4 → #6, folding in #10/#15/#18/#1 governance/CI items)**
- Inputs: `packages/{domain,authz,commerce-contract,ai-gateway,events,merchant-rules,truth-policy}/src`, `apps/api/src`, `apps/control-center/src` (base scaffolding only — router/operation-path from #8/#9 excluded, see A5), evidence-gated connector stubs, `migrations/`, `scripts/`, `release/`, `.github/workflows/ci.yml`, `pnpm-lock.yaml`, `AGENTS.md` git-workflow addendum, `docs/engineering/{GIT_WORKFLOW.md,ACCEPTANCE_CRITERIA.md}`, `.gitignore` fix.
- Dependencies: none (first slice onto `main`); #6 depends on #4 internally.
- Excluded paths: `apps/control-center/src/{route-matcher,operation-path}.ts` (A5), `connectors/shopify/src/{queries,parse-*-response}.ts` (A4), `connectors/meta-whatsapp/src/{port,dispatch,conversation-projection}.ts` (A6), `packages/merchant-rules/src/rules.ts` fix (A3).
- Verification after admission: `pnpm install --frozen-lockfile && pnpm run typecheck && pnpm run typecheck:staging && pnpm run lint && pnpm run test && pnpm run test:vitest && pnpm run test:worker && pnpm audit` — this is the exact CI pipeline #6 itself introduces; should be exercised by CI on the admission PR before merge.
- Rollback/recovery: single squash-mergeable slice onto `main`; revert is one `git revert` of the merge commit, no other slice depends on partial A1 state (A2–A6 are not yet admitted at this point).

**A2 (PR #7, Meta-WhatsApp content excluded/re-tagged A6)**
- Inputs: `packages/events/src` Job/Run/outbox/quota extensions, `tests/security/dispatch-safety.spec.ts`, `tests/runtime/job-run-workerd-smoke.spec.ts`, Shopify/Control-Center stub scaffolding that #7 depends on structurally (not the A4/A5 feature content itself, just what #7 needs to typecheck).
- Dependencies: A1.
- Excluded paths: same A4/A5/A6 exclusions as A1, applied consistently.
- Verification: same pipeline as A1, plus `tests/security/dispatch-safety.spec.ts` and the worker-runtime smoke test specifically.
- Rollback: revert-mergeable; A3/A4/A5/A6 all depend on A2 being present, so a rollback here cascades — document that before triggering it.

**A3 (PR #16)**
- Inputs: `packages/merchant-rules/src/rules.ts`, 4 test files listed in the disposition table.
- Dependencies: A2 (branch is based on #7).
- Excluded paths: none — isolated fix, no shared files with A1/A2/A4/A5.
- Verification: `COMMERCE_CONTRACT_SCENARIOS` 8/8, `EVENT_LINEAGE_SCENARIOS` 8/8, `SUPPORT_CORE_SCENARIOS` 19/19, `AUTHZ_SECURITY_SCENARIOS` 8/8 (all named in PR #16's own validation table) — re-run after rebase, not reused from the PR's original run.
- Rollback: trivial, single isolated revert, no downstream dependents.

**A4 (PR #11 → #13 → #12, in that order)**
- Inputs: `connectors/shopify/src/{index,queries,parse-order-response,parse-product-response}.ts` and their 3 contract specs.
- Dependencies: A2; internal order #11 before #13 before #12 (see merge-conflict note in table).
- Excluded paths: none beyond the connector directory itself.
- Verification: the three named `tests/contract/shopify-connector-*.spec.ts` files; confirm no live-credential assumption by grep for hardcoded store domains/tokens before admission (not yet done — recorded as an unresolved limitation below).
- Rollback: revert #12 first if a post-admission defect is isolated to it, since it's the last-applied of the three.

**A5 (PR #8, #9 — HOLD, not proposed for near-term admission)**
- Inputs: `apps/control-center/src/{App.tsx,route-matcher,operation-path}.ts` and their specs.
- Dependencies: A2 (rebase target), plus a non-code dependency: D-106 Control-Center scope reaching `SPECIFIED` maturity.
- Excluded paths: none.
- Verification: existing specs, plus a new D-106-IA fit review once specified (not yet possible).
- Rollback: N/A — not proposed for admission in this plan.

**A6 (Meta-WhatsApp content inside #7 — provenance-tagged, not separately branched)**
- Inputs: `connectors/meta-whatsapp/src/{port,dispatch,conversation-projection,fixtures,index}.ts` and 3 contract specs (53/53 assertions across the three spec files per their own `console.log` counts, confirmed by direct read this session).
- Dependencies: A2 (physically inseparable from #7 at the file level without a manual extraction, since it was merged directly into that branch).
- Excluded paths: none — this *is* the exclusion boundary itself; the correction from finding #1 is that admitting A2 does not imply admitting A6's product-scope status, only its source.
- Verification: `meta-whatsapp-port: 10/10`, `meta-whatsapp-dispatch: 10/10`, `meta-whatsapp-conversation-projection: 14/14` (already run and reported in PRs #19/#21/#24/#25).
- Rollback: N/A for source admission (it rides with A2 physically); a *product-scope* rollback (i.e. deciding not to expose WhatsApp as a channel) is a D-106 product decision, not a code revert.

## Proposed next bounded unit (ONE, not started)

**Admit A1**: PR #4 (`eng/rb-09-staged-transfer`) content onto `main`, immediately followed
by PR #6 (`eng/p0-024a-runtime-baseline`) content, as the two are dependency-linked and
together constitute the single A1 slice. This is the only slice with zero unresolved
prerequisites (A2–A6 all depend on A1; A1 depends on nothing). Diff-verified in this
revision (see "Foundation spine" above). **This is a proposal only — no admission, merge,
or product-source mutation is performed by this task or this artifact.**

## Unresolved evidence limitations (honest gaps, not resolved in this revision)

- A4's "no live-credential assumption" claim is asserted from file paths/naming only —
  the actual query/parser source was not read line-by-line for hardcoded store domains
  or tokens in this revision.
- A1's exact boundary between "genuinely foundational" and "scope creep already living
  inside #4" (e.g. why `apps/api/src` and evidence-gated connector stubs are inside a PR
  titled "canary transfer of Drive-staged root config + packages/domain") is recorded
  honestly above but not adjudicated — Brain/Founder should confirm whether A1 should be
  narrowed further before actual admission.
- CI status was checked for this artifact's own prior head (`35895122756` = SUCCESS) but
  not re-run for this revision's new head at time of writing this file (CI runs on push).

## Finding-to-change map (for Brain review)

| Finding | Change made |
|---|---|
| 1. No automatic admission of A6 as a side effect of A2; separate A1–A6 slicing | Six-outcome table now tags #7 as A2 only, with Meta-WhatsApp content separately tagged A6 with its own dependency/rollback row; "Next-slice note" language claiming Meta "travels with #7" removed. |
| 2. Mandatory manifest with exact SHA/paths; diff-verify #4/#6 now | Full disposition table rebuilt from `git diff --stat`/`--name-status` against fetched branches, not PR titles/bodies; #4/#6 fully diff-verified under "Foundation spine". |
| 3. Explicit disposition row for EACH #4–#18 using the six contract outcomes; #14/#17 = evidence only | Table now covers all 15 PRs (#1, #4–#18) with one of the six named outcomes each; #14/#17 explicitly `KEEP_AS_EVIDENCE`. |
| 4. AC-TEST-GAP-001 ↔ #16 relationship, runner lineage, not fixed here | New dedicated section added, sourced from the actual AC-TEST-GAP-001 record on `main`. |
| 5. Per-slice inputs/dependencies/excluded paths/verification/rollback; ONE next unit | New "Per-slice detail" section for A1–A6; single "Proposed next bounded unit" section naming A1 only. |

## Return to Brain

Task branch: `claude/github-branch-protection-access-o1g5m7`. PR: #26 (updated in place,
not a new PR). New head SHA: recorded in the commit that accompanies this file. Files
changed by this revision: `docs/exec-plans/active/AC-REPO-RECON-001-admission-plan.md`
only. Checks performed: `git fetch`/`git diff`/`git merge-base` against all 15 relevant
branches plus `main`, direct read of `AC-TEST-GAP-001`'s record and PR #16's/PR #4's/PR
#6's/PR #7's actual content. State ceiling: `IMPLEMENTED / AWAITING BRAIN REVIEW`.
