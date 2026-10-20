import {
  resolveConversationOwnershipTransition,
  type ConversationOwnershipIdempotencyKey,
  type ConversationOwnershipRecord,
  type ConversationOwnershipTransitionRequest,
  type ConversationOwnershipTransitionResult,
} from '../../../packages/authz/src';
import { CONVERSATION_OWNERSHIP_STATES, DomainPrimitiveError, type ConversationOwnershipState } from '../../../packages/domain/src';

function assertIsConversationOwnershipState(value: string): asserts value is ConversationOwnershipState {
  if (!(CONVERSATION_OWNERSHIP_STATES as readonly string[]).includes(value)) {
    throw new DomainPrimitiveError(`Unrecognized ownership_state from store: ${value}`);
  }
}

function parseOwnershipState(value: unknown): ConversationOwnershipState {
  const candidate = String(value);
  assertIsConversationOwnershipState(candidate);
  return candidate;
}

/**
 * SC-05 persistence adapter for conversation ownership/handoff epoch transitions (HANDOFF-xx).
 * Same split and atomic-boundary technique as the SC-02 adapters (provider-store-binding-store.ts,
 * commerce-session-link-store.ts, workspace-context-store.ts): `resolveConversationOwnershipTransition`
 * is unchanged and untouched by this file.
 *
 * Like workspace-context-store.ts, this is UPDATE-only: a Conversation row (with its initial
 * ownership_state/ownership_epoch) is always created by the conversation-creation path itself, a
 * separate, not-yet-built adapter concern (see inbound-conversation-binding.ts's doc comment — "new-
 * conversation defaults ... are a trivial constant, not a decision"). A missing row here is a
 * legitimate NO_EXISTING_CONVERSATION state, not a STORE_ERROR, unless the exact idempotency key was
 * already applied before, in which case the prior outcome replays regardless.
 *
 * Beyond the CAS update itself, this adapter also appends to the pre-existing, already-migrated
 * `conversation_ownership_events` audit table (`CHECK (to_epoch = from_epoch + 1)`,
 * DB-06-OWNERSHIP-EPOCH-CONSTRAINT) — the durable lineage the whole ownership-transition design was
 * built to support. `actorRef` is supplied by the caller (the HTTP/worker layer knows who/what is
 * acting; the pure transition function itself has and needs no such field) and `reasonCode` is
 * derived directly from the request's own `trigger`, a trivial 1:1 mapping, not a new decision.
 *
 * The CAS update and the audit insert are two separate statements (this executor interface has no
 * transaction primitive, and none exists anywhere else in this codebase yet — introducing one would be
 * new infrastructure, out of scope for this adapter). The CAS update is the authority-bearing
 * operation and is already atomic on its own. If it succeeds but the subsequent audit insert then
 * fails, this is reported as its own distinct `AUDIT_WRITE_FAILED` outcome carrying the already-
 * applied `resultingRecord` — the authoritative state change is real and must never be hidden or
 * implied to have been rolled back, but the incomplete audit trail must never be silently swallowed
 * as if the operation were a plain, fully-evidenced success either.
 */

