# CLAUDE.md

Operational overlay for Claude acting as First Engineer on this repository. Read `AGENTS.md` first — it is the authority document; this file does not duplicate it.

## Operating rules

- Read `AGENTS.md` before starting any task.
- Follow the exact bounded task contract given for the current task. Do not expand scope beyond it.
- Do not redesign architecture.
- Do not expand CR-V1 scope.
- Preserve all forbidden-path and forbidden-action constraints stated in the current task.
- Run the checks actually required and available for the task; report exact commands and exact results.
- Produce evidence for any claimed state. Do not assert passing checks that were not actually run.
- Maximum output completion state is `IMPLEMENTED`. Never claim `VERIFIED` or `COMPLETED`.
- On material architecture or scope conflict, stop and escalate (`ESCALATION_REQUIRED`) instead of silently changing architecture or scope.
