import { createMessageDraftStore, type MessageDraftQueryExecutor } from '../../apps/api/src/message-draft-store';
import {
  createIdempotencyLedgerStore,
  type IdempotencyLedgerQueryExecutor,
  type IdempotencyLedgerReadOutcome,
  type IdempotencyLedgerStore,
  type IdempotencyLedgerWriteOutcome,
} from '../../apps/api/src/idempotency-ledger-store';
import { idempotencyKey, internalId, type ConversationId, type IdempotencyKey, type MerchantWorkspaceId, type UserId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const conversationId: ConversationId = internalId('draft-conv-1', 'Conversation');
const workspaceId: MerchantWorkspaceId = internalId('draft-ws-1', 'MerchantWorkspace');
const userId: UserId = internalId('draft-user-1', 'User');
const key: IdempotencyKey = idempotencyKey('draft-idem-1');

function executor(
  existsRows: readonly Record<string, unknown>[],
  insertRow: Record<string, unknown> | undefined,
): MessageDraftQueryExecutor {
  return {
    query: (sql) => {
      if (sql.startsWith('SELECT 1')) return Promise.resolve({ rows: existsRows });
      return Promise.resolve({ rows: insertRow ? [insertRow] : [] });
    },
  };
}

function fakeLedger(overrides: Partial<IdempotencyLedgerStore> = {}): IdempotencyLedgerStore {
  return {
    tryGet: (): Promise<IdempotencyLedgerReadOutcome> => Promise.resolve({ status: 'NOT_FOUND' }),
    record: (): Promise<IdempotencyLedgerWriteOutcome> => Promise.resolve({ status: 'RECORDED' }),
    ...overrides,
  };
}

// A genuine in-memory simulation of the real `idempotency_records` table (same INSERT/conflict/SELECT
// semantics as idempotency-ledger-store.ts's own SQL), used by DRAFT-10 so that test proves the REAL
// scoping behavior end-to-end rather than merely asserting a mocked single-call key differs from the
// raw key — a broken `scopedLedgerKey` that still produces *some* different string per call would pass
// a mock-only assertion but fail this real round-trip.
function statefulLedgerExecutor(): IdempotencyLedgerQueryExecutor {
  const rows = new Map<string, string>();
  function rowKey(params: readonly unknown[]): string {
    return JSON.stringify([params[0], params[1], params[2]]);
  }
  return {
    query: (sql, params) => {
      if (sql.includes('INSERT INTO idempotency_records')) {
        const key = rowKey(params);
        if (rows.has(key)) return Promise.resolve({ rows: [] });
        const snapshot = String(params[3]);
        rows.set(key, snapshot);
        return Promise.resolve({ rows: [{ result_snapshot: snapshot }] });
      }
      const key = rowKey(params);
      return Promise.resolve({ rows: rows.has(key) ? [{ result_snapshot: rows.get(key) }] : [] });
    },
  };
}

// Returns a fresh incrementing draft id per INSERT, so DRAFT-10 can tell two real creations apart.
function uniqueDraftExecutor(): MessageDraftQueryExecutor {
  let nextDraftId = 0;
  return {
    query: (sql) => {
      if (sql.startsWith('SELECT 1')) return Promise.resolve({ rows: [{ '?column?': 1 }] });
      nextDraftId += 1;
      return Promise.resolve({
        rows: [
          {
            draft_id: `draft-real-${nextDraftId}`,
            proposed_text: 'fresh text for a different conversation',
            created_by: userId,
            created_at: '2026-10-21T10:00:00.000Z',
          },
        ],
      });
    },
  };
}

const cases: ReadonlyArray<{ readonly id: string; readonly run: () => Promise<void> }> = [
  {
    id: 'DRAFT-01-CREATES-A-REAL-DRAFT-WHEN-CONVERSATION-EXISTS',
    run: async () => {
      const store = createMessageDraftStore(
        executor([{ '?column?': 1 }], {
          draft_id: 'draft-1',
          proposed_text: 'Hello, how can I help?',
          created_by: userId,
          created_at: '2026-10-21T10:00:00.000Z',
        }),
        fakeLedger(),
      );
      const result = await store.createDraft(conversationId, workspaceId, 'Hello, how can I help?', userId, key);
      assert(result.status === 'CREATED', 'a conversation that exists must allow draft creation');
      assert(
        result.status === 'CREATED' && result.record.proposedText === 'Hello, how can I help?' && result.record.status === 'DRAFT',
        'the created record must carry the real proposed text and DRAFT status',
      );
    },
  },
  {
    id: 'DRAFT-02-MISSING-CONVERSATION-RETURNS-NO-EXISTING-CONVERSATION-NEVER-INSERTS',
    run: async () => {
      let insertCalled = false;
      const store = createMessageDraftStore(
        {
          query: (sql) => {
            if (sql.startsWith('SELECT 1')) return Promise.resolve({ rows: [] });
            insertCalled = true;
            return Promise.resolve({ rows: [] });
          },
        },
        fakeLedger(),
      );
      const result = await store.createDraft(conversationId, workspaceId, 'text', userId, key);
      assert(result.status === 'NO_EXISTING_CONVERSATION', 'a missing conversation must be a real NO_EXISTING_CONVERSATION, not a fabricated draft');
      assert(!insertCalled, 'the INSERT must never run when the referenced conversation does not exist');
    },
  },
  {
    id: 'DRAFT-03-LEDGER-REPLAY-RETURNS-ALREADY-APPLIED-WITHOUT-TOUCHING-THE-DATABASE',
    run: async () => {
      let existsCalled = false;
      const priorSnapshot = {
        draftId: internalId('draft-prior', 'MessageDraft'),
        proposedText: 'prior text',
        status: 'DRAFT',
        createdByUserId: userId,
        createdAt: '2026-10-20T10:00:00.000Z',
      };
      const store = createMessageDraftStore(
        {
          query: () => {
            existsCalled = true;
            return Promise.resolve({ rows: [] });
          },
        },
        fakeLedger({ tryGet: () => Promise.resolve({ status: 'FOUND', resultSnapshot: priorSnapshot }) }),
      );
      const result = await store.createDraft(conversationId, workspaceId, 'new text ignored', userId, key);
      assert(result.status === 'ALREADY_APPLIED', 'a replay recognized by the ledger must never attempt a second insert');
      assert(
        result.status === 'ALREADY_APPLIED' && result.record.proposedText === 'prior text',
        'the replayed record must be the prior real outcome, not the new request body',
      );
      assert(!existsCalled, 'a replay must never even reach the conversation-existence check');
    },
  },
  {
    id: 'DRAFT-04-LEDGER-READ-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const store = createMessageDraftStore(
        { query: () => Promise.resolve({ rows: [] }) },
        fakeLedger({ tryGet: () => Promise.resolve({ status: 'STORE_ERROR' }) }),
      );
      const result = await store.createDraft(conversationId, workspaceId, 'text', userId, key);
      assert(result.status === 'STORE_ERROR', 'a ledger read failure must fail closed as STORE_ERROR before any insert is attempted');
    },
  },
  {
    id: 'DRAFT-05-EXISTENCE-CHECK-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const store = createMessageDraftStore({ query: () => Promise.reject(new Error('connection lost')) }, fakeLedger());
      const result = await store.createDraft(conversationId, workspaceId, 'text', userId, key);
      assert(result.status === 'STORE_ERROR', 'a connectivity failure on the existence check must fail closed as STORE_ERROR');
    },
  },
  {
    id: 'DRAFT-06-INSERT-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const store = createMessageDraftStore(
        {
          query: (sql) => {
            if (sql.startsWith('SELECT 1')) return Promise.resolve({ rows: [{ '?column?': 1 }] });
            return Promise.reject(new Error('insert failed'));
          },
        },
        fakeLedger(),
      );
      const result = await store.createDraft(conversationId, workspaceId, 'text', userId, key);
      assert(result.status === 'STORE_ERROR', 'an insert failure must fail closed as STORE_ERROR, never a false success');
    },
  },
  {
    id: 'DRAFT-07-EMPTY-RETURNING-ROW-IS-A-STORE-ERROR-NEVER-A-FABRICATED-RECORD',
    run: async () => {
      const store = createMessageDraftStore(executor([{ '?column?': 1 }], undefined), fakeLedger());
      const result = await store.createDraft(conversationId, workspaceId, 'text', userId, key);
      assert(result.status === 'STORE_ERROR', 'an INSERT that returns no row must never be treated as a successful creation');
    },
  },
  {
    id: 'DRAFT-08-LOSING-A-LEDGER-RACE-REPORTS-THE-WINNERS-RECORD-NOT-ITS-OWN-INSERT',
    run: async () => {
      const winnerSnapshot = {
        draftId: internalId('draft-winner', 'MessageDraft'),
        proposedText: 'winner text',
        status: 'DRAFT',
        createdByUserId: userId,
        createdAt: '2026-10-21T10:00:00.000Z',
      };
      const store = createMessageDraftStore(
        executor([{ '?column?': 1 }], {
          draft_id: 'draft-loser',
          proposed_text: 'loser text',
          created_by: userId,
          created_at: '2026-10-21T10:05:00.000Z',
        }),
        fakeLedger({ record: () => Promise.resolve({ status: 'ALREADY_RECORDED', resultSnapshot: winnerSnapshot }) }),
      );
      const result = await store.createDraft(conversationId, workspaceId, 'loser text', userId, key);
      assert(
        result.status === 'ALREADY_APPLIED' && result.record.proposedText === 'winner text',
        'a request that loses the ledger race must report the real winning record, never its own already-inserted row',
      );
    },
  },
  {
    id: 'DRAFT-09-LEDGER-WRITE-FAILURE-STILL-REPORTS-THE-REAL-CREATED-RECORD',
    run: async () => {
      const store = createMessageDraftStore(
        executor([{ '?column?': 1 }], {
          draft_id: 'draft-1',
          proposed_text: 'text',
          created_by: userId,
          created_at: '2026-10-21T10:00:00.000Z',
        }),
        fakeLedger({ record: () => Promise.resolve({ status: 'STORE_ERROR' }) }),
      );
      const result = await store.createDraft(conversationId, workspaceId, 'text', userId, key);
      assert(
        result.status === 'LEDGER_WRITE_FAILED' && result.record.proposedText === 'text',
        'a ledger write failure must never be reported as a plain STORE_ERROR — the draft itself was really created',
      );
    },
  },
  {
    id: 'DRAFT-10-REAL-LEDGER-ROUND-TRIP-SCOPES-BY-CONVERSATION-AND-REPLAYS-CORRECTLY',
    run: async () => {
      const conversationA: ConversationId = internalId('draft-conv-A', 'Conversation');
      const conversationB: ConversationId = internalId('draft-conv-B', 'Conversation');
      const sharedRawKey: IdempotencyKey = idempotencyKey('shared-raw-key');
      const ledger = createIdempotencyLedgerStore(statefulLedgerExecutor());
      const store = createMessageDraftStore(uniqueDraftExecutor(), ledger);

      const firstForA = await store.createDraft(conversationA, workspaceId, 'text A', userId, sharedRawKey);
      assert(firstForA.status === 'CREATED', 'first creation for conversation A with a fresh key must succeed');

      const firstForB = await store.createDraft(conversationB, workspaceId, 'text B', userId, sharedRawKey);
      assert(
        firstForB.status === 'CREATED',
        'conversation B reusing the SAME raw key as conversation A must never be treated as a replay — real cross-conversation non-collision',
      );
      assert(
        firstForB.status === 'CREATED' &&
          firstForA.status === 'CREATED' &&
          firstForB.record.draftId !== firstForA.record.draftId,
        'conversation A and B must each get their own real, distinct draftId — not share one via a collided ledger key',
      );

      const retryForA = await store.createDraft(conversationA, workspaceId, 'text A retried, should be ignored', userId, sharedRawKey);
      assert(
        retryForA.status === 'ALREADY_APPLIED',
        'retrying conversation A with the same key must replay — real same-conversation idempotency',
      );
      assert(
        retryForA.status === 'ALREADY_APPLIED' &&
          firstForA.status === 'CREATED' &&
          retryForA.record.draftId === firstForA.record.draftId,
        'the replay for conversation A must return the SAME draftId as its own first creation, never a new row',
      );
    },
  },
  {
    id: 'DRAFT-11-MALFORMED-LEDGER-SNAPSHOT-FAILS-CLOSED-AS-STORE-ERROR-NEVER-AN-UNCAUGHT-THROW',
    run: async () => {
      const store = createMessageDraftStore(
        { query: () => Promise.resolve({ rows: [] }) },
        fakeLedger({
          tryGet: () => Promise.resolve({ status: 'FOUND', resultSnapshot: { status: 'SOMETHING_UNEXPECTED' } }),
        }),
      );
      const result = await store.createDraft(conversationId, workspaceId, 'text', userId, key);
      assert(
        result.status === 'STORE_ERROR',
        'a malformed/corrupted ledger snapshot on replay must fail closed as STORE_ERROR, never throw uncaught',
      );
    },
  },
  {
    id: 'DRAFT-12-MALFORMED-RACE-WINNER-SNAPSHOT-ALSO-FAILS-CLOSED-AS-STORE-ERROR',
    run: async () => {
      const store = createMessageDraftStore(
        executor([{ '?column?': 1 }], {
          draft_id: 'draft-1',
          proposed_text: 'text',
          created_by: userId,
          created_at: '2026-10-21T10:00:00.000Z',
        }),
        fakeLedger({
          record: () =>
            Promise.resolve({ status: 'ALREADY_RECORDED', resultSnapshot: { status: 'SOMETHING_UNEXPECTED' } }),
        }),
      );
      const result = await store.createDraft(conversationId, workspaceId, 'text', userId, key);
      assert(
        result.status === 'STORE_ERROR',
        'a malformed race-winner snapshot must also fail closed as STORE_ERROR, never throw uncaught',
      );
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} message draft store (adapter) scenarios`);
}

void main();
