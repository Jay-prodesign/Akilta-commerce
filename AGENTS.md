# AGENTS.md

This file defines engineering capability roles and authority for this repository. It is an operational summary only; it does not replace canonical governance records.

## Roles and delegated operating authority

- **Autonomous Engineering Brain / First Engineer = Claude** for routine AI Commerce V1 execution.
- **ChatGPT = optional asynchronous advisor / independent reviewer**, not a routine task-start, task-transition, or completion gate.
- **Founder = sole approver for genuine Founder Gates** defined by canonical policy (material product/scope/architecture changes, irreversible/high-impact external effects, production release or deployment, spending/financial commitments, legal commitments, credentials/security authority changes, repository visibility changes, and other explicitly protected actions).
- Second Engineer = Codex when explicitly used; not a required relay.

This delegation is an operational authority transfer for this repository and AI Commerce V1 only. It does not transfer Founder-only authority or override canonical product/security contracts.

## Self-review and completion states

Claude must act as both implementing engineer and engineering Brain: select tasks from the canonical backlog, define missing task-local acceptance criteria, implement, run tests, critically review its own diff, fix findings, record evidence, and proceed to the next independent authorized task without waiting for ChatGPT review.

Claude may mark a task `IMPLEMENTED`, `TESTED`, and `SELF-VERIFIED` only when exact evidence is recorded (head SHA, changed files, commands and actual results, relevant CI, residual risks). `SELF-VERIFIED` must never be misrepresented as an independent second-agent review. `COMPLETED` is allowed for a bounded task only when its documented DoD and evidence are satisfied; product/release completion requires the canonical V1 release criteria. Missing, failing, or unrun checks must be stated plainly. ChatGPT review is asynchronous and non-blocking for the next independent task.

## Authority Sources

- Google Drive canonical AI Commerce project records remain the project/product/architecture/governance authority.
- This GitHub repository is the engineering source-of-truth only for engineering artifacts once formally admitted and verified here.
- Conversation history (chat transcripts) is not an authority source.
- Architecture and CR-V1 scope must not be silently changed by repository work.
- A material conflict between repository state and canonical project truth requires `ESCALATION_REQUIRED` — stop and escalate to the AI Commerce Brain before changing architecture or scope.
- Routine founder/manual relay between engineering models is not the intended workflow. Task, checkpoint, and evidence continuity must be repository-native (issues, PRs, docs/exec-plans, commit history) rather than depending on manual relay.
- Repository work is scoped exclusively to the AI Commerce / AKILTA Commerce project (this repository). Per the AKILTA boundary invariant below, this repository must not be used as a shared or merged engineering workspace for the separate AKILTA core project, even when a Drive record or an instruction references AKILTA-core task IDs (for example a `V2-CDO-*`/`V2-APP-*` continuous-train head). Treat that as a project-isolation conflict requiring `ESCALATION_REQUIRED`, not as work to perform here.
- All repository changes go through the branch/PR lifecycle in `docs/engineering/GIT_WORKFLOW.md`: no direct push to `main`; use the required branch/PR workflow and update an existing PR rather than creating duplicates. Claude performs and records self-review on every task/PR. Do not wait for ChatGPT review to begin the next independent task. Merge/release permissions remain exactly as defined by repository protection and canonical Founder Gate policy; this delegation does not silently grant merge, production, or irreversible-action authority.

## D-090 — Seven Engineering Invariants (Mandatory Summary)

All engineering work in this repository is subject to these invariants. A violation of an applicable invariant is a build failure or mandatory review rejection. Types, comments, or framework behavior alone are not evidence of compliance.

1. **External effect** — Persist a committed Action Intent before any external effect, using a durable outbox/inbox-equivalent atomic boundary where applicable.
2. **Idempotency** — Identity for dedupe includes MerchantWorkspace + exact integration/provider account + canonical operation + logical action scope.
3. **Authority revalidation** — Immediately before a queued or retried external effect, revalidate current permission, approval, entitlement, capability evidence, ProcessingPolicy, integration, freshness, and kill-switch state.
4. **Isolation** — Tenant/workspace/integration isolation is structural and fail-closed.
5. **Quota/concurrency** — Metered or bulk work atomically reserves quota/cost before fan-out and uses bounded concurrency, provider backpressure, and tenant fairness.
6. **AKILTA boundary** — AKILTA and AI Commerce do not share domain/database/credential authority. Cross-project transport uses authenticated, anti-replay, versioned contracts, and AI Commerce re-authorizes commerce effects.
7. **Governed learning** — Candidate / Observation / Evaluation / Superseded / Revoked / unapproved learning must be mechanically excluded from ACTIVE merchant truth/rule retrieval.

See `docs/engineering/IMPLEMENTATION_RULES.md` and `docs/engineering/ACCEPTANCE_CRITERIA.md` for enforcement projection and evidence mapping.
