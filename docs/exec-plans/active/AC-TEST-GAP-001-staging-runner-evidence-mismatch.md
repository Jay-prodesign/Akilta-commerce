# AC-TEST-GAP-001 — Staging Test Runner Evidence Mismatch

Provisional task ID. Record-only: this document does **not** fix the gap. It exists so the
gap is tracked as its own bounded unit rather than silently absorbed into an unrelated PR.

## Found during

PR #19 (`feat/meta-whatsapp-provider-neutral-port`, P0-017 D-103 Lane A first slice) local
CI-equivalent validation, 2026-09-22. Unrelated to that PR's code — flagged separately per
instruction, not fixed there.

## The gap

`scripts/run-staging-tests.mjs` runs the dependency-free contract/security suite in two ways:

1. Every `*.spec.ts` file under `tests/contract/` and `tests/security/`, auto-discovered by
   directory glob **after** `tsc -p tsconfig.plain-tests.json` compiles them to
   `.staging-build/tests/{contract,security}/*.spec.js`.
2. A **fixed, hand-maintained list** of six `.mjs` files, each named explicitly:
   `schema-migration.spec.mjs`, `schema-migration-0002.spec.mjs`,
   `p0-026-source-safety.spec.mjs`, `schema-migration-0003.spec.mjs`,
   `phase1b-evidence-gated-connectors.spec.mjs`, `shopify-reference-connector-stub.spec.mjs`.

`.mjs` files are **not** auto-discovered (only `.ts` sources go through the compile step), so
any `.mjs` test file not on that explicit list never runs — not in a local `pnpm test`, not in
CI (`.github/workflows/ci.yml`'s only contract/security-suite step is `pnpm run test`, and
`pnpm run test:vitest` / `pnpm run test:worker` are separate, narrowly-scoped suites that don't
cover these files either).

## Affected files (12, confirmed unwired as of 2026-09-22)

```
tests/contract/commercial-ready-e6-review-template.spec.mjs
tests/contract/design-partner-e5-admission-template.spec.mjs
tests/contract/ikas-e2-admin-api-reference.spec.mjs
tests/contract/ikas-normalized-mapping-gap.spec.mjs
tests/contract/internal-dogfood-auth-perimeter-admission.spec.mjs
tests/contract/meta-e3-acceptance-template.spec.mjs
tests/contract/normalized-contract-cross-provider-pressure.spec.mjs
tests/contract/owned-dogfood-e4-admission-template.spec.mjs
tests/contract/provenance.spec.mjs
tests/contract/provider-reference-profile.spec.mjs
tests/contract/source-timestamp-schema.spec.mjs
tests/contract/tsoft-normalized-mapping-gap.spec.mjs
```

## Why this is a real risk, not cosmetic

Several release/evidence artifacts cite these exact files as sources of PASS evidence, which
is not verifiable if the files never actually execute in CI:

- `release/OPEN_GATES.json` line 139: `"meta_e3_harness": "... + tests/contract/meta-e3-acceptance-template.spec.mjs; targeted 18/18 structural PASS only."`
- `release/CRV1_EVIDENCE_INDEX.json` line 104: lists `tests/contract/meta-e3-acceptance-template.spec.mjs` as an evidence source.
- `release/STAGING_TEST_REPORT.json` line 401: `"test": "tests/contract/meta-e3-acceptance-template.spec.mjs"`.
- `PROVENANCE_REGISTER.json` line 1765: same path listed as a provenance test source.

(The above are the confirmed citations for `meta-e3-acceptance-template.spec.mjs` specifically;
the other 11 files were not individually cross-referenced against these evidence documents as
part of this record — that cross-check is part of the fix-scope, not this record.)

This is the same defect *class* (evidence artifacts asserting a test result the actual CI
runner never produced) this repository already found and fixed once this session, for a
different mechanism: `support-core.spec.ts`/`tenant-authz.spec.ts`/`commerce-contract.spec.ts`/
`event-lineage.spec.ts` were compiled and executed but had no assertion loop, so they always
"passed" without checking anything (fixed in the `fix/merchant-rule-latest-version-selection`
branch / PR #16). AC-TEST-GAP-001 is a different root cause — these `.mjs` files may well have
real, working assertion loops (each was manually run and observed passing when authored) — but
the *runner* never invokes them at all, so no CI evidence backs the release documents' claims.

## Explicitly out of scope for this record

- No fix to `scripts/run-staging-tests.mjs` is made here.
- No claim is made about whether each of the 12 files' internal assertions are currently
  correct/passing if run manually — that has not been re-verified in this pass.
- No release/evidence document (`OPEN_GATES.json`, `CRV1_EVIDENCE_INDEX.json`,
  `STAGING_TEST_REPORT.json`, `PROVENANCE_REGISTER.json`) is edited here.

## Candidate fix shape (for the follow-up bounded task, not decided here)

Most likely minimal fix: change the runner's `.mjs` handling from a hand-maintained allowlist
to the same directory-glob auto-discovery already used for `.ts` files (i.e. glob
`tests/contract/*.spec.mjs` and `tests/security/*.spec.mjs` directly, no compile step needed
since they're already valid ESM). Requires first manually running each of the 12 files to
confirm none currently fails (a newly-wired-in failing test would itself need triage, which is
why this is a separate bounded task rather than a one-line fix bundled into PR #19).

## Status

`IDENTIFIED / NOT_FIXED / RECORDED`. No repository behavior changed by this document.
