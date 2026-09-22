# AC-META-WIRING-GUARD-001 — Enforce dispatch-only access to MetaWhatsAppPort

Provisional task ID. Record-only: this document does **not** implement an enforcement
mechanism. It exists so the guard is tracked as its own bounded unit before real
application code starts wiring up P0-017, rather than being discovered as a defect later.

## Origin

Raised during Brain's focused review of PR #21 (P0-017 Lane-A #2, merged as `a41d8a7` into
`feat/meta-whatsapp-provider-neutral-port`, 2026-09-22). Not a blocker for PR #21 itself —
there is no real caller of this code yet — but flagged for enforcement before one exists.

## The gap

`connectors/meta-whatsapp/src/dispatch.ts`'s `dispatchMetaWhatsAppSend()` is the only place in
the current codebase that calls `port.sendMessage()` after first staging a committed Action
Intent (`stageJobWithOutbox`) and routing delivery through the exactly-once-effect registry
(`deliverOutboxRecord`) — this is what makes D-090 I1 (external effect only after a committed
Action Intent) and I2 (idempotent replay) hold for an outbound WhatsApp send.

However, `MetaWhatsAppPort` and `MockMetaWhatsAppPort.sendMessage()` (`connectors/meta-whatsapp/src/port.ts`)
are still directly exported from `connectors/meta-whatsapp/src/index.ts` (via `export * from './port'`).
Nothing in the type system or module boundary prevents a future caller from importing the port
directly and calling `sendMessage()` without ever going through `dispatchMetaWhatsAppSend()` —
which would silently skip the Action-Intent/outbox guarantees this whole P0-017 Lane-A #2 slice
exists to provide.

## Requirement

**Future application wiring must not call `MetaWhatsAppPort.sendMessage()` directly from
application/route/handler code.** Production send paths must go through
`dispatchMetaWhatsAppSend()`, or an equivalent Action-Intent/outbox-gated dispatcher if one
supersedes it later.

## Explicitly out of scope for this record

- No code change is made here. `port.ts`'s direct export is left as-is.
- No lint rule, module-boundary restriction, or access-control mechanism is implemented.
- No claim is made about exactly how enforcement should work (candidates below are
  unevaluated options, not a decision).

## Candidate enforcement shapes (undecided, for the follow-up bounded task)

- Stop re-exporting `MetaWhatsAppPort`/`MockMetaWhatsAppPort` from `connectors/meta-whatsapp/src/index.ts`'s
  public barrel; keep them reachable only via a direct `./port` import path that application code
  is not expected to reach for, while `dispatch.ts` continues to import them internally.
- An ESLint rule (e.g. `no-restricted-imports` scoped to application/route layers once they
  exist) blocking direct imports of `connectors/meta-whatsapp/src/port` outside
  `connectors/meta-whatsapp/src/` and its own tests.
- An architecture/README note plus code review checklist item, if the application layer
  consuming this connector turns out to be small enough that tooling enforcement is overkill.

The right shape depends on what the eventual application-layer wiring for CR-V1's WhatsApp
Support & Sales actually looks like, which does not exist in the repository yet — deciding now
would be guessing ahead of that design.

## Status

`IDENTIFIED / NOT_ENFORCED / RECORDED`. Must be resolved (in whichever shape is chosen) before
real application code is wired to send outbound WhatsApp messages — i.e. before P0-017 moves
past Lane A into any lane that has a real caller of `sendMessage()`. No repository behavior
changed by this document.
