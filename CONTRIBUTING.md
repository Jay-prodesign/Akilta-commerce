# Contributing

## Branching

- `main` is the protected target branch.
- All feature or fix work happens on short-lived branches created from `main`.
- No direct product-feature commits to `main`. Bounded governance/bootstrap changes may land directly on `main` only when explicitly authorized by the current task contract.

## Pull requests

- Normal work uses a PR flow into `main`.
- Required tests, checks, and evidence (per `docs/engineering/ACCEPTANCE_CRITERIA.md` and the current task's evidence requirements) must be attached to the PR before merge.
- Do not merge a PR whose claimed checks were not actually run.

## Completion states

- Engineers (First or Second Engineer) may mark work at most `IMPLEMENTED`.
- `VERIFIED` and `COMPLETED` states require AI Commerce Brain verification with evidence, and must not be self-assigned by an engineer.

See `AGENTS.md` for the full authority and role model.
