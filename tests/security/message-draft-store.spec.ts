import {
  createMessageDraftStore,
  type MessageDraftQueryExecutor,
  type MessageDraftRecord,
} from '../../apps/api/src/message-draft-store';
import {
  idempotencyKey,
  internalId,
  utcTimestamp,
  type ConversationId,
  type IdempotencyKey,
  type MerchantWorkspaceId,
  type UserId,
} from '../../packages/domain/src';

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

function emptyMap(): ReadonlyMap<IdempotencyKey, MessageDraftRecord> {
  return new Map();
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
      );
      const result = await store.createDraft(conversationId, workspaceId, 'Hello, how can I help?', userId, key, emptyMap());
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
      const store = createMessageDraftStore({
        query: (sql) => {
          if (sql.startsWith('SELECT 1')) return Promise.resolve({ rows: [] });
          insertCalled = true;
          return Promise.resolve({ rows: [] });
        },
      });
      const result = await store.createDraft(conversationId, workspaceId, 'text', userId, key, emptyMap());
      assert(result.status === 'NO_EXISTING_CONVERSATION', 'a missing conversation must be a real NO_EXISTING_CONVERSATION, not a fabricated draft');
      assert(!insertCalled, 'the INSERT must never run when the referenced conversation does not exist');
    },
  },
  {
    id: 'DRAFT-03-ALREADY-APPLIED-IDEMPOTENCY-KEY-REPLAYS-WITHOUT-INSERTING',
    run: async () => {
      let existsCalled = false;
      const priorRecord: MessageDraftRecord = {
        draftId: internalId('draft-prior', 'MessageDraft'),
        conversationId,
        merchantWorkspaceId: workspaceId,
        proposedText: 'prior text',
        status: 'DRAFT',
        createdByUserId: userId,
        createdAt: utcTimestamp('2026-10-20T10:00:00.000Z'),
      };
      const store = createMessageDraftStore({
        query: () => {
          existsCalled = true;
          return Promise.resolve({ rows: [] });
        },
      });
      const appliedKeys = new Map([[key, priorRecord]]);
      const result = await store.createDraft(conversationId, workspaceId, 'new text ignored', userId, key, appliedKeys);
      assert(result.status === 'ALREADY_APPLIED', 'a previously-applied idempotency key must replay, never attempt a second insert');
      assert(result.status === 'ALREADY_APPLIED' && result.record.proposedText === 'prior text', 'the replayed record must be the prior real outcome, not the new request body');
      assert(!existsCalled, 'a replay must never even reach the conversation-existence check');
    },
  },
  {
    id: 'DRAFT-04-EXISTENCE-CHECK-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const store = createMessageDraftStore({ query: () => Promise.reject(new Error('connection lost')) });
      const result = await store.createDraft(conversationId, workspaceId, 'text', userId, key, emptyMap());
      assert(result.status === 'STORE_ERROR', 'a connectivity failure on the existence check must fail closed as STORE_ERROR');
    },
  },
  {
    id: 'DRAFT-05-INSERT-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const store = createMessageDraftStore({
        query: (sql) => {
          if (sql.startsWith('SELECT 1')) return Promise.resolve({ rows: [{ '?column?': 1 }] });
          return Promise.reject(new Error('insert failed'));
        },
      });
      const result = await store.createDraft(conversationId, workspaceId, 'text', userId, key, emptyMap());
      assert(result.status === 'STORE_ERROR', 'an insert failure must fail closed as STORE_ERROR, never a false success');
    },
  },
  {
    id: 'DRAFT-06-EMPTY-RETURNING-ROW-IS-A-STORE-ERROR-NEVER-A-FABRICATED-RECORD',
    run: async () => {
      const store = createMessageDraftStore(executor([{ '?column?': 1 }], undefined));
      const result = await store.createDraft(conversationId, workspaceId, 'text', userId, key, emptyMap());
      assert(result.status === 'STORE_ERROR', 'an INSERT that returns no row must never be treated as a successful creation');
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
