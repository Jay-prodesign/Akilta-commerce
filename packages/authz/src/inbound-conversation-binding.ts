import type {
  ChannelType,
  ConversationId,
  ConversationOwnershipState,
  IntegrationId,
  MerchantWorkspaceId,
} from '../../domain/src';

/**
 * SC-05 (Conversation Core / AC-CONV-CORE-106) — server-owned conversation/workspace/surface binding.
 * Grounded in the D108_CLOSURE_PLAN SC-05 row's required_delta ("separating conversation/workspace/
 * surface binding ... from ... ownership/handoff epoch") and acceptance tests ("tenant/surface
 * pre-bind; duplicate/out-of-order inbound").
 *
 * The schema already enforces the hard invariant this decision relies on:
 * `UNIQUE (integration_id, channel_thread_ref)` plus `FOREIGN KEY (integration_id,
 * merchant_workspace_id) REFERENCES integrations(...)` (migrations/0001_foundation.sql, conversations
 * table — DB-01/DB-02 contract-tested). That means a conversation found by (integrationId,
 * channelThreadRef) can only ever belong to the one workspace its integration is actually bound to.
 * This function's job is narrow: given what an inbound event CLAIMS (merchantWorkspaceId alongside
 * the surface key) and what the already-looked-up existing conversation record (if any) actually is,
 * decide whether to bind to it, signal that a new conversation should be created, or fail closed on a
 * workspace claim that disagrees with the record the surface key actually resolves to. It never
 * performs the lookup itself (that is a server-owned reader, a later adapter concern, same
 * pure-resolver-before-adapter split as every prior unit this session) and never creates a
 * conversation (new-conversation defaults — AI_ACTIVE, epoch 0 — are a trivial constant, not a
 * decision, and belong to that same later adapter).
 *
 * Inbound duplicate/out-of-order handling is explicitly NOT reimplemented here: it already exists as
 * `eventDeduplicationKey` / `classifyDelivery` / `shouldAdvanceMonotonicProjection`
 * (packages/events/src/operational.ts, P0-004, pre-existing and unmodified). A conversation-bound
 * inbound event composes this binding decision with those functions unchanged — see
 * tests/security/inbound-conversation-binding.spec.ts for the composed scenarios that close the
 * "duplicate/out-of-order inbound" acceptance criteria without duplicating that logic.
 *
 * CLOSED-thread policy (Founder decision, SC-05 closure slice, no new REOPEN transition for V1):
 *  1. CLOSED is already terminal in `conversation-ownership-transition.ts` — no trigger is defined for
 *     it, so every transition attempt against a CLOSED record is denied TERMINAL_STATE. Untouched here.
 *  2. When the surface-keyed existing record is CLOSED, this function returns `BIND_NEW_CONTINUATION`
 *     rather than `BOUND_EXISTING` — the caller must create a genuinely NEW conversation entity (new
 *     `ConversationId`, fresh ownership record at AI_ACTIVE/epoch 0, independently re-resolved
 *     workspace/surface/customer-verification/permissions/policies), never resume the closed one.
 *  3. `BIND_NEW_CONTINUATION` carries only `precedingConversationId` — the closed conversation's own id
 *     — as the "authorized, auditable continuity reference." It carries no other field. This is what
 *     makes "never inherit customer verification, authorization, pending actions, queued sends, human
 *     assignment or AI execution authority from the closed thread" hold BY CONSTRUCTION: there is no
 *     field on this result type through which any of that could flow. The caller resolves every one of
 *     those axes fresh for the new conversation, exactly as it would for a first-ever inbound contact.
 *  4. Fail-closed ordering is preserved: a workspace/integration/channel/thread-ref claim mismatch is
 *     checked, and denies, BEFORE the closed-state check — an unauthorized claim never reaches far
 *     enough to open a new conversation merely because the matched record happens to be closed.
 *  5. Deliberately OUT OF SCOPE for this pure-decision slice (left to a later, separately-built
 *     persistence adapter unit, same split as every prior SC-02/SC-05 unit): actually persisting the
 *     new continuation conversation needs a schema change, because today's
 *     `UNIQUE (integration_id, channel_thread_ref)` constraint is a plain (non-partial) unique index
 *     and would reject a second row sharing the same external thread ref even when the first is
 *     CLOSED. The adapter unit must replace that with a partial unique index scoped to live
 *     (non-CLOSED) conversations, or an equivalent CAS-safe mechanism, before a continuation can
 *     actually be written. This slice only defines the correct decision; it performs no migration.
 *  6. Inbound duplicate/replay handling for the closed-surface case is the same composition already
 *     established for the live case (see point above): the caller dedupes via the existing
 *     `classifyDelivery` BEFORE ever calling this function, so a replayed/duplicate inbound event never
 *     reaches — and therefore never redundantly re-triggers — a `BIND_NEW_CONTINUATION` decision.
 */

export interface InboundConversationSurfaceClaim {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly integrationId: IntegrationId;
  readonly channel: ChannelType;
  readonly channelThreadRef: string;
}

export interface ExistingConversationSurfaceRecord {
  readonly conversationId: ConversationId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly integrationId: IntegrationId;
  readonly channel: ChannelType;
  readonly channelThreadRef: string;
  readonly ownershipState: ConversationOwnershipState;
}

export type InboundConversationBindingResult =
  | { readonly status: 'BOUND_EXISTING'; readonly conversationId: ConversationId }
  | { readonly status: 'BIND_NEW' }
  | { readonly status: 'BIND_NEW_CONTINUATION'; readonly precedingConversationId: ConversationId }
  | { readonly status: 'DENIED'; readonly reason: 'WORKSPACE_MISMATCH' };

/**
 * Decision order, each a hard gate the next never reconsiders:
 *  1. No existing surface record at all -> `BIND_NEW` (a genuinely first-ever contact on this surface,
 *     no predecessor to link).
 *  2. Tuple mismatch between the claim and the surface-keyed record -> `DENIED(WORKSPACE_MISMATCH)`,
 *     checked across the FULL tuple rather than trusting that the caller's lookup was correct, and
 *     checked BEFORE the closed-state branch so a bad claim can never ride in on a closed record.
 *  3. The record's `ownershipState` is `CLOSED` -> `BIND_NEW_CONTINUATION`, carrying only the closed
 *     record's own id as the continuity reference (see the CLOSED-thread policy above).
 *  4. Otherwise -> `BOUND_EXISTING`, unchanged from before this policy existed.
 */
export function resolveInboundConversationBinding(
  claim: InboundConversationSurfaceClaim,
  existingSurfaceRecord: ExistingConversationSurfaceRecord | null,
): InboundConversationBindingResult {
  if (!existingSurfaceRecord) {
    return { status: 'BIND_NEW' };
  }

  if (
    existingSurfaceRecord.merchantWorkspaceId !== claim.merchantWorkspaceId ||
    existingSurfaceRecord.integrationId !== claim.integrationId ||
    existingSurfaceRecord.channel !== claim.channel ||
    existingSurfaceRecord.channelThreadRef !== claim.channelThreadRef
  ) {
    return { status: 'DENIED', reason: 'WORKSPACE_MISMATCH' };
  }

  if (existingSurfaceRecord.ownershipState === 'CLOSED') {
    return { status: 'BIND_NEW_CONTINUATION', precedingConversationId: existingSurfaceRecord.conversationId };
  }

  return { status: 'BOUND_EXISTING', conversationId: existingSurfaceRecord.conversationId };
}
