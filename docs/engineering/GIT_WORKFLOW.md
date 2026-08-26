# Git / PR Workflow

This document projects the current AI Commerce engineering default for how repository
changes move from implementation to merge. It does not invent new governance; see
`AGENTS.md` for authority sources and the D-090 invariant list. Established 2026-08-26
per Founder instruction; applies to all engineering work in this repository going forward.

## Branching

- Never push directly to `main`. Emergency/hotfix direct push is the only exception, and
  it must be explicitly flagged as such with the reason recorded in the commit message
  and the durable task record — it is not a routine option.
- Use a separate feature/fix branch per bounded/coherent implementation. Do not
  accumulate multiple unrelated bounded implementations on one long-lived branch (a
  historical pattern on `eng/p0-026-job-run-safety-invariants`, retroactively covered by
  a single consolidation PR — see PR #7 — rather than split after the fact; new work
  does not repeat that pattern).
- If a branch's base is another open, unmerged branch (a stacked PR), state that
  dependency explicitly in the PR description and do not merge out of order.
- Do not open parallel, conflicting PRs against the same scope.

## Commits

- Commit at logical checkpoints within the same bounded task. Do not create excessive
  micro-commits, and do not open a separate PR for every small change within one
  coherent implementation.
- A PR must contain actually-implemented, tested code for its stated scope. A plan,
  analysis, or governance record is not implementation and does not by itself justify
  opening or advancing a PR.

## PR lifecycle

State model: `IMPLEMENTING` → `LOCAL VALIDATED` → `PUSHED` → `PR OPEN/DRAFT` →
`READY FOR REVIEW` → `BRAIN REVIEW` → `APPROVED` / `CHANGES REQUESTED` → `MERGED` →
`POST-MERGE VERIFIED` → `COMPLETED`.

- Open a PR as **Draft** if it is opened before implementation for its stated scope is
  complete. Mark **Ready for Review** only once implementation + tests + local
  typecheck/lint/build validation for that scope are done.
- Before marking Ready for Review, run the applicable checks (typecheck, lint, staging
  test suite, relevant build) and attach the results as validation evidence in the PR
  description — do not claim a check passed without having actually run it (this repeats
  the existing D-090 evidence-requirements rule, see `IMPLEMENTATION_RULES.md`).
- After a PR is opened, Brain reviews independently: GitHub diff, changed files,
  comments, head SHA, and checks. Engineers do not self-approve or self-declare a PR
  `APPROVED`/`COMPLETED` — see the `AGENTS.md` completion-state ceiling
  (`IMPLEMENTED` only).
- Do not merge a PR before Brain review completes, regardless of local check results.
- If Brain finds a defect, fix it on the same branch/PR, re-test, push, and wait for
  re-review. Do not open a new branch/PR to work around review feedback.
- A PR may be merged once Brain gives `PASS` and required checks are green.
- After merge, run any applicable deployment/readback/regression validation before
  closing the task as `COMPLETED`. `MERGED` alone is not `COMPLETED`.

## Reconciliation with existing task records

Prior to 2026-08-26, bounded engineering checkpoints on this repository were recorded as
durable Markdown records under `docs/exec-plans/active/` plus Drive DEC-138 evidence
bundles, with direct pushes to a long-lived branch and no PR. That evidence remains valid
and is not invalidated by this document. Going forward, the PR itself (diff, checks,
description) is the primary review surface; `docs/exec-plans/active/` records and Drive
bundles remain the durable, secret-free evidence trail referenced from the PR
description, not a substitute for opening a PR.
