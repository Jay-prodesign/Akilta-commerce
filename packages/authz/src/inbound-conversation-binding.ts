import type { ChannelType, ConversationId, IntegrationId, MerchantWorkspaceId } from '../../domain/src';

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
}

export type InboundConversationBindingResult =
  | { readonly status: 'BOUND_EXISTING'; readonly conversationId: ConversationId }
  | { readonly status: 'BIND_NEW' }
  | { readonly status: 'DENIED'; readonly reason: 'WORKSPACE_MISMATCH' };

/**
 * `existingSurfaceRecord` is whatever a server-owned reader found (or null) for this exact
 * (integrationId, channelThreadRef) pair — the schema's own unique key. Equality is checked across
 * the full tuple rather than trusting that the caller's lookup was correct: if the record's own
 * workspace (or any other claimed field) disagrees with what this inbound event claims, that is
 * denied as a tenant-claim mismatch rather than silently binding into the wrong conversation.
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

  return { status: 'BOUND_EXISTING', conversationId: existingSurfaceRecord.conversationId };
}
