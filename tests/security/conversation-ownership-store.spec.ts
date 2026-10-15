import {
  createConversationOwnershipStore,
  type ConversationOwnershipQueryExecutor,
} from '../../apps/api/src/conversation-ownership-store';
import {
  conversationOwnershipIdempotencyKey,
  type ConversationOwnershipIdempotencyKey,
  type ConversationOwnershipRecord,
  type ConversationOwnershipTransitionRequest,
} from '../../packages/authz/src';
import { internalId, type ConversationId, type MerchantWorkspaceId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const conversationId: ConversationId = internalId('adapter-conv-1', 'Conversation');
const workspaceId: MerchantWorkspaceId = internalId('adapter-conv-workspace-1', 'MerchantWorkspace');
const actorRef = 'system:test-actor';

const noPriorApplications: ReadonlyMap<ConversationOwnershipIdempotencyKey, ConversationOwnershipRecord> = new Map();

function request(overrides: Partial<ConversationOwnershipTransitionRequest> = {}): ConversationOwnershipTransitionRequest {
  return {
    conversationId,
    merchantWorkspaceId: workspaceId,
    trigger: 'REQUEST_HANDOFF',
    expectedEpoch: 0,
    idempotencyKey: conversationOwnershipIdempotencyKey('adapter-conv-op-1'),
    ...overrides,
  };
}

function fakeExecutor(
  initialRow: Record<string, unknown> | null,
  options: { failAuditInsert?: boolean } = {},
): ConversationOwnershipQueryExecutor {
  let row: Record<string, unknown> | null = initialRow;
  return {
    query(sql, params) {
      if (sql.startsWith('SELECT')) {
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      if (sql.includes('INSERT INTO conversation_ownership_events')) {
        if (options.failAuditInsert) {
          throw new Error('simulated audit insert failure');
        }
        return Promise.resolve({ rows: [] });
      }
      const [newState, newEpoch, , , expectedEpoch] = params;
      if (row === null || Number(row.ownership_epoch) !== Number(expectedEpoch)) {
        return Promise.resolve({ rows: [] });
      }
      row = { ownership_state: newState, ownership_epoch: newEpoch };
      return Promise.resolve({ rows: [row] });
    },
  };
}

function throwingExecutor(): ConversationOwnershipQueryExecutor {
  return {
    query: () => {
      throw new Error('simulated connectivity failure');
    },
  };
}

const cases: Array<{ id: string; run: () => Promise<void> }> = [
  {
    id: 'COS-STORE-TRANSITION-WITH-MATCHING-CAS-APPLIES-VIA-UPDATE-AND-WRITES-AUDIT-EVENT',
    run: async () => {
      const executor = fakeExecutor({ ownership_state: 'AI_ACTIVE', ownership_epoch: 0 });
      const store = createConversationOwnershipStore(executor);
      const result = await store.applyTransition(request(), actorRef, noPriorApplications);
      assert(
        result.status === 'APPLIED' && result.resultingRecord.state === 'HANDOFF_REQUESTED' && result.resultingRecord.epoch === 1,
        'a matching CAS transition must apply via UPDATE and report the new state/epoch',
      );
    },
  },
  {
    id: 'COS-STORE-NO-EXISTING-ROW-RETURNS-NO-EXISTING-CONVERSATION-NOT-STORE-ERROR',
    run: async () => {
      const executor = fakeExecutor(null);
      const store = createConversationOwnershipStore(executor);
      const result = await store.applyTransition(request(), actorRef, noPriorApplications);
      assert(result.status === 'NO_EXISTING_CONVERSATION', 'a missing conversation row is a legitimate state, not a store failure');
    },
  },
  {
    id: 'COS-STORE-NO-EXISTING-ROW-BUT-PRIOR-IDEMPOTENCY-HIT-STILL-REPLAYS',
    run: async () => {
      const key = conversationOwnershipIdempotencyKey('adapter-conv-replay-1');
      const applied: ConversationOwnershipRecord = {
        ownerConversationId: conversationId,
        ownerMerchantWorkspaceId: workspaceId,
        state: 'HUMAN_ACTIVE',
        epoch: 3,
      };
      const ledger: ReadonlyMap<ConversationOwnershipIdempotencyKey, ConversationOwnershipRecord> = new Map([[key, applied]]);
      const executor = fakeExecutor(null);
      const store = createConversationOwnershipStore(executor);
      const result = await store.applyTransition(request({ idempotencyKey: key }), actorRef, ledger);
      assert(
        result.status === 'ALREADY_APPLIED' && result.resultingRecord.epoch === 3 && result.resultingRecord.state === 'HUMAN_ACTIVE',
        'a previously-applied idempotency key must replay its original outcome even with no current row',
      );
    },
  },
  {
    id: 'COS-STORE-CONCURRENT-TRANSITION-RACE-LOSER-GETS-RACE-LOST-NOT-A-LOGICAL-CONFLICT',
    run: async () => {
      let readCount = 0;
      const executor: ConversationOwnershipQueryExecutor = {
        query(sql, params) {
          if (sql.startsWith('SELECT')) {
            readCount += 1;
            return Promise.resolve({ rows: [{ ownership_state: 'AI_ACTIVE', ownership_epoch: 0 }] });
          }
          if (sql.includes('INSERT INTO conversation_ownership_events')) {
            return Promise.resolve({ rows: [] });
          }
          // Simulate another writer having already advanced the epoch between this read and write.
          const [, , , , expectedEpoch] = params;
          if (Number(expectedEpoch) === 0 && readCount >= 1) {
            return Promise.resolve({ rows: [] });
          }
          return Promise.resolve({ rows: [{ ownership_state: params[0], ownership_epoch: params[1] }] });
        },
      };
      const store = createConversationOwnershipStore(executor);
      const result = await store.applyTransition(request(), actorRef, noPriorApplications);
      assert(result.status === 'RACE_LOST', 'a write whose CAS predicate no longer matches at write time must be a RACE_LOST, not a logical CONFLICT');
    },
  },
  {
    id: 'COS-STORE-LOGICAL-CONFLICT-FROM-STALE-CALLER-NEVER-REACHES-THE-DATABASE-WRITE',
    run: async () => {
      let writeAttempted = false;
      const executor: ConversationOwnershipQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ ownership_state: 'AI_ACTIVE', ownership_epoch: 5 }] });
          }
          writeAttempted = true;
          return Promise.resolve({ rows: [] });
        },
      };
      const store = createConversationOwnershipStore(executor);
      const result = await store.applyTransition(request({ expectedEpoch: 1 }), actorRef, noPriorApplications);
      assert(
        result.status === 'CONFLICT' && result.reason === 'STALE_EXPECTED_EPOCH',
        'a caller presenting a stale expectedEpoch against the adapter\'s own fresh read must get the pure function\'s logical CONFLICT',
      );
      assert(!writeAttempted, 'a CONFLICT decided from the read alone must never attempt a database write at all');
    },
  },
  {
    id: 'COS-STORE-TERMINAL-STATE-DENIAL-NEVER-REACHES-THE-DATABASE-WRITE',
    run: async () => {
      let writeAttempted = false;
      const executor: ConversationOwnershipQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ ownership_state: 'CLOSED', ownership_epoch: 7 }] });
          }
          writeAttempted = true;
          return Promise.resolve({ rows: [] });
        },
      };
      const store = createConversationOwnershipStore(executor);
      const result = await store.applyTransition(request({ expectedEpoch: 7, trigger: 'HUMAN_TAKEOVER' }), actorRef, noPriorApplications);
      assert(result.status === 'DENIED' && result.reason === 'TERMINAL_STATE', 'a CLOSED conversation must deny every trigger from the read alone');
      assert(!writeAttempted, 'a terminal-state denial must never attempt a database write at all');
    },
  },
  {
    id: 'COS-STORE-READ-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const store = createConversationOwnershipStore(throwingExecutor());
      const result = await store.applyTransition(request(), actorRef, noPriorApplications);
      assert(result.status === 'STORE_ERROR', 'a read exception must fail closed as STORE_ERROR, never assume no row exists');
    },
  },
  {
    id: 'COS-STORE-WRITE-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const executor: ConversationOwnershipQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ ownership_state: 'AI_ACTIVE', ownership_epoch: 0 }] });
          }
          throw new Error('simulated write failure');
        },
      };
      const store = createConversationOwnershipStore(executor);
      const result = await store.applyTransition(request(), actorRef, noPriorApplications);
      assert(result.status === 'STORE_ERROR', 'a write exception on the CAS update itself must fail closed as STORE_ERROR');
    },
  },
  {
    id: 'COS-STORE-AUDIT-INSERT-FAILURE-RETURNS-AUDIT-WRITE-FAILED-BUT-PRESERVES-THE-APPLIED-STATE-CHANGE',
    run: async () => {
      const executor = fakeExecutor({ ownership_state: 'AI_ACTIVE', ownership_epoch: 0 }, { failAuditInsert: true });
      const store = createConversationOwnershipStore(executor);
      const result = await store.applyTransition(request(), actorRef, noPriorApplications);
      assert(
        result.status === 'AUDIT_WRITE_FAILED' && result.resultingRecord.state === 'HANDOFF_REQUESTED' && result.resultingRecord.epoch === 1,
        'a failed audit insert after a successful CAS update must be reported as its own distinct outcome, never silently hidden and never claiming the CAS change did not happen',
      );
    },
  },
  {
    id: 'COS-STORE-IDEMPOTENT-RETRY-NEVER-REACHES-THE-DATABASE-WRITE',
    run: async () => {
      const key = conversationOwnershipIdempotencyKey('adapter-conv-retry-1');
      const applied: ConversationOwnershipRecord = {
        ownerConversationId: conversationId,
        ownerMerchantWorkspaceId: workspaceId,
        state: 'HUMAN_ACTIVE',
        epoch: 1,
      };
      const ledger: ReadonlyMap<ConversationOwnershipIdempotencyKey, ConversationOwnershipRecord> = new Map([[key, applied]]);
      let writeAttempted = false;
      const executor: ConversationOwnershipQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ ownership_state: 'CLOSED', ownership_epoch: 9 }] });
          }
          writeAttempted = true;
          return Promise.resolve({ rows: [] });
        },
      };
      const store = createConversationOwnershipStore(executor);
      const result = await store.applyTransition(request({ idempotencyKey: key, expectedEpoch: 0 }), actorRef, ledger);
      assert(
        result.status === 'ALREADY_APPLIED' && result.resultingRecord.epoch === 1 && result.resultingRecord.state === 'HUMAN_ACTIVE',
        'a retried request with a previously-applied idempotency key must replay the original outcome, even against a drifted/terminal current row',
      );
      assert(!writeAttempted, 'a replayed idempotent retry must never attempt a database write at all');
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} conversation ownership store (adapter) scenarios`);
}

void main();
