import {
  resolveConversationOwnershipTransition,
  type ConversationOwnershipIdempotencyKey,
  type ConversationOwnershipRecord,
  type ConversationOwnershipTransitionRequest,
  type ConversationOwnershipTransitionResult,
} from '../../../packages/authz/src';
import { CONVERSATION_OWNERSHIP_STATES, DomainPrimitiveError, type ConversationOwnershipState } from '../../../packages/domain/src';
import type { IdempotencyLedgerStore } from './idempotency-ledger-store';

function assertIsConversationOwnershipState(value: string): asserts value is ConversationOwnershipState {
  if (!(CONVERSATION_OWNERSHIP_STATES as readonly string[]).includes(value)) {
    throw new DomainPrimitiveError(`Unrecognized ownership_state from store: ${value}`);
  }
}

/** Exported so other read adapters (e.g. conversation-list-store.ts) share this one parse/validate path. */
export function parseOwnershipState(value: unknown): ConversationOwnershipState {
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
 *
 * Idempotency is backed by the durable `idempotency-ledger-store.ts` (stage 3/4 of that retrofit —
 * stage 1 was the generic adapter, stage 2 was `message-draft-store.ts`). The caller-injected
 * `appliedIdempotencyKeys` map this adapter used to accept has been removed entirely: the one real
 * prior-outcome lookup `resolveConversationOwnershipTransition` needs is now sourced from a single
 * `ledger.tryGet` call per `applyTransition`, keyed by `scopedLedgerKey` (conversationId + the raw
 * caller-supplied key — the same JSON-encoding collision-safety technique as `message-draft-store.ts`,
 * since two different conversations in the same workspace could otherwise reuse the same raw key
 * string). The pure decision function's own signature/contract and tests are entirely unchanged — it
 * still takes a `ReadonlyMap`, now just populated with at most one real entry from the ledger instead
 * of always being empty.
 *
 * A successful CAS UPDATE is followed by `ledger.record(...)`; if that write itself fails, the
 * already-applied state change is reported via the new `LEDGER_WRITE_FAILED` outcome (same "never hide
 * a real success behind an incomplete side-write" discipline as `AUDIT_WRITE_FAILED`), and the audit
 * insert is still attempted regardless. `ledger.record`'s `ALREADY_RECORDED` outcome is deliberately
 * treated identically to `STORE_ERROR` here — unlike `message-draft-store.ts`, this store's own CAS
 * UPDATE has already uniquely mutated the single authoritative row by the time `ledger.record` is
 * called, so there is never a genuine "other winner" to defer to; `decision.resultingRecord` is always
 * reported (see the inline comment at the call site for the full reasoning). One residual, accepted
 * risk, identical in kind to
 * `message-draft-store.ts`'s own documented gap 2: if `ledger.record` fails (or simply hasn't
 * committed yet) and the client retries the exact same request before that's resolved, the retry's own
 * `tryGet` sees `NOT_FOUND`, re-reads the now-already-advanced row, and — unlike message-draft's plain
 * INSERT, which would just create a harmless duplicate — fails as a false `CONFLICT` (the client's
 * `expectedEpoch` no longer matches), rather than replaying the true prior outcome. Closing this fully
 * needs a transaction primitive this codebase does not have; accepted as a known, narrow-window risk
 * rather than engineered around here.
 */

const CONVERSATION_OWNERSHIP_OPERATION_KEY = 'conversation.ownership_transition';

function scopedLedgerKey(
  conversationId: ConversationOwnershipTransitionRequest['conversationId'],
  idempotencyKey: ConversationOwnershipIdempotencyKey,
): string {
  return JSON.stringify([conversationId, idempotencyKey]);
}

function serializeRecordForLedger(record: ConversationOwnershipRecord): Record<string, unknown> {
  return { state: record.state, epoch: record.epoch };
}

function deserializeRecordFromLedger(
  snapshot: Readonly<Record<string, unknown>>,
  conversationId: ConversationOwnershipTransitionRequest['conversationId'],
  merchantWorkspaceId: ConversationOwnershipTransitionRequest['merchantWorkspaceId'],
): ConversationOwnershipRecord {
  const stateCandidate = snapshot.state;
  if (typeof stateCandidate !== 'string') {
    throw new DomainPrimitiveError('idempotency ledger snapshot for conversation.ownership_transition is missing a usable state');
  }
  assertIsConversationOwnershipState(stateCandidate);
  const epochCandidate = snapshot.epoch;
  if (typeof epochCandidate !== 'number' || !Number.isInteger(epochCandidate)) {
    throw new DomainPrimitiveError('idempotency ledger snapshot for conversation.ownership_transition is missing a usable epoch');
  }
  return {
    ownerConversationId: conversationId,
    ownerMerchantWorkspaceId: merchantWorkspaceId,
    state: stateCandidate,
    epoch: epochCandidate,
  };
}

export interface ConversationOwnershipQueryExecutor {
  query(sql: string, params: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

export type ConversationOwnershipPersistOutcome =
  | ConversationOwnershipTransitionResult
  | { readonly status: 'RACE_LOST' }
  | { readonly status: 'NO_EXISTING_CONVERSATION' }
  | { readonly status: 'STORE_ERROR' }
  | { readonly status: 'AUDIT_WRITE_FAILED'; readonly resultingRecord: ConversationOwnershipRecord; readonly ledgerWriteFailed: boolean }
  | { readonly status: 'LEDGER_WRITE_FAILED'; readonly resultingRecord: ConversationOwnershipRecord };

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
  ledger: IdempotencyLedgerStore,
): ConversationOwnershipStore {
  return {
    async getCurrent(conversationId, merchantWorkspaceId) {
      const read = await readCurrentRow(executor, conversationId, merchantWorkspaceId);
      if (read.outcome === 'READ_ERROR') return { status: 'STORE_ERROR' };
      if (read.outcome === 'NOT_FOUND') return { status: 'NOT_FOUND' };
      return { status: 'FOUND', record: read.record };
    },
    async applyTransition(request, actorRef) {
      const scopedKey = scopedLedgerKey(request.conversationId, request.idempotencyKey);
      // The ledger replay lookup and the conversations row read are independent of each other (the
      // decision step below is the first place either result is actually needed), so they run
      // concurrently rather than as two serial round-trips — both `tryGet` and `readCurrentRow`
      // already catch their own connectivity/query failures internally and never reject, so this
      // Promise.all cannot itself throw.
      const [replay, read] = await Promise.all([
        ledger.tryGet(CONVERSATION_OWNERSHIP_OPERATION_KEY, request.merchantWorkspaceId, scopedKey),
        readCurrentRow(executor, request.conversationId, request.merchantWorkspaceId),
      ]);
      if (replay.status === 'STORE_ERROR') return { status: 'STORE_ERROR' };
      if (read.outcome === 'READ_ERROR') return { status: 'STORE_ERROR' };

      let appliedIdempotencyKeys: ReadonlyMap<ConversationOwnershipIdempotencyKey, ConversationOwnershipRecord> = new Map();
      if (replay.status === 'FOUND') {
        try {
          const priorRecord = deserializeRecordFromLedger(
            replay.resultSnapshot,
            request.conversationId,
            request.merchantWorkspaceId,
          );
          appliedIdempotencyKeys = new Map([[request.idempotencyKey, priorRecord]]);
        } catch {
          return { status: 'STORE_ERROR' };
        }
      }

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

      const ledgerOutcome = await ledger.record(
        CONVERSATION_OWNERSHIP_OPERATION_KEY,
        request.merchantWorkspaceId,
        scopedKey,
        serializeRecordForLedger(decision.resultingRecord),
      );
      // Unlike message-draft-store.ts (where an ALREADY_RECORDED "other" row is an equally valid
      // outcome of the exact same logical create — there is no CAS gate there, so two racing INSERTs
      // produce two equally real rows), this store's own CAS UPDATE just above has already uniquely
      // and authoritatively mutated the single `conversations` row for this transition: by CAS
      // construction, no other request can have ALSO just succeeded a CAS update for this same
      // (conversationId, merchantWorkspaceId) row at this same epoch — a true concurrent duplicate
      // would already have been filtered out as RACE_LOST or CONFLICT before ever reaching here. So
      // if the ledger nonetheless reports ALREADY_RECORDED for this exact scoped key, it can only be
      // because this idempotency key was previously used for a DIFFERENT, already-completed transition
      // (a caller bug reusing a key across unrelated actions on the same conversation) — treating that
      // other, unrelated snapshot as this request's own outcome would tell this caller something false
      // about what ITS OWN request just did. `decision.resultingRecord` is always what gets reported:
      // it is real, it is this request's own, and it is strictly fresher than any pre-existing ledger
      // entry. ALREADY_RECORDED is therefore treated exactly like STORE_ERROR here.
      const ledgerWriteFailed = ledgerOutcome.status !== 'RECORDED';

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
        // The ledger write's own outcome must never be silently lost just because the audit insert
        // also failed — both flags are independently reported to the caller, never merged into one.
        return { status: 'AUDIT_WRITE_FAILED', resultingRecord: decision.resultingRecord, ledgerWriteFailed };
      }

      if (ledgerWriteFailed) {
        // The authority-bearing CAS update (and the audit insert) already succeeded; only the
        // idempotency ledger write failed. Never report this as a plain STORE_ERROR, which would
        // falsely imply nothing happened.
        return { status: 'LEDGER_WRITE_FAILED', resultingRecord: decision.resultingRecord };
      }

      return decision;
    },
  };
}
