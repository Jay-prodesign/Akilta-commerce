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
import type { IdempotencyLedgerStore } from './idempotency-ledger-store';

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
 * Idempotency is now backed by the durable `idempotency-ledger-store.ts` (previously an injected,
 * always-empty `ReadonlyMap` — that gap is now closed for this route specifically). A replay is
 * recognized before any INSERT is attempted. Two residual gaps remain, explicitly accepted rather
 * than silently hidden:
 *  1. TOCTOU: `message_drafts` itself has no unique constraint on idempotency key, so two concurrent
 *     requests racing on the SAME key can both pass the conversation-existence check and both INSERT
 *     a real row — the ledger's conflict-safe `record()` then ensures only ONE of those rows is ever
 *     reported back to any caller (the race loser's own just-inserted row is silently orphaned, not
 *     corrected or deleted). Closing that fully would require a real unique constraint on
 *     `message_drafts`, a separate schema change this unit does not make.
 *  2. If `ledger.record()` itself fails (`LEDGER_WRITE_FAILED`) after the INSERT already succeeded,
 *     the key is never actually recorded — a client that follows ordinary idempotent-retry semantics
 *     and resends the exact same request with the same key will NOT replay; `tryGet` still returns
 *     NOT_FOUND, the conversation-exists check passes again, and a second real row is inserted with a
 *     new `draftId`. This is a real, not merely theoretical, duplicate-on-retry window, not just the
 *     narrower same-instant race in (1). Closing it would require either a transaction wrapping the
 *     INSERT and the ledger write atomically (no transaction primitive exists anywhere in this
 *     codebase yet — introducing one is new infrastructure, out of scope for this adapter) or a
 *     bounded retry/reconciliation policy (itself a reserved, not-yet-selected concern — see the
 *     canonical SC-09 workstream's WORK-05 bounded-retry-budget requirement). Accepted as a known,
 *     narrow-window residual risk rather than engineered around here.
 *
 * Referential check: conversation existence is verified by a plain `SELECT` before the insert
 * (same technique as conversation-ownership-store.ts's `readCurrentRow`), rather than relying on the
 * table's FK constraint and inspecting the driver's error code — keeping this adapter's error
 * handling uniform with the rest of the codebase instead of introducing Postgres-error-code parsing.
 */

const MESSAGE_DRAFT_OPERATION_KEY = 'message.draft';

/**
 * The ledger's own primary key is (operationKey, merchantWorkspaceId, idempotencyKey) — it has no
 * conversationId column. Without scoping the key string itself, two different conversations in the
 * same workspace reusing the same raw caller-supplied idempotency key would collide: a replay for
 * conversation B would wrongly return conversation A's cached draft. Same collision-safety technique
 * as `customer-identity-link-route.ts`'s scoped key composition (JSON encoding, not delimiter
 * concatenation).
 */
function scopedLedgerKey(conversationId: ConversationId, rawKey: IdempotencyKey): string {
  return JSON.stringify([conversationId, rawKey]);
}

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
  | { readonly status: 'LEDGER_WRITE_FAILED'; readonly record: MessageDraftRecord }
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

function serializeRecordForLedger(record: MessageDraftRecord): Record<string, unknown> {
  return {
    draftId: record.draftId,
    proposedText: record.proposedText,
    status: record.status,
    createdByUserId: record.createdByUserId,
    createdAt: record.createdAt,
  };
}

function deserializeRecordFromLedger(
  snapshot: Readonly<Record<string, unknown>>,
  conversationId: ConversationId,
  merchantWorkspaceId: MerchantWorkspaceId,
): MessageDraftRecord {
  if (snapshot.status !== 'DRAFT') {
    throw new Error('idempotency ledger snapshot for message.draft had an unexpected status');
  }
  return {
    draftId: internalId(String(snapshot.draftId), 'MessageDraft'),
    conversationId,
    merchantWorkspaceId,
    proposedText: String(snapshot.proposedText),
    status: 'DRAFT',
    createdByUserId: internalId(String(snapshot.createdByUserId), 'User'),
    createdAt: utcTimestamp(String(snapshot.createdAt)),
  };
}

export interface MessageDraftStore {
  createDraft(
    conversationId: ConversationId,
    merchantWorkspaceId: MerchantWorkspaceId,
    proposedText: string,
    createdByUserId: UserId,
    idempotencyKey: IdempotencyKey,
  ): Promise<MessageDraftCreateOutcome>;
}

export function createMessageDraftStore(
  executor: MessageDraftQueryExecutor,
  ledger: IdempotencyLedgerStore,
): MessageDraftStore {
  return {
    async createDraft(conversationId, merchantWorkspaceId, proposedText, createdByUserId, draftIdempotencyKey) {
      const ledgerKey = scopedLedgerKey(conversationId, draftIdempotencyKey);
      const replay = await ledger.tryGet(MESSAGE_DRAFT_OPERATION_KEY, merchantWorkspaceId, ledgerKey);
      if (replay.status === 'STORE_ERROR') return { status: 'STORE_ERROR' };
      if (replay.status === 'FOUND') {
        return {
          status: 'ALREADY_APPLIED',
          record: deserializeRecordFromLedger(replay.resultSnapshot, conversationId, merchantWorkspaceId),
        };
      }

      try {
        const existsResult = await executor.query(SELECT_CONVERSATION_EXISTS, [conversationId, merchantWorkspaceId]);
        if (existsResult.rows.length === 0) {
          return { status: 'NO_EXISTING_CONVERSATION' };
        }
      } catch {
        return { status: 'STORE_ERROR' };
      }

      let createdRecord: MessageDraftRecord;
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
        createdRecord = rowToRecord(row, conversationId, merchantWorkspaceId);
      } catch {
        return { status: 'STORE_ERROR' };
      }

      const ledgerOutcome = await ledger.record(
        MESSAGE_DRAFT_OPERATION_KEY,
        merchantWorkspaceId,
        ledgerKey,
        serializeRecordForLedger(createdRecord),
      );
      switch (ledgerOutcome.status) {
        case 'RECORDED':
          return { status: 'CREATED', record: createdRecord };
        case 'ALREADY_RECORDED':
          // A concurrent request won the race to record first; this request's own just-inserted row
          // is reported neither as an error nor as this request's success — the caller sees the
          // winner's real outcome, same single consistent answer either request would get.
          return {
            status: 'ALREADY_APPLIED',
            record: deserializeRecordFromLedger(ledgerOutcome.resultSnapshot, conversationId, merchantWorkspaceId),
          };
        case 'STORE_ERROR':
          // The draft row itself was really created; only the ledger write failed. Never report this
          // as a plain STORE_ERROR, which would falsely imply nothing happened.
          return { status: 'LEDGER_WRITE_FAILED', record: createdRecord };
      }
    },
  };
}
