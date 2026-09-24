# AC-REPO-RECON-001 — Repo-Native Admission Plan (v5 — corrected)

## Revision note

v1 (`661da61`, CI `35895122756` SUCCESS) received 5 findings (doc 25 `CHANGES_REQUIRED`).
v2 (`b12aafd`, CI `35928653822` SUCCESS) addressed all 5, received 3 remaining defects on
re-review. v3 (`026793c`, CI `35933742993` SUCCESS) closed all 3, but the same re-review
found one new conflict: row #4e classified the IdeaSoft/ikas/Ticimax/T-Soft connector
stubs as `STILL_REQUIRED_DEPENDENCY` blocked on "a future scope decision" — this
contradicts **D-099** (verified directly from doc 07 this revision), which already
reclassified those four providers as `POST_REFERENCE_EXPANSION` / Phase 1B+, explicitly
non-blocking for Shopify-reference AC v1.0 progression. v4 (`aa9dd42`, CI `35938340668`
SUCCESS) reclassified #4e to `KEEP_AS_EVIDENCE` per D-099 and received `PASS/VERIFIED`
for the bounded planning checkpoint. A further Brain re-review (fresh main/#4/#6 diff)
found one concrete boundary defect surviving inside v4's A1 slice — PR #6's diff includes
`apps/control-center/src/approval-state.ts`, which is A5/HOLD, not A1 — and supplied a
fully-derived exact 122-path A1 materialization manifest plus a G1–G8 gap disposition, a
28-item BF (Building Failures) corpus reconciliation, and a BH/PF hardening control map
(D-107 benchmark-hardening + production-failure-closure overlays). This revision (v5)
**independently re-verifies** that manifest and the two most load-bearing technical
claims directly against source (not taken on the relayed document's word — see "v5
independent verification" below) before recording any of it, and explicitly declines the
portion of the same handoff that asked for actual source-code changes (see "v5 scope
boundary held"). Finding-to-change map at the bottom covers all rounds.

## v5 independent verification (done before writing anything below)

- **122-path A1 manifest**: extracted the exact path list from the Drive handoff and
  diffed it against `git diff --name-status` unions of `main→#4`, `#4→#6`, and #10's own
  commits, freshly re-fetched. **All 122 claimed paths exist in the real diff union; zero
  fabricated/unverifiable paths found.**
- **`apps/control-center/src/approval-state.ts` as the sole #4→#6 Control-Center delta**:
  confirmed via `git diff --name-only origin/eng/rb-09-staged-transfer
  origin/eng/p0-024a-runtime-baseline -- apps/control-center` — exactly that one file.
- **PF-01 claim** ("`ActionSettlementStatus` still includes `COMPENSATION_REQUIRED`,
  conflating settlement outcome with recovery disposition"): confirmed by reading
  `apps/api/src/action-settlement.ts` directly off `#4` — `COMPENSATION_REQUIRED` is a
  real member of `ACTION_SETTLEMENT_STATUSES`/`ActionSettlementStatus`, used at two call
  sites. Claim is accurate.
- **G3/BF-CHATWOOT-04 claim** ("customer identity natural key is not persistence-unique"):
  confirmed by reading `migrations/0001_foundation.sql` directly off `#4` —
  `customer_identity_lookup_idx` on `(merchant_workspace_id, channel_type,
  normalized_identifier_ref)` is a plain `CREATE INDEX`, not `UNIQUE`; the nearby `UNIQUE
  (customer_identity_id, merchant_workspace_id)` constrains the surrogate key, not the
  natural key. Claim is accurate.
- Given 122/122 paths and both spot-checked technical claims verified accurate, this
  revision records the rest of the G1–G8/BF/BH/PF material as Brain-authored, source-
  derived analysis — not re-derived line-by-line by Claude in this revision, but backed
  by a demonstrated accuracy track record on the checkable parts, and labeled as such
  below rather than silently re-attributed as independently Claude-verified.

## v5 scope boundary held

The same handoff also contains an **"A1-OWNED CORRECTIONS REQUIRED BEFORE SOURCE
ADMISSION"** section with an exact patch contract for `apps/api/src/action-settlement.ts`
+ `tests/security/action-settlement.spec.ts` (remove `COMPENSATION_REQUIRED` as a status,
separate outcome from recovery disposition) and a schema patch for
`migrations/0001_foundation.sql` + `tests/contract/schema-migration.spec.mjs` (add a
`UNIQUE` constraint on the customer-identity natural key). **This revision does not apply
either.** This task's own `FINAL CLAUDE EXECUTION CONTRACT` (doc 25, read directly by
Claude earlier in this task) authorizes exactly one artifact
(`docs/exec-plans/active/AC-REPO-RECON-001-admission-plan.md`) and explicitly excludes
product-source mutation; a separate chat confirmation that Founder authorized *Brain's*
own repo-write execution surface does not by itself re-scope *this* task's own contract.
The two corrections are recorded below as exact, ready-to-apply patch specs for whoever
Brain/Founder next selects to execute them, not applied here.

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

## Foundation spine — diff/source-verified, exact head SHAs (findings #2 and defect-1)

Every branch below was re-fetched fresh via `git fetch origin <branch>` immediately
before this revision; SHA is `git rev-parse origin/<branch>`, not a PR-API field.

| Branch | Exact head SHA |
|---|---|
| `main` | `8dd7343255c2ab037771d33f1f2c04ddbb84407f` |
| `eng/rb-09-staged-transfer` (#4) | `831abb78004b8beb417a99725c9ec13ab753cbc6` |
| `eng/p0-024a-runtime-baseline` (#6) | `dded3dcff391dd75b23bb05e2efa4d2ad041456a` |
| `eng/p0-026-job-run-safety-invariants` (#7) | `7a108d83a69e3f3d7ef9f774e42724c54c99b3f4` |

**PR #4 `eng/rb-09-staged-transfer`** (base `main`) — 179 files, +18,881/−98 lines.
Content, re-classified by exact `git diff --name-status` (not dirstat percentages, per
defect-2 — see "A1 narrowed" below): `packages/{domain,authz,commerce-contract,
ai-gateway,events,merchant-rules,truth-policy}/src`, `apps/api/src`, `migrations/`,
`scripts/`, toolchain/config files — **this subset only** is `ADMIT_BY_SLICE` (A1). The
remainder of #4's diff (`release/*.json`, `apps/control-center/src/*`,
`connectors/{ideasoft,ikas,ticimax,tsoft,meta-whatsapp}/src/*`) is reclassified out of
A1 below — PR #4 is therefore **split across three outcome rows**, not one.

**PR #6 `eng/p0-024a-runtime-baseline`** (base #4) — 47 files, +3,824/−182 lines.
Confirmed: `.github/workflows/` CI pipeline (install → typecheck → typecheck:staging →
lint → test → test:vitest → test:worker → audit → license scan, replacing the RB-08
placeholder), dependency pin bump (`hono` 4.12.32→4.12.34), `pnpm-lock.yaml` (+3,194
lines, first real lockfile), branded-primitive narrowing hardening across
`packages/{domain,authz,commerce-contract,ai-gateway,events}/src`, and a new
`tests/contract/branded-primitive-narrowing.spec.ts` (156 lines). All of #6's content is
inside the A1 boundary as narrowed below (toolchain/CI + the same package set as #4).
**Classification: `ADMIT_BY_SLICE` (A1, whole PR).**

**PR #7 `eng/p0-026-job-run-safety-invariants`** (base #6) — 62 files, +4,213/−227 lines.
Confirmed: `tests/security/dispatch-safety.spec.ts` (203 lines, new), Job/Run
worker-runtime smoke test, `packages/events/src` Job/Run/outbox/quota extensions, plus
`connectors/shopify/src` and `apps/control-center/` files that #7 itself adds/depends on,
and (via 4 commits identified by exact SHA below) the Meta-WhatsApp Lane-A source.
**Classification: `ADMIT_BY_SLICE` (A2) for the Job/Run/outbox content; the
`connectors/shopify/*`, `apps/control-center/*` and `connectors/meta-whatsapp/*` paths
inside #7's diff are reclassified to A4/A5/A6 respectively — see the exact-path/exact-SHA
extraction mechanics below.**

## A1 narrowed (defect-2): exact boundary, from source

The contract defines A1 as "foundation/toolchain/domain/authz/commerce/AI + necessary
migrations/tests, **excluding stale current-looking product/release authority**." Applying
that exclusion literally to #4's actual diff:

- **In A1**: `packages/{domain,authz,commerce-contract,ai-gateway,events,merchant-rules,truth-policy}/src` (the domain/authz/commerce/AI primitives named explicitly), `apps/api/src` (the Worker runtime entrypoint + action-engine/settlement/transport-contracts that those packages require to be executable — without it nothing in A1 can run, so it is foundation, not product feature surface), `migrations/`, `scripts/`, `tests/contract/*` and `tests/security/*` that exercise only the above paths, plus toolchain/config (`tsconfig*.json`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.github/workflows/ci.yml`, `.gitignore`, `.prettierignore`, `.prettierrc.json`, `eslint.config.mjs`, `THIRD_PARTY_NOTICES.md`, `DEPENDENCY_BASELINE.json`).
- **Excluded from A1 — this is exactly the "release authority" the contract says to exclude**: `release/{OPEN_GATES.json,CRV1_EVIDENCE_INDEX.json,STAGING_TEST_REPORT.json,PROVENANCE_REGISTER.json,STAGING_README.md}`, `apps/api/RUNTIME_BINDING_PLAN.json`, `apps/api/RUNTIME_SPIKE_STATUS.json`, `apps/control-center/FRONTEND_STAGING_STATUS.json` — these are historical evidence/assertion documents about test runs and release-gate status, not foundation code. New row, own outcome: see disposition table (`KEEP_AS_EVIDENCE`, tagged `release-evidence`, not part of any A-slice).
- **Excluded from A1, reclassified to A5**: `apps/control-center/src/{index,state,routes,api-client-contract,ux-presentation,approval-state}.ts` — Control-Center-specific, same family as #8/#9's router/operation-path; folds into the A5 HOLD, not A1.
- **Excluded from A1, reclassified to A6**: `connectors/meta-whatsapp/src/{e3-acceptance,index}.ts` (the initial stub baseline, later built on by PR #19/21/24).
- **Excluded from A1, non-blocking deferred evidence**: `connectors/{ideasoft,ikas,ticimax,tsoft}/src/index.ts` — evidence-gated stubs (no live provider logic). Per **D-099** ("SHOPIFY-FIRST REFERENCE V1 / CONNECTOR SEQUENCING & CR-V1 BLOCKER RECLASSIFICATION," verified directly from doc 07 this revision): "Ticimax, IdeaSoft, ikas and T-Soft no longer block Shopify-reference AC v1.0 progression... reclassified to `POST_REFERENCE_EXPANSION` / Phase 1B+." These stubs are therefore **not** a dependency this admission chain is blocked on, and their absence from the A0–A6 model does not require a new Founder/scope decision — D-099 already settled that. Preserved as provenance/evidence only.

## Required PR disposition table — all of #4–#18, diff-verified, exact head SHAs

| PR | Branch @ exact head SHA | Merge-base w/ #7 tip | Own-commit content (exact paths) | Outcome | Slice | Notes |
|---|---|---|---|---|---|---|
| #4a | `eng/rb-09-staged-transfer` @ `831abb78004b8beb417a99725c9ec13ab753cbc6` | — (base `main`) | `packages/{domain,authz,commerce-contract,ai-gateway,events,merchant-rules,truth-policy}/src`, `apps/api/src`, `migrations/`, `scripts/`, toolchain/config, matching `tests/contract`+`tests/security` — see "A1 narrowed" above | `ADMIT_BY_SLICE` | A1 | First in dependency order. |
| #4b | same commit, path subset | — | `release/*.json`, `apps/api/{RUNTIME_BINDING_PLAN,RUNTIME_SPIKE_STATUS}.json`, `apps/control-center/FRONTEND_STAGING_STATUS.json` | `KEEP_AS_EVIDENCE` | — (release-evidence) | Excluded from A1 per the contract's own "excluding stale current-looking product/release authority" clause. Needs a separate future admission decision, not bundled with foundation code. |
| #4c | same commit, path subset | — | `apps/control-center/src/{index,state,routes,api-client-contract,ux-presentation,approval-state}.ts` | `REBASE_AND_ADAPT` | A5 (HOLD) | Reclassified out of A1; folds into the same D-106-Control-Center-scope HOLD as #8/#9. |
| #4d | same commit, path subset | — | `connectors/meta-whatsapp/src/{e3-acceptance,index}.ts` | `ADMIT_BY_SLICE` (source only, see A2/A6 mechanics) | A6 | Initial stub baseline; extends via commits `d9dfe0e`/`5222b03`/`07c132b` inside #7 (see below). |
| #4e | same commit, path subset | — | `connectors/{ideasoft,ikas,ticimax,tsoft}/src/index.ts` | `KEEP_AS_EVIDENCE` | none (`POST_REFERENCE_EXPANSION` / Phase 1B+ per D-099) | No named A-slice covers these providers, but per D-099 (verified directly from doc 07) they are explicitly non-blocking for Shopify-reference AC v1.0 progression — not a dependency, not a pending scope decision. Preserved as provenance only. |
| #6 | `eng/p0-024a-runtime-baseline` @ `dded3dcff391dd75b23bb05e2efa4d2ad041456a` | — (base #4) | 47 files, entirely inside the A1 boundary (CI pipeline, dependency pin, branded-primitive hardening across the A1 package set) | `ADMIT_BY_SLICE` | A1 | Depends on #4a. |
| #7 | `eng/p0-026-job-run-safety-invariants` @ `7a108d83a69e3f3d7ef9f774e42724c54c99b3f4` | — (base #6) | `packages/events/src` Job/Run/outbox/quota extensions, `tests/security/dispatch-safety.spec.ts`, worker-runtime smoke test — **excluding** `connectors/shopify/*` (→A4 row below), `apps/control-center/*` (→A5), `connectors/meta-whatsapp/*` (→A6, commits `d9dfe0e`/`5222b03`/`07c132b`) | `ADMIT_BY_SLICE` | A2 | Depends on #4a→#6. See "A2/A6 exact separation mechanics" below for how the excluded paths are extracted rather than assumed inseparable. |
| #8 | `feat/control-center-route-matcher` @ `f1d448cf7477b8b58aba71f124ed35ad92816767` | `0969728b` (stale — predates #19–#25 merge into #7) | `apps/control-center/src/App.tsx` (new), `route-matcher.ts` (new), `main.tsx` (mod), `FRONTEND_STAGING_STATUS.json` (mod), `tests/contract/control-center-route-matcher.spec.ts` (new) | `REBASE_AND_ADAPT` | A5 (HOLD) | Router mechanics reusable; must rebase onto current #7 tip (missing 6 later commits) **and** wait for D-106 Control-Center scope to reach `SPECIFIED` before IA fit review — two independent blockers, not one. |
| #9 | `feat/control-center-operation-path` @ `2edadfe1c0ca59a06afb4c7f10b4db4776b19e8a` | `0969728b` (stale, same as #8) | `apps/control-center/src/operation-path.ts` (new), `tests/contract/control-center-operation-path.spec.ts` (new) | `REBASE_AND_ADAPT` | A5 (HOLD) | Transport-contract path mechanics reusable; same two blockers as #8. |
| #10 | `docs/git-workflow-policy` @ `4f017cc72c427f0d2eedd3b71c297a0b01280c14` | `0969728b` (stale) | `AGENTS.md` (mod), `docs/engineering/GIT_WORKFLOW.md` (new), `docs/exec-plans/active/AC-github-pr-workflow-adoption-20260826.md` (new) | `FOLD_INTO_ADMISSION` | A1 | Governance-relevant (touches AGENTS.md), not a pure record — fold into A1 rather than admit standalone, so the AGENTS.md edit is reviewed alongside the rest of the foundation diff, not in isolation. Needs rebase (stale base). |
| #11 | `feat/shopify-graphql-queries` @ `10c41ccdab5b65d0c740d1295009e259e43ce7bb` | `0969728b` (stale) | `connectors/shopify/src/index.ts` (mod), `queries.ts` (new), `tests/contract/shopify-connector-queries.spec.ts` (new) | `REBASE_AND_ADAPT` | A4 | Needs rebase. Must be admitted **before** #12 and #13 — both touch `connectors/shopify/src/index.ts` / build on this file, real merge-order dependency, not just a suggestion. |
| #12 | `feat/shopify-product-response-parser` @ `32dcf5597af668a988bbdd470e8c3a5f4bcb21b2` | `0969728b` (stale) | `connectors/shopify/src/index.ts` (mod), `parse-product-response.ts` (new), `tests/contract/shopify-connector-product-response-parser.spec.ts` (new) | `REBASE_AND_ADAPT` | A4 | **Also modifies `connectors/shopify/src/index.ts`, same file #11 modifies** — real conflict risk since #12's Git base is #7 directly, not #11. Must be re-based onto #11's result (not #7) before admission, despite what its recorded PR base says. |
| #13 | `feat/shopify-order-response-parser` @ `4b3ef483827c66e3385ac6257bc4085a441bb32c` | (base is #11, not #7) | `connectors/shopify/src/parse-order-response.ts` (new), `tests/contract/shopify-connector-order-response-parser.spec.ts` (new) — 3 files, +163 lines, diffed directly against #11's exact head `10c41ccdab5b65d0c740d1295009e259e43ce7bb` | `REBASE_AND_ADAPT` | A4 | Correctly stacked on #11 already. Admission order within A4: #11 → #13 → #12 (reconciled onto #13's result). |
| #14 | `docs/rb05-reconcile-20260827` @ `f502694770f7e53bcf3481c535ef779844c1d917` | `0969728b` (stale) | `docs/exec-plans/active/AC-rb05-reconcile-checkpoint-20260827.md` (new) | `KEEP_AS_EVIDENCE` | — | Per Brain finding #3: historical/superseded checkpoint record, never active "admit whenever convenient" instruction. Preserve as evidence; do not treat its own contents as current authority. |
| #15 | `docs/acceptance-criteria-f1-f2-f3-backfill` @ `6385f113456bc802e662f190eb6d98ef694235a0` | `0969728b` (stale) | `docs/engineering/ACCEPTANCE_CRITERIA.md` (mod) | `KEEP_AS_EVIDENCE` (reclassified in v5, was `FOLD_INTO_ADMISSION`/A1) | A2 or after | **v5 correction**: describes A2 Job/Run/outbox/lease/migrations 0002/0003 as `IMPLEMENTED` — admitting it inside A1, before that A2 source itself is admitted, would recreate stale current-looking repository truth. Sequence with or after A2 instead. |
| #16 | `fix/merchant-rule-latest-version-selection` @ `72708127a4fd1f199f6cbbe0dc49a48a2903369b` | `0969728b` (stale) | `packages/merchant-rules/src/rules.ts` (mod, the actual fix), `tests/contract/{commerce-contract,event-lineage}.spec.ts` (mod), `tests/security/{support-core,tenant-authz}.spec.ts` (mod) — 5 files | `ADMIT_BY_SLICE` | A3 | Real correctness bug (`resolveRuleGroup()` was selecting the oldest eligible rule version, not newest, in security-critical Merchant Rule resolution) plus activation of 4 previously-silently-passing (assert-nothing) test files. Needs rebase (trivial — 5 isolated files, no shared-path conflict with #8–#15). See AC-TEST-GAP-001 relationship below. |
| #17 | `docs/rb05-stop-saturated-20260827` @ `36d14854503cb81b82a19d73ee46e73b4ade87b2` | — (base `main`, stale — predates PR #20 merge) | `docs/exec-plans/active/AC-rb05-stop-saturated-20260827.md` (new); **also silently deletes `docs/exec-plans/active/AC-TEST-GAP-001-staging-runner-evidence-mismatch.md` relative to current `main`** (branch predates that file's merge) | `KEEP_AS_EVIDENCE` | — | Per Brain finding #3, same treatment as #14. **Unsafe to merge as-is**: must rebase onto current `main` first, or merging would delete the AC-TEST-GAP-001 record. |
| #18 | `chore/gitignore-staging-build` @ `9722e5f056f57716c20e46ff52641789c1d63d40` | — (base `main`, stale, same issue as #17) | `.gitignore` (mod, adds `.staging-build/`); same AC-TEST-GAP-001-deletion risk as #17 | `ADMIT_BY_SLICE` | A1 | Trivial, correct fix (this exact gap was independently hit and worked around by hand during this task — see Evidence basis). Needs rebase onto current `main` first for the same reason as #17. |
| #5 | `eng/ac-eng-task-001-exec-plan` @ `cc07a479d1556182c82b5585eb88fb0a28ba5fd8` | — (base `main`, stale, same issue as #17/#18) | `docs/exec-plans/active/AC-ENG-TASK-001-P0-024A.md` (new); same AC-TEST-GAP-001-deletion risk | `KEEP_AS_EVIDENCE` | — | Same rebase requirement as #17/#18 before it is safe to merge. |
| #1 | `dependabot/github_actions/actions/checkout-7` | — (base `main`) | `.github/workflows/*` version bump only | `ADMIT_BY_SLICE` | A1 (CI layer) | Routine, independent, admit any time after rebase-safety check against current `main`. Exact head not re-fetched this revision (unchanged, low-risk, no dependency on the rest of this table). |

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

**A1 (PR #4a → #6, folding in #10/#15/#18/#1 governance/CI items — narrowed per defect-2)**
- Inputs: `packages/{domain,authz,commerce-contract,ai-gateway,events,merchant-rules,truth-policy}/src`, `apps/api/src`, `migrations/`, `scripts/`, toolchain/config files, matching `tests/contract`/`tests/security`, `AGENTS.md` git-workflow addendum, `docs/engineering/{GIT_WORKFLOW.md,ACCEPTANCE_CRITERIA.md}`, `.gitignore` fix (see "A1 narrowed" section above for the exact-path derivation).
- Dependencies: none (first slice onto `main`); #6 depends on #4a internally.
- Excluded paths (all reclassified to their own rows/slices, not silently dropped): `release/*.json` + `apps/api/{RUNTIME_BINDING_PLAN,RUNTIME_SPIKE_STATUS}.json` + `apps/control-center/FRONTEND_STAGING_STATUS.json` (#4b, `KEEP_AS_EVIDENCE`), `apps/control-center/src/*` base scaffolding (#4c, A5), `connectors/meta-whatsapp/src/*` (#4d, A6), `connectors/{ideasoft,ikas,ticimax,tsoft}/src/*` (#4e, `KEEP_AS_EVIDENCE`, non-blocking per D-099), `apps/control-center/src/{route-matcher,operation-path}.ts` (#8/#9, A5), `connectors/shopify/src/*` (A4), `packages/merchant-rules/src/rules.ts` fix (#16, A3).
- Verification after admission: `pnpm install --frozen-lockfile && pnpm run typecheck && pnpm run typecheck:staging && pnpm run lint && pnpm run test && pnpm run test:vitest && pnpm run test:worker && pnpm audit` — this is the exact CI pipeline #6 itself introduces; should be exercised by CI on the admission PR before merge.
- Rollback/recovery: single squash-mergeable slice onto `main`; revert is one `git revert` of the merge commit, no other slice depends on partial A1 state (A2–A6 are not yet admitted at this point).

**A2 (PR #7, narrowed — `connectors/shopify/*`, `apps/control-center/*`, `connectors/meta-whatsapp/*` excluded by path per the A6 mechanic above, applied identically to A4/A5)**
- Inputs: `packages/events/src` Job/Run/outbox/quota extensions, `tests/security/dispatch-safety.spec.ts`, `tests/runtime/job-run-workerd-smoke.spec.ts`.
- Dependencies: A1 (#4a→#6).
- Excluded paths: `connectors/shopify/src/*` (A4), `apps/control-center/*` (A5), `connectors/meta-whatsapp/*` + `tests/contract/meta-whatsapp-*.spec.ts` (A6) — same path-filter mechanic as the A6 section above, applied to whichever of these #7's own diff happens to introduce.
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

**A6 (Meta-WhatsApp — exact extraction mechanics, defect-3 correction)**
- Inputs: `connectors/meta-whatsapp/src/{port,dispatch,conversation-projection,fixtures,index}.ts` and 3 contract specs (53/53 assertions across the three spec files per their own `console.log` counts, confirmed by direct read this session).
- **Exact provenance** (commit SHAs within #7's history that introduce/extend this path, found via `git log --oneline origin/eng/p0-026-job-run-safety-invariants -- connectors/meta-whatsapp/`):
  - `19225c1` (RB-09 transfer, part of #4) — introduces `e3-acceptance.ts`/`index.ts` baseline stub. This commit is **mixed**: it also carries unrelated A1 foundation content (`packages/authz`, `packages/events`, etc.), so it cannot be excluded wholesale by commit — see path-filter mechanic below instead.
  - `d9dfe0e` (PR #19) — adds `port.ts`, `fixtures.ts`. Pure A6, no A1/A2 content.
  - `5222b03` (PR #21) — adds `dispatch.ts`. Pure A6.
  - `07c132b` (PR #24) — adds `conversation-projection.ts`, extends `fixtures.ts`. Pure A6.
  - (PR #25's equal-timestamp test only touches `tests/contract/meta-whatsapp-conversation-projection.spec.ts`, not the `connectors/` path itself.)
- **Concrete separation mechanic** (replacing the prior, rejected "rides with A2" framing): because `19225c1` mixes A1 and A6 content, exclusion must be done **by path, not by commit**. To admit A2 (and A1/#4a) without A6: apply a path-filter that drops `connectors/meta-whatsapp/**` and `tests/contract/meta-whatsapp-*.spec.ts` from whatever tree/patch-set is materialized for admission (e.g. `git diff <base> <head> -- . ':!connectors/meta-whatsapp' ':!tests/contract/meta-whatsapp-*.spec.ts'`, or an equivalent sparse-admission step). This is a mechanical, repeatable filter, not a claim that the source is inseparable.
- Dependencies: A2 for the surrounding branch context (packages/events job/outbox primitives A6 composes on), independent otherwise.
- Excluded paths from A2 admission, when A6 is not concurrently authorized: `connectors/meta-whatsapp/**`, `tests/contract/meta-whatsapp-*.spec.ts`.
- Verification: `meta-whatsapp-port: 10/10`, `meta-whatsapp-dispatch: 10/10`, `meta-whatsapp-conversation-projection: 14/14` (already run and reported in PRs #19/#21/#24/#25).
- Rollback: path-filter is reversible in both directions (add the paths back in a follow-up commit/PR); a *product-scope* rollback (deciding not to expose WhatsApp as a channel after A6 is source-admitted) is a separate D-106 product decision, not a code revert.

## A1 exact materialization manifest (122 paths, verified)

Base: fresh `main@8dd7343255c2ab037771d33f1f2c04ddbb84407f`. Not a wholesale merge of #4
or #6 — a bounded path/file overlay, since `main↔#4` is diverged.

1. Overlay all A1 paths from `#4@831abb7...`: `packages/{domain,authz,commerce-contract,
   ai-gateway,events,merchant-rules,truth-policy}/src/**`, `apps/api/src/**`,
   `migrations/**`, `scripts/**`, the A1-scoped `tests/{contract,security,runtime}/**`
   files, and toolchain/config (`tsconfig*.json`, `package.json`, `pnpm-lock.yaml`,
   `pnpm-workspace.yaml`, `.prettierignore`, `.prettierrc.json`, `eslint.config.mjs`,
   `THIRD_PARTY_NOTICES.md`, `DEPENDENCY_BASELINE.json`).
2. Overlay A1-valid `#6@dded3dc...` deltas onto those same paths. **Explicitly exclude**
   `apps/control-center/src/approval-state.ts` (A5/HOLD — this is the one defect the v4
   PASS/VERIFIED checkpoint missed, per this round's Brain re-review, independently
   confirmed above).
3. Additional exact exclusions (all present in the real #4 diff, confirmed above):
   `PROVENANCE_REGISTER.json`, `STAGING_README.md`,
   `tests/contract/internal-dogfood-auth-perimeter-admission.spec.mjs` — current-looking
   release/evidence artifacts, not A1 foundation source (consistent with `KEEP_AS_EVIDENCE`
   / #4b from v2-v4 above).
4. PR #10 (`docs/git-workflow-policy`): apply only its two-path governance patch —
   `AGENTS.md` two-line addendum + new `docs/engineering/GIT_WORKFLOW.md` — **not** its
   own historical adoption exec-plan doc. This is what brings the manifest from 120 to
   122 paths.
5. PR #1 (dependabot): apply only the `actions/checkout@v4 → @v7` line as an overlay onto
   the A1 `#6` CI workflow — do not replace the whole workflow with PR #1's older
   bootstrap-stage blob.
6. PR #18 (`chore/gitignore-staging-build`): apply only the `.staging-build/` ignore line
   as an overlay onto the A1 `#6` `.gitignore` — do not replace it with PR #18's stale-base
   blob.
7. **PR #15 reclassified out of A1** (correction to this plan's own earlier `FOLD_INTO_ADMISSION`/A1 tag from v2-v4): its content documents A2 Job/Run/outbox/lease/migrations 0002/0003 as already `IMPLEMENTED`. Admitting that document inside A1 — before the A2 source it describes is itself admitted — would recreate exactly the kind of stale current-looking repository truth this whole task exists to prevent. New outcome: `KEEP_AS_EVIDENCE`, sequenced to land with or after A2, not A1.
8. Preserve every `main`-only path unchanged, explicitly including
   `docs/exec-plans/active/AC-TEST-GAP-001-staging-runner-evidence-mismatch.md`.
9. Do not import stale pre-D-106 WhatsApp-first wording from README.md/CLAUDE.md in this
   slice — that stays `AC-REPO-PROJECTION-106`'s separate, not-yet-selected scope.

**Claim ceiling**: this manifest is a verified, ready-to-execute *specification* — path
selection and exclusions are confirmed against real git history, but no tree was actually
built, tested, or committed by this revision. Materializing it (checking out the paths,
applying the two correction patches below, running the A1 CI pipeline, and returning a
real diff) is future work, explicitly not performed here per this task's own contract.

## G1–G8 / BF-corpus / BH / PF gap disposition (Brain-authored source analysis — see verification note above)

**G1–G8** (external-effect reliability primitives, all currently `GAP` or `PARTIAL` at the
A1 layer, none claimed closed): G1 crash/ack-loss replay window open; G2 canonical
execution identity under-specified; **G3 customer-identity natural key not
persistence-unique (independently verified above)**; G4 `ownership_epoch` exists but the
final external-send boundary doesn't consume it end-to-end; G5 quota atomicity is
in-memory only; G6 no tenant-fairness policy under bounded concurrency; G7 no durable
publisher/claimer/reconciler; G8 account-binding/credential-state primitives incomplete.

**28-item BF (failure-corpus) reconciliation**: 2 `COVERED`, 9 `PARTIAL`, 13 `GAP`, 4
`NOT_APPLICABLE_TO_SLICE`. Two items are called out as **A1-owned** (fixable within A1's
own file boundary, not requiring A2/provider runtime): `BF-CHATWOOT-04` (→ G3, the
persistence-uniqueness gap above) and the `PF-01` settlement/recovery conflation below.
Everything else in the corpus is explicitly mapped to A2, A4, or a named later-wave
backlog item (`AC-XCID-107`, `AC-BENCH-HARDEN-107`, `AC-SHOP-LC-106`, etc.) — full mapping
lives in the Drive handoff; not reproduced path-by-path here to keep this artifact
reviewable, but every item is either `PARTIAL_EXISTING`/`ALREADY_SATISFIED` with a named
source file or explicitly deferred, none silently dropped.

**BH-01..06** (D-107 benchmark-hardening) and **PF-01..06** (production-failure-closure)
control maps: of twelve controls, none are claimed fully closed at A1. Two have exact,
scoped, A1-owned correction patches ready (PF-01, and the G3/BF-CHATWOOT-04 schema fix);
the remaining ten are explicitly `OWNED_BY_A2/LATER` or mapped to a named backlog item
(`AC-LIFECYCLE-107`, `AC-BILLENT-106`, `AC-HANDOFF-106`, `AC-CONV-CORE-106`,
`AC-BENCH-HARDEN-107`) — this plan records that mapping but does not implement any of
them, and explicitly flags PF-03/PF-05 as "do not fabricate PASS" (no tenant-fairness or
lifecycle state machine exists yet, and none is claimed here).

### Two ready-to-apply patch specs (recorded, not applied — see "v5 scope boundary held")

**A. PF-01 — `apps/api/src/action-settlement.ts` + `tests/security/action-settlement.spec.ts`.**
Remove `COMPENSATION_REQUIRED` from `ActionSettlementStatus`; keep coarse
`SUCCEEDED`/`FAILED`/`BLOCKED`-equivalent outcome status separate from a recovery
disposition (`NONE`/`RUN_OR_WAIT_FOR_VERIFICATION`/`RECONCILE_PROVIDER_RESULT`/
`COMPENSATE_OR_ROLLBACK`/`MANUAL_REVIEW`, `SAFE_TO_RETRY` only with deterministic
evidence). `UNKNOWN`/`PARTIAL_EFFECT` remain first-class outcomes; provider success
pending required post-read is never reported as verified success. Direct test acceptance
criteria (7 conditions, e.g. "no assertion expects `status === COMPENSATION_REQUIRED`")
are fully specified in the source handoff. Scope-bounded to these two files unless a
compile-time dependent path forces otherwise.

**B. G3/BF-CHATWOOT-04 — `migrations/0001_foundation.sql` + `tests/contract/schema-migration.spec.mjs`.**
Add a DB-enforced `UNIQUE` constraint/index on `(merchant_workspace_id, channel_type,
normalized_identifier_ref)` (currently a plain, non-unique `customer_identity_lookup_idx`
— confirmed above), plus an executable uniqueness assertion in
`schema-migration.spec.mjs` (already wired into the staging runner, so not subject to the
AC-TEST-GAP-001 `.mjs`-allowlist gap). Application-level conflict re-read/reconcile stays
`AC-XCID-107`/runtime scope — this patch claims persistence-level duplicate prevention
only.

## Proposed next bounded unit (ONE, not started)

**Materialize A1** using the exact 122-path manifest above (base `main`, overlay `#4` A1
paths + A1-valid `#6` deltas excluding `approval-state.ts`, apply the #10/#1/#18
overlays, apply patch specs A and B), run the full A1 CI pipeline, and return the real
diff for Brain review. This is now a fully-specified, verified-path unit with zero
remaining unresolved boundary ambiguity — **but it requires product-source mutation,
which is outside this task's own docs-only contract** (see "v5 scope boundary held").
**This plan proposes it as the next unit; it does not start it.**

## Unresolved evidence limitations (honest gaps, not resolved in this revision)

- A4's "no live-credential assumption" claim is asserted from file paths/naming only —
  the actual query/parser source was not read line-by-line for hardcoded store domains
  or tokens in this revision.
- A1's boundary is now narrowed by path (see "A1 narrowed"), but `apps/api/src`'s
  inclusion rests on this plan's own judgment call ("required for anything in A1 to be
  executable") rather than a citation from the contract text itself — Brain should
  confirm that reasoning is accepted, or state where the line actually falls, before
  actual admission.
- CI status was checked for this artifact's own prior head (`35895122756` = SUCCESS) but
  not re-run for this revision's new head at time of writing this file (CI runs on push).

## Finding-to-change map (for Brain review)

**Round 1 (v1 head `661da61` → v2 head `b12aafd`):**

| Finding | Change made |
|---|---|
| 1. No automatic admission of A6 as a side effect of A2; separate A1–A6 slicing | Six-outcome table tagged #7 as A2 only, with Meta-WhatsApp content separately tagged A6. |
| 2. Mandatory manifest with exact SHA/paths; diff-verify #4/#6 now | Disposition table rebuilt from `git diff --stat`/`--name-status`, not PR titles/bodies. |
| 3. Explicit disposition row for EACH #4–#18 using the six contract outcomes; #14/#17 = evidence only | Table covered all 15 PRs with one of the six named outcomes; #14/#17 → `KEEP_AS_EVIDENCE`. |
| 4. AC-TEST-GAP-001 ↔ #16 relationship, runner lineage, not fixed here | Dedicated section added, sourced from the actual AC-TEST-GAP-001 record on `main`. |
| 5. Per-slice inputs/dependencies/excluded paths/verification/rollback; ONE next unit | "Per-slice detail" section for A1–A6; single "Proposed next bounded unit" naming A1. |

**Round 2 (v2 head `b12aafd` → v3 head `026793c`):**

| Defect | Change made |
|---|---|
| 1. Manifest not exact-head-SHA reproducible for #4/#6/#7/#8–#18 | Added a head-SHA table for the foundation spine and a "Branch @ exact head SHA" column to every row of the disposition table, all freshly re-fetched via `git fetch`/`git rev-parse` this revision. |
| 2. A1 still over-broad, not narrowed from source | New "A1 narrowed" section applies the contract's own "excluding stale current-looking product/release authority" clause literally to #4's diff; splits #4 into 5 path-level rows (#4a foundation / #4b release-evidence / #4c Control-Center / #4d Meta stub / #4e provider stubs) instead of one blanket `ADMIT_BY_SLICE`. |
| 3. A2/A6 separation wording ("rides with A2") still ambiguous | Replaced with exact commit-SHA provenance (`19225c1`/`d9dfe0e`/`5222b03`/`07c132b`) and a concrete, reversible path-filter mechanic (exclude `connectors/meta-whatsapp/**` + its spec glob) for admitting A2 without A6, or vice versa. |

**Round 3 (v3 head `026793c` → this revision, v4):**

| Defect | Change made |
|---|---|
| 1. Row #4e (`STILL_REQUIRED_DEPENDENCY`, "future scope decision") conflicts with D-099 | D-099 read directly from doc 07 this revision (verbatim: "Ticimax, IdeaSoft, ikas and T-Soft no longer block Shopify-reference AC v1.0 progression... reclassified to `POST_REFERENCE_EXPANSION` / Phase 1B+"). #4e reclassified to `KEEP_AS_EVIDENCE`; "A1 narrowed" and A1 per-slice-detail text updated to cite D-099 and drop the "future scope decision"/model-gap framing. |

**Round 4 (v4 head `aa9dd42`, PASS/VERIFIED → this revision, v5):**

| Item | Change made |
|---|---|
| Surviving A1 boundary defect: `#6` includes `apps/control-center/src/approval-state.ts` (A5, not A1) | Added to the exact-exclusion list in the new A1 materialization manifest; independently confirmed via `git diff` as the sole `#4→#6` Control-Center delta. |
| Exact 122-path A1 materialization manifest (handoff-supplied) | Independently diffed all 122 paths against real `git diff` unions of `main→#4`, `#4→#6`, `#10` own commits — 122/122 confirmed present, zero fabricated. Recorded as a new top-level section with the precedence/overlay algorithm (PR #10/#1/#18 line-level overlays, not wholesale replacement). |
| PR #15 mixed into A1 in earlier rounds | Reclassified `KEEP_AS_EVIDENCE`, resequenced to A2-or-later — it describes A2 content as already implemented, which would be stale-truth if admitted inside A1. |
| G1–G8 / 28-item BF corpus / BH-01..06 / PF-01..06 gap disposition (handoff-supplied) | Spot-verified the two claims backing the only two "A1-owned, fixable now" items (PF-01 against `action-settlement.ts`; G3/BF-CHATWOOT-04 against `migrations/0001_foundation.sql`) directly against source — both accurate. Recorded the full disposition as Brain-authored analysis, explicitly labeled as such, not silently re-attributed as independently re-derived by Claude line-by-line. |
| Handoff's request to apply the two source-code patch specs (PF-01, G3) directly | **Declined in this revision** — recorded both as exact, ready-to-apply patch specs instead of applying them, since this task's own `FINAL CLAUDE EXECUTION CONTRACT` (read directly, not secondhand) authorizes only this one docs artifact and explicitly excludes product-source mutation. A separate chat-level Founder confirmation of *Brain's* own repo-write authority does not itself re-scope this task's contract. |

## Return to Brain

Task branch: `claude/github-branch-protection-access-o1g5m7`. PR: #26 (updated in place
across all revisions, not a new PR). Head history: `661da61` (v1) → `b12aafd` (v2, CI
`35928653822` SUCCESS) → `026793c` (v3, CI `35933742993` SUCCESS) → `aa9dd42` (v4, CI
`35938340668` SUCCESS, PASS/VERIFIED) → this revision (v5, new head recorded in the
accompanying commit). Files changed by this revision:
`docs/exec-plans/active/AC-REPO-RECON-001-admission-plan.md` only — no product-source
file was created, modified, or staged. Checks performed this round: direct read of the
full Drive handoff payload (not summarized secondhand); independent `git diff`
verification of all 122 manifest paths and the sole `#4→#6` Control-Center delta;
independent source reads of `apps/api/src/action-settlement.ts` and
`migrations/0001_foundation.sql` to verify the two claims underpinning the only two
A1-owned correction candidates. State ceiling: `IMPLEMENTED / AWAITING BRAIN REVIEW`. Two
exact patch specs (PF-01, G3) are recorded and ready for whoever is authorized to execute
product-source changes — that authorization was explicitly not exercised by this task.
