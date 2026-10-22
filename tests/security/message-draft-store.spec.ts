import { createMessageDraftStore, type MessageDraftQueryExecutor } from '../../apps/api/src/message-draft-store';
import type {
  IdempotencyLedgerReadOutcome,
  IdempotencyLedgerStore,
  IdempotencyLedgerWriteOutcome,
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
    id: 'DRAFT-10-LEDGER-KEY-IS-SCOPED-BY-CONVERSATION-NOT-JUST-THE-RAW-CALLER-KEY',
    run: async () => {
      const otherConversationId: ConversationId = internalId('draft-conv-OTHER', 'Conversation');
      const capturedKeys: string[] = [];
      const store = createMessageDraftStore(
        executor([{ '?column?': 1 }], {
          draft_id: 'draft-new',
          proposed_text: 'fresh text for a different conversation',
          created_by: userId,
          created_at: '2026-10-21T10:00:00.000Z',
        }),
        fakeLedger({
          tryGet: (_op, _ws, ledgerKey) => {
            capturedKeys.push(ledgerKey);
            return Promise.resolve({ status: 'NOT_FOUND' });
          },
        }),
      );
      // Same raw idempotency key `key`, but a DIFFERENT conversationId than the other cases above.
      const result = await store.createDraft(otherConversationId, workspaceId, 'fresh text for a different conversation', userId, key);
      assert(
        result.status === 'CREATED',
        'a different conversation reusing the same raw caller key must never be treated as a replay of another conversation\'s draft',
      );
      assert(capturedKeys.length === 1, 'sanity: exactly one ledger lookup should have occurred');
      assert(
        capturedKeys[0] !== key,
        'the actual ledger lookup key must not be the bare raw caller key — it must be scoped so a different conversationId never collides',
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
