# Implementation Rules

This document projects the existing D-090 enforcement rules for this repository. It does not invent new governance; see `AGENTS.md` for the authoritative invariant list.

## Fail-closed behavior

When an applicable D-090 invariant (see `AGENTS.md`) cannot be satisfied at runtime — missing authority revalidation, missing isolation guarantee, missing quota reservation, etc. — the system must fail closed (reject/block the effect) rather than proceed.

## Activation semantics

A control is only considered active once it is enforced in code and covered by a Reality Gate (RG-*) with real evidence, per `docs/engineering/ACCEPTANCE_CRITERIA.md`. Documenting an intended control is not activation.

## Smallest concrete implementation

Implement the smallest concrete mechanism that satisfies the applicable invariant for the current bounded task. Do not build generic frameworks or speculative abstractions ahead of a concrete, admitted requirement.

## No premature abstraction / framework

Do not introduce a new generic agent framework, plugin system, or cross-cutting abstraction layer as part of a bounded bootstrap or feature task unless the task contract explicitly authorizes it.

## Architecture escalation

If implementing a task would require changing existing architecture or expanding CR-V1 scope, stop and escalate (`ESCALATION_REQUIRED`) to the AI Commerce Brain instead of proceeding.

## Verification authority

Engineers may reach `IMPLEMENTED`. Only the AI Commerce Brain can move an item to `VERIFIED` or `COMPLETED`, and only with the applicable required evidence.

## Evidence requirements

No implementation item may be marked `VERIFIED` or `COMPLETED` without applicable real evidence (dependency installation, lockfile, dependency audit, typecheck, lint, tests, CI, runtime evidence, required security/Reality Gate evidence, as applicable). Documentation or synthetic evidence alone is not sufficient.

## Review rejection behavior

A change that violates an applicable D-090 invariant, or that claims passing evidence for a check that was not actually run, must be rejected in review regardless of how small the change is.
