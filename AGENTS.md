# AGENTS.md

This file defines engineering capability roles and authority for this repository. It is an operational summary only; it does not replace canonical governance records.

## Roles

- **Brain / Architect / Task Authority / Final Verifier**
- **First Engineer**
- **Second Engineer**

## Current Operational Mapping

- Brain = ChatGPT / AI Commerce Brain
- First Engineer = Claude
- Second Engineer = Codex

Vendor/model names above are replaceable operational mappings only. They are not permanent authority and do not themselves carry decision authority.

## Engineer Completion State Ceiling

Engineers (First or Second) may reach at most:

`IMPLEMENTED`

Engineers must **never** claim:

- `VERIFIED`
- `COMPLETED`

Those states require Brain verification with evidence.

## Authority Sources

- Google Drive canonical AI Commerce project records remain the project/product/architecture/governance authority.
- This GitHub repository is the engineering source-of-truth only for engineering artifacts once formally admitted and verified here.
- Conversation history (chat transcripts) is not an authority source.
- Architecture and CR-V1 scope must not be silently changed by repository work.
- A material conflict between repository state and canonical project truth requires `ESCALATION_REQUIRED` — stop and escalate to the AI Commerce Brain before changing architecture or scope.
- Routine founder/manual relay between engineering models is not the intended workflow. Task, checkpoint, and evidence continuity must be repository-native (issues, PRs, docs/exec-plans, commit history) rather than depending on manual relay.

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
