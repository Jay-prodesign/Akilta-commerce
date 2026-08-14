# AI Commerce

Private engineering repository for **AI Commerce**.

Repository name: `akilta-commerce`

## Product Scope

AI Commerce is a governed commerce execution system.

The current frozen Commercial Ready V1 (CR-V1) sellable wedge is:

**WhatsApp Support & Sales**

CR-V1 scope and the existing canonical architecture must not be expanded from repository work.

## Project Boundary

This repository belongs exclusively to the AI Commerce / AKILTA Commerce project. It is separate from the AKILTA core project and must not be used as a shared or merged engineering workspace.

## Current Repository State

This repository is currently at the bootstrap stage.

No staged product source is automatically considered verified, completed, or release-ready.

When existing Drive-staged source is admitted into this repository, its initial state must be:

`IMPORTED_STAGED_UNVERIFIED / NOT_RELEASEABLE`

Repository transfer or checksum parity proves provenance/transfer only. It does not prove implementation correctness or product maturity.

## Source of Truth

Project/product/architecture/governance truth:
AI Commerce canonical project records in Google Drive.

Engineering truth:
This GitHub repository, once engineering artifacts are formally admitted and verified.

Conversation history is not an authority source.

If repository truth and current canonical project truth conflict, stop and escalate to the AI Commerce Brain before changing architecture or scope.

## Engineering Authority

- AI Commerce Brain / ChatGPT — Architect, Task Authority, Final Verifier
- First Engineer — Claude
- Second Engineer — Codex

Engineers may reach:

`IMPLEMENTED`

Final states:

`VERIFIED`
`COMPLETED`

require AI Commerce Brain verification and required evidence.

## Verification Standard

No implementation item may be marked VERIFIED or COMPLETED without the applicable real evidence, including where relevant:

- dependency installation
- lockfile
- dependency audit
- typecheck
- lint
- tests
- CI
- runtime evidence
- required security / Reality Gate evidence

Documentation or synthetic evidence alone is not sufficient.

## Local Setup

Not established yet.

Do not invent local setup instructions until the actual repository dependencies, package manager, lockfile and runtime requirements are admitted and verified.

## Non-Goals

This repository bootstrap does NOT authorize:

- CR-V1 scope expansion
- a new architecture
- a new generic agent framework
- a new repository
- speculative infrastructure
- automatic promotion of staged source to VERIFIED or COMPLETED
- release-readiness claims
- production deployment

## Current Engineering Gate

Product-source coding must follow the existing AI Commerce canonical runbook and AC-BUILD-001 gate.

Repository creation or initialization does not itself constitute coding-start approval.
