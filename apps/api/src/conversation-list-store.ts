import {
  channelType,
  conversationStatus,
  internalId,
  utcTimestamp,
  type ChannelType,
  type ConversationId,
  type ConversationOwnershipState,
  type ConversationStatus,
  type CustomerIdentityId,
  type MerchantWorkspaceId,
  type UserId,
  type UtcTimestamp,
} from '../../../packages/domain/src';
import { parseOwnershipState } from './conversation-ownership-store';

/**
 * AC-CCIA-001 ("conversation.list" Control Center read operation) — persistence adapter for a
 * bounded, most-recent-first list of a workspace's conversations. Reads the real
 * `(merchant_workspace_id, last_message_at DESC)` index already defined on the `conversations`
 * table (migrations/0001_foundation.sql) — no new index or query shape is invented here.
 *
 * No cursor-based pagination: `transport-contracts.ts` already has `OpaqueCursor`/
 * `validateDecodedCursorScope` scope-validation scaffolding, but no encode/decode codec exists
 * anywhere in this repository yet, and no route uses it. Inventing a cursor wire format is a
 * product/transport decision this bounded unit does not make; this adapter instead follows the
 * same bounded-limit precedent as `customer-orders-store.ts` (a plain `LIMIT`, most-recent-first,
 * no claim of exhaustive pagination).
 *
 * CLAIM CEILING: this is a summary row, not the full `Conversation` read — `channelThreadRef` and
 * `integrationId` are deliberately left off the list view (no raw provider thread reference needs
 * to leave this adapter for a list screen); a caller that needs those already has
 * `GET /v1/conversations/{id}` (conversation-handoff-route.ts's read handler).
 */

export interface ConversationListQueryExecutor {
  query(sql: string, params: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

const SELECT_RECENT_CONVERSATIONS = `
  SELECT conversation_id, channel, customer_identity_id, ownership_state, ownership_epoch,
         assigned_user_id, status, last_message_at, last_customer_message_at, last_outbound_at
  FROM conversations
  WHERE merchant_workspace_id = $1
  ORDER BY last_message_at DESC NULLS LAST, conversation_id DESC
  LIMIT $2
`;

export const CONVERSATION_LIST_DEFAULT_LIMIT = 50;

export interface ConversationListRow {
  readonly conversationId: ConversationId;
  readonly channel: ChannelType;
  readonly customerIdentityId?: CustomerIdentityId;
  readonly ownershipState: ConversationOwnershipState;
  readonly ownershipEpoch: number;
  readonly assignedUserId?: UserId;
  readonly status: ConversationStatus;
  readonly lastMessageAt?: UtcTimestamp;
  readonly lastCustomerMessageAt?: UtcTimestamp;
  readonly lastOutboundAt?: UtcTimestamp;
}

export type ConversationListReadOutcome =
  | { readonly status: 'FOUND'; readonly conversations: readonly ConversationListRow[] }
  | { readonly status: 'STORE_ERROR' };

function timestampOrUndefined(value: unknown): UtcTimestamp | undefined {
  return typeof value === 'string' || value instanceof Date ? utcTimestamp(value) : undefined;
}

function rowToConversationListRow(row: Record<string, unknown>): ConversationListRow {
  const lastMessageAt = timestampOrUndefined(row.last_message_at);
  const lastCustomerMessageAt = timestampOrUndefined(row.last_customer_message_at);
  const lastOutboundAt = timestampOrUndefined(row.last_outbound_at);
  return {
    conversationId: internalId(String(row.conversation_id), 'Conversation'),
    channel: channelType(String(row.channel)),
    ...(typeof row.customer_identity_id === 'string'
      ? { customerIdentityId: internalId(row.customer_identity_id, 'CustomerIdentity') }
      : {}),
    ownershipState: parseOwnershipState(row.ownership_state),
    ownershipEpoch: Number(row.ownership_epoch),
    ...(typeof row.assigned_user_id === 'string' ? { assignedUserId: internalId(row.assigned_user_id, 'User') } : {}),
    status: conversationStatus(String(row.status)),
    ...(lastMessageAt !== undefined ? { lastMessageAt } : {}),
    ...(lastCustomerMessageAt !== undefined ? { lastCustomerMessageAt } : {}),
    ...(lastOutboundAt !== undefined ? { lastOutboundAt } : {}),
  };
}

export interface ConversationListStore {
  readRecentConversations(merchantWorkspaceId: MerchantWorkspaceId, limit?: number): Promise<ConversationListReadOutcome>;
}

export function createConversationListStore(executor: ConversationListQueryExecutor): ConversationListStore {
  return {
    async readRecentConversations(merchantWorkspaceId, limit = CONVERSATION_LIST_DEFAULT_LIMIT) {
      let rows: readonly Record<string, unknown>[];
      try {
        const result = await executor.query(SELECT_RECENT_CONVERSATIONS, [merchantWorkspaceId, limit]);
        rows = result.rows;
      } catch {
        return { status: 'STORE_ERROR' };
      }

      try {
        return { status: 'FOUND', conversations: rows.map(rowToConversationListRow) };
      } catch {
        return { status: 'STORE_ERROR' };
      }
    },
  };
}
