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
- Maximum output completion state is `IMPLEMENTED`. Never claim `VERIFIED` or `COMPLETED`.
- On material architecture or scope conflict, stop and escalate (`ESCALATION_REQUIRED`) instead of silently changing architecture or scope.
