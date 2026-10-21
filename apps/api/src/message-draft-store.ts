import {
  internalId,
  utcTimestamp,
  type ConversationId,
  type IdempotencyKey,
  type MerchantWorkspaceId,
  type MessageDraftId,
  type UserId,
  type UtcTimestamp,
} from '../../../packages/domain/src';

/**
 * AC-CCIA-001 ("message.draft" Control Center write operation) — persistence adapter for staging a
 * human-authored draft reply against an existing conversation (`message_drafts` table,
 * migrations/0001_foundation.sql). Unlike conversation ownership's handoff/return-to-ai transitions,
 * creating a draft has no CAS/epoch state machine to resolve — it is a plain, referentially-checked
 * INSERT, not a transition of an existing row — so no new pure decision function is introduced here.
 *
 * `source_type` is hardcoded to `'HUMAN'`: this route is the Control Center's own staff-authored
 * draft surface. AI-authored suggestions are `MessageSuggestion` (packages/domain/src/conversation.ts)
 * — a structurally different, not-yet-wired-to-HTTP concept this unit does not touch or conflate.
 *
 * Idempotency: `message_drafts` has no `idempotency_key` column, so — same disclosed limitation as
 * every other mutation route this session (conversation-ownership-store.ts et al.) — a durable
 * idempotency ledger is not built here either. `appliedIdempotencyKeys` is an injected
 * `ReadonlyMap`; a key already present there replays its recorded outcome instead of inserting
 * again. Without a real backing store for that map (not yet built anywhere in this codebase), two
 * concurrent requests sharing an idempotency key the caller has not yet recorded can both insert —
 * an accepted, explicitly-disclosed gap, not a silent one.
 *
 * Referential check: conversation existence is verified by a plain `SELECT` before the insert
 * (same technique as conversation-ownership-store.ts's `readCurrentRow`), rather than relying on the
 * table's FK constraint and inspecting the driver's error code — keeping this adapter's error
 * handling uniform with the rest of the codebase instead of introducing Postgres-error-code parsing.
 */

export interface MessageDraftQueryExecutor {
  query(sql: string, params: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

const SELECT_CONVERSATION_EXISTS = 'SELECT 1 FROM conversations WHERE conversation_id = $1 AND merchant_workspace_id = $2';

const INSERT_DRAFT = `
  INSERT INTO message_drafts
    (draft_id, conversation_id, merchant_workspace_id, source_type, proposed_text, status, created_by, created_at, updated_at)
  VALUES ($1, $2, $3, 'HUMAN', $4, 'DRAFT', $5, now(), now())
  RETURNING draft_id, proposed_text, created_by, created_at
`;

export interface MessageDraftRecord {
  readonly draftId: MessageDraftId;
  readonly conversationId: ConversationId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly proposedText: string;
  readonly status: 'DRAFT';
  readonly createdByUserId: UserId;
  readonly createdAt: UtcTimestamp;
}

export type MessageDraftCreateOutcome =
  | { readonly status: 'CREATED'; readonly record: MessageDraftRecord }
  | { readonly status: 'ALREADY_APPLIED'; readonly record: MessageDraftRecord }
  | { readonly status: 'NO_EXISTING_CONVERSATION' }
  | { readonly status: 'STORE_ERROR' };

function rowToRecord(
  row: Record<string, unknown>,
  conversationId: ConversationId,
  merchantWorkspaceId: MerchantWorkspaceId,
): MessageDraftRecord {
  const createdAtRaw = row.created_at;
  if (typeof createdAtRaw !== 'string' && !(createdAtRaw instanceof Date)) {
    throw new Error('message_drafts row is missing a usable created_at value');
  }
  return {
    draftId: internalId(String(row.draft_id), 'MessageDraft'),
    conversationId,
    merchantWorkspaceId,
    proposedText: String(row.proposed_text),
    status: 'DRAFT',
    createdByUserId: internalId(String(row.created_by), 'User'),
    createdAt: utcTimestamp(createdAtRaw),
  };
}

export interface MessageDraftStore {
  createDraft(
    conversationId: ConversationId,
    merchantWorkspaceId: MerchantWorkspaceId,
    proposedText: string,
    createdByUserId: UserId,
    idempotencyKey: IdempotencyKey,
    appliedIdempotencyKeys: ReadonlyMap<IdempotencyKey, MessageDraftRecord>,
  ): Promise<MessageDraftCreateOutcome>;
}

export function createMessageDraftStore(executor: MessageDraftQueryExecutor): MessageDraftStore {
  return {
    async createDraft(conversationId, merchantWorkspaceId, proposedText, createdByUserId, draftIdempotencyKey, appliedIdempotencyKeys) {
      const priorOutcome = appliedIdempotencyKeys.get(draftIdempotencyKey);
      if (priorOutcome) {
        return { status: 'ALREADY_APPLIED', record: priorOutcome };
      }

      try {
        const existsResult = await executor.query(SELECT_CONVERSATION_EXISTS, [conversationId, merchantWorkspaceId]);
        if (existsResult.rows.length === 0) {
          return { status: 'NO_EXISTING_CONVERSATION' };
        }
      } catch {
        return { status: 'STORE_ERROR' };
      }

      try {
        const draftId = internalId(crypto.randomUUID(), 'MessageDraft');
        const insertResult = await executor.query(INSERT_DRAFT, [
          draftId,
          conversationId,
          merchantWorkspaceId,
          proposedText,
          createdByUserId,
        ]);
        const row = insertResult.rows[0];
        if (!row) return { status: 'STORE_ERROR' };
        return { status: 'CREATED', record: rowToRecord(row, conversationId, merchantWorkspaceId) };
      } catch {
        return { status: 'STORE_ERROR' };
      }
    },
  };
}