export interface ConversationOwnershipQueryExecutor {
  query(sql: string, params: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

export type ConversationOwnershipPersistOutcome =
  | ConversationOwnershipTransitionResult
  | { readonly status: 'RACE_LOST' }
  | { readonly status: 'NO_EXISTING_CONVERSATION' }
  | { readonly status: 'STORE_ERROR' }
  | { readonly status: 'AUDIT_WRITE_FAILED'; readonly resultingRecord: ConversationOwnershipRecord };

export type ConversationOwnershipReadOutcome =
  | { readonly status: 'FOUND'; readonly record: ConversationOwnershipRecord }
  | { readonly status: 'NOT_FOUND' }
  | { readonly status: 'STORE_ERROR' };

const SELECT_CURRENT =
  'SELECT ownership_state, ownership_epoch FROM conversations WHERE conversation_id = $1 AND merchant_workspace_id = $2';

const UPDATE_CAS = `
  UPDATE conversations
  SET ownership_state = $1, ownership_epoch = $2, updated_at = now()
  WHERE conversation_id = $3 AND merchant_workspace_id = $4 AND ownership_epoch = $5
  RETURNING ownership_state, ownership_epoch
`;

const INSERT_AUDIT_EVENT = `
  INSERT INTO conversation_ownership_events
    (ownership_event_id, conversation_id, merchant_workspace_id, from_state, to_state, from_epoch, to_epoch, actor_ref, reason_code, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
`;

export interface ConversationOwnershipStore {
  applyTransition(
    request: ConversationOwnershipTransitionRequest,
    actorRef: string,
    appliedIdempotencyKeys: ReadonlyMap<ConversationOwnershipIdempotencyKey, ConversationOwnershipRecord>,
  ): Promise<ConversationOwnershipPersistOutcome>;
  /**
   * Plain, non-mutating read of the current ownership state/epoch — the same SELECT_CURRENT query
   * `applyTransition` already runs internally, exposed directly so a caller (e.g. the `GET
   * /v1/conversations/{id}` read route) can discover the current `epoch` it must pass as the CAS
   * precondition on a subsequent handoff/return-to-ai call, without needing to attempt a mutation
   * just to observe state.
   */
  getCurrent(
    conversationId: ConversationOwnershipTransitionRequest['conversationId'],
    merchantWorkspaceId: ConversationOwnershipTransitionRequest['merchantWorkspaceId'],
  ): Promise<ConversationOwnershipReadOutcome>;
}

type CurrentRowReadResult =
  | { readonly outcome: 'FOUND'; readonly record: ConversationOwnershipRecord }
  | { readonly outcome: 'NOT_FOUND' }
  | { readonly outcome: 'READ_ERROR' };

/**
 * Shared SELECT_CURRENT execute-and-parse step for both `getCurrent` and `applyTransition` — a
 * single place that queries, catches a connectivity/query failure, and parses the row, so neither
 * caller can drift into a different empty-row or malformed-state handling shape than the other. A
 * row whose `ownership_state` is outside the canonical enum (corrupt data, bad migration) is itself
 * a read failure, never an uncaught throw past this boundary.
 */
async function readCurrentRow(
  executor: ConversationOwnershipQueryExecutor,
  conversationId: ConversationOwnershipTransitionRequest['conversationId'],
  merchantWorkspaceId: ConversationOwnershipTransitionRequest['merchantWorkspaceId'],
): Promise<CurrentRowReadResult> {
  try {
    const readResult = await executor.query(SELECT_CURRENT, [conversationId, merchantWorkspaceId]);
    const row = readResult.rows[0];
    if (!row) return { outcome: 'NOT_FOUND' };
    return {
      outcome: 'FOUND',
      record: {
        ownerConversationId: conversationId,
        ownerMerchantWorkspaceId: merchantWorkspaceId,
        state: parseOwnershipState(row.ownership_state),
        epoch: Number(row.ownership_epoch),
      },
    };
  } catch {
    return { outcome: 'READ_ERROR' };
  }
}

export function createConversationOwnershipStore(
  executor: ConversationOwnershipQueryExecutor,
): ConversationOwnershipStore {
  return {
    async getCurrent(conversationId, merchantWorkspaceId) {
      const read = await readCurrentRow(executor, conversationId, merchantWorkspaceId);
      if (read.outcome === 'READ_ERROR') return { status: 'STORE_ERROR' };
      if (read.outcome === 'NOT_FOUND') return { status: 'NOT_FOUND' };
      return { status: 'FOUND', record: read.record };
    },
    async applyTransition(request, actorRef, appliedIdempotencyKeys) {
      const read = await readCurrentRow(executor, request.conversationId, request.merchantWorkspaceId);
      if (read.outcome === 'READ_ERROR') return { status: 'STORE_ERROR' };

      if (read.outcome === 'NOT_FOUND') {
        const priorOutcome = appliedIdempotencyKeys.get(request.idempotencyKey);
        if (priorOutcome) {
          return { status: 'ALREADY_APPLIED', resultingRecord: priorOutcome };
        }
        return { status: 'NO_EXISTING_CONVERSATION' };
      }

      const currentRecord = read.record;

      const decision = resolveConversationOwnershipTransition(request, currentRecord, appliedIdempotencyKeys);
      if (decision.status !== 'APPLIED') {
        return decision;
      }

      try {
        const updateResult = await executor.query(UPDATE_CAS, [
          decision.resultingRecord.state,
          decision.resultingRecord.epoch,
          request.conversationId,
          request.merchantWorkspaceId,
          currentRecord.epoch,
        ]);
        if (updateResult.rows.length === 0) {
          return { status: 'RACE_LOST' };
        }
      } catch {
        return { status: 'STORE_ERROR' };
      }

      try {
        await executor.query(INSERT_AUDIT_EVENT, [
          crypto.randomUUID(),
          request.conversationId,
          request.merchantWorkspaceId,
          currentRecord.state,
          decision.resultingRecord.state,
          currentRecord.epoch,
          decision.resultingRecord.epoch,
          actorRef,
          request.trigger,
        ]);
      } catch {
        return { status: 'AUDIT_WRITE_FAILED', resultingRecord: decision.resultingRecord };
      }

      return decision;
    },
  };
}
