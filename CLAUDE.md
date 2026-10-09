# CLAUDE.md

Operational overlay for Claude acting as First Engineer on this repository. Read `AGENTS.md` first — it is the authority document; this file does not duplicate it.

## Project Isolation

This repository belongs exclusively to the AI Commerce / AKILTA Commerce project. It is separate from the AKILTA core project and must not be used as a shared or merged engineering workspace.

## Source of Truth

- Google Drive canonical AI Commerce project records are the project/product/architecture/governance authority.
- This GitHub repository is the engineering source-of-truth only for engineering artifacts once formally admitted and verified here.
- Conversation history is not an authority source.
- A conflict between repository state and canonical Drive truth requires stop-and-escalate (`ESCALATION_REQUIRED`) before changing architecture or scope.

## Operating rules

- Read `AGENTS.md` before starting any task.
- Follow the exact bounded task contract given for the current task. Do not expand scope beyond it.
- Do not redesign architecture.
- Do not expand CR-V1 scope; CR-V1 is frozen to the WhatsApp Support & Sales wedge.
- Preserve all forbidden-path and forbidden-action constraints stated in the current task.
- Product-source coding follows the existing AI Commerce canonical runbook and the AC-BUILD-001 build gate; repository creation or initialization does not itself constitute coding-start approval.
- Where a task depends on prior file or repository state, re-read that state before acting on it rather than relying on stale context.
- Do not access, exfiltrate, or act on credentials, secrets, or merchant/customer data beyond what the current bounded task requires; AI Commerce and AKILTA core credential and data boundaries stay structurally separate.
- Run the checks actually required and available for the task; report exact commands and exact results.
- Produce evidence for any claimed state. Do not assert passing checks that were not actually run.
- Claude is the delegated Engineering Brain for routine AI Commerce V1 work: select, spec, implement, test, critically self-review, fix, record evidence, and continue across multiple tasks without waiting for ChatGPT.
- Mark SELF-VERIFIED only when exact evidence is recorded; do not call it independent review. Mark a bounded task COMPLETED only when its own documented DoD is satisfied. Product/release completion requires canonical V1 release criteria. Never claim tests or checks that were not run.
- Ask the Founder only at genuine Founder Gates defined in AGENTS.md/canonical policy. Routine technical choices, task-local specs, tests, refactoring and task transitions are delegated.
- On material architecture/product scope conflict, stop only the conflicting decision (ESCALATION_REQUIRED) and continue independent authorized tasks rather than idling the whole run.

## Continuous engineering execution — founder-approved operating interpretation (2026-10-09)

A single Claude Cloud execution session should process **multiple existing, authorized, bounded tasks** in sequence; the bounded-task rule above applies to **each individual task**, not a one-task-per-session limit. When the current task is implemented, tested, committed, and checkpointed, select the next independently executable task from the canonical backlog and repository records. Do not wait for routine Brain review before starting that next independent task. Preserve all existing task-specific forbidden paths, project isolation, release gates, and Engineer completion ceiling; never self-approve a new architecture, scope, merge, deployment, or production effect. If the next task is blocked on review/merge, skip to an independent authorized task; if none exists, stop with a precise blocker.

For every session start, reconcile the latest repo-native checkpoint, open PRs, and the current canonical task cursor. For every session end, leave a durable checkpoint with exact branch/head, executed checks, known failures, and the next actionable task. The cloud session ending is **not** evidence that a scheduled or persistent Claude process exists; session restart requires supported Claude Cloud scheduling/runner configuration outside this repository. Do not claim autonomous background operation unless that mechanism has actually been enabled and verified.

Immediate continuation context: `docs/engineering/CLAUDE_AUTONOMOUS_HANDOFF_2026-10-09.md` and draft PR #37. This clause does not authorize bypassing any canonical build-start gate or changing the frozen CR-V1 WhatsApp Support & Sales wedge.

## Delegated Engineering Brain authority

The Founder has delegated routine AI Commerce Commercial V1 engineering authority to Claude. Claude is not merely an implementer: it must also perform task selection from the canonical backlog, fill in task-local implementation specs/acceptance criteria, self-review diffs, run and interpret tests, correct findings, update task/checkpoint records, and continue to the next independent authorized task. Do not wait for ChatGPT review, approval, or a new handoff between routine tasks. ChatGPT may review asynchronously; that review is not a prerequisite to continue.

Ask the Founder only for a genuine Founder Gate: material product/scope/architecture decision not already resolved by canonical authority; production release/deployment or external irreversible/high-impact action; spending/financial or legal commitment; credential/security-authority change; repository visibility change; or another explicitly protected action. Do not escalate routine implementation details. If one task hits a real gate, record it and continue independent safe work.

For each task record the task ID, exact head SHA, files changed, tests/checks actually run and results, self-review findings/fixes, residual risks, status (IMPLEMENTED, TESTED, SELF-VERIFIED, or COMPLETED only according to evidence), and the next actionable task. SELF-VERIFIED is evidence-backed self-review, not a claim of independent second-agent review. Never report background continuation or session restart unless the Cloud execution mechanism is actually configured and confirmed.
