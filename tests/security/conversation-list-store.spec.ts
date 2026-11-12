import {
  createConversationListStore,
  CONVERSATION_LIST_DEFAULT_LIMIT,
  type ConversationListQueryExecutor,
} from '../../apps/api/src/conversation-list-store';
import { internalId, type MerchantWorkspaceId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspaceId: MerchantWorkspaceId = internalId('conv-list-ws-1', 'MerchantWorkspace');

function executor(rows: readonly Record<string, unknown>[]): ConversationListQueryExecutor {
  return { query: () => Promise.resolve({ rows }) };
}

const cases: ReadonlyArray<{ readonly id: string; readonly run: () => Promise<void> }> = [
  {
    id: 'CONVLIST-01-FOUND-ROW-WITH-ALL-OPTIONAL-FIELDS-MAPS-CORRECTLY',
    run: async () => {
      const store = createConversationListStore(
        executor([
          {
            conversation_id: 'conv-1',
            channel: 'whatsapp',
            customer_identity_id: 'cust-identity-1',
            ownership_state: 'HUMAN_ACTIVE',
            ownership_epoch: 3,
            assigned_user_id: 'user-1',
            status: 'OPEN',
            last_message_at: '2026-10-01T10:00:00.000Z',
            last_customer_message_at: '2026-10-01T09:55:00.000Z',
            last_outbound_at: '2026-10-01T10:00:00.000Z',
          },
        ]),
      );
      const result = await store.readRecentConversations(workspaceId);
      assert(result.status === 'FOUND', 'a real row must be found');
      assert(
        result.status === 'FOUND' &&
          result.conversations.length === 1 &&
          result.conversations[0]!.ownershipState === 'HUMAN_ACTIVE' &&
          result.conversations[0]!.ownershipEpoch === 3 &&
          result.conversations[0]!.assignedUserId === 'user-1' &&
          result.conversations[0]!.customerIdentityId === 'cust-identity-1',
        'all real optional fields must map through when present',
      );
    },
  },
  {
    id: 'CONVLIST-02-UNASSIGNED-CONVERSATION-OMITS-OPTIONAL-FIELDS-NEVER-FABRICATES',
    run: async () => {
      const store = createConversationListStore(
        executor([
          {
            conversation_id: 'conv-2',
            channel: 'whatsapp',
            customer_identity_id: null,
            ownership_state: 'AI_ACTIVE',
            ownership_epoch: 0,
            assigned_user_id: null,
            status: 'OPEN',
            last_message_at: null,
            last_customer_message_at: null,
            last_outbound_at: null,
          },
        ]),
      );
      const result = await store.readRecentConversations(workspaceId);
      assert(
        result.status === 'FOUND' &&
          result.conversations[0]!.assignedUserId === undefined &&
          result.conversations[0]!.customerIdentityId === undefined &&
          result.conversations[0]!.lastMessageAt === undefined,
        'null/absent optional columns must leave the field absent, never a fabricated value',
      );
    },
  },
  {
    id: 'CONVLIST-03-READ-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const store = createConversationListStore({ query: () => Promise.reject(new Error('connection lost')) });
      const result = await store.readRecentConversations(workspaceId);
      assert(result.status === 'STORE_ERROR', 'a query failure must fail closed as STORE_ERROR');
    },
  },
  {
    id: 'CONVLIST-04-UNRECOGNIZED-OWNERSHIP-STATE-FAILS-CLOSED',
    run: async () => {
      const store = createConversationListStore(
        executor([
          {
            conversation_id: 'conv-4',
            channel: 'whatsapp',
            ownership_state: 'SOMETHING_UNEXPECTED',
            ownership_epoch: 0,
            status: 'OPEN',
          },
        ]),
      );
      const result = await store.readRecentConversations(workspaceId);
      assert(result.status === 'STORE_ERROR', 'an unrecognized ownership_state must fail closed, never pass through');
    },
  },
  {
    id: 'CONVLIST-05-ZERO-ROWS-FOUND-WITH-EMPTY-ARRAY',
    run: async () => {
      const store = createConversationListStore(executor([]));
      const result = await store.readRecentConversations(workspaceId);
      assert(
        result.status === 'FOUND' && result.conversations.length === 0,
        'a workspace with no conversations must be a real empty array, never an error',
      );
    },
  },
  {
    id: 'CONVLIST-06-CUSTOM-LIMIT-IS-PASSED-THROUGH-TO-THE-QUERY',
    run: async () => {
      let capturedParams: readonly unknown[] = [];
      const store = createConversationListStore({
        query: (_sql, params) => {
          capturedParams = params;
          return Promise.resolve({ rows: [] });
        },
      });
      await store.readRecentConversations(workspaceId, 10);
      assert(capturedParams[1] === 10, 'an explicit limit override must reach the query, not the default');

      let defaultParams: readonly unknown[] = [];
      const defaultStore = createConversationListStore({
        query: (_sql, params) => {
          defaultParams = params;
          return Promise.resolve({ rows: [] });
        },
      });
      await defaultStore.readRecentConversations(workspaceId);
      assert(
        defaultParams[1] === CONVERSATION_LIST_DEFAULT_LIMIT,
        'omitting the limit must fall back to the documented default, never an unbounded read',
      );
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} conversation list store (adapter) scenarios`);
}

void main();
