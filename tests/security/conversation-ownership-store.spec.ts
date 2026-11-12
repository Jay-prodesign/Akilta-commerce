import {
  createConversationOwnershipStore,
  type ConversationOwnershipQueryExecutor,
} from '../../apps/api/src/conversation-ownership-store';
import {
  createIdempotencyLedgerStore,
  type IdempotencyLedgerQueryExecutor,
  type IdempotencyLedgerReadOutcome,
  type IdempotencyLedgerStore,
  type IdempotencyLedgerWriteOutcome,
} from '../../apps/api/src/idempotency-ledger-store';
import {
  conversationOwnershipIdempotencyKey,
  type ConversationOwnershipTransitionRequest,
} from '../../packages/authz/src';
import { internalId, type ConversationId, type MerchantWorkspaceId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const conversationId: ConversationId = internalId('adapter-conv-1', 'Conversation');
const workspaceId: MerchantWorkspaceId = internalId('adapter-conv-workspace-1', 'MerchantWorkspace');
const actorRef = 'system:test-actor';

function fakeLedger(overrides: Partial<IdempotencyLedgerStore> = {}): IdempotencyLedgerStore {
  return {
    tryGet: (): Promise<IdempotencyLedgerReadOutcome> => Promise.resolve({ status: 'NOT_FOUND' }),
    record: (): Promise<IdempotencyLedgerWriteOutcome> => Promise.resolve({ status: 'RECORDED' }),
    ...overrides,
  };
}

// A genuine in-memory simulation of the real `idempotency_records` table (same INSERT/conflict/SELECT
// semantics as idempotency-ledger-store.ts's own SQL) — used by the real-round-trip test so it proves
// actual scoping behavior end-to-end, not merely that a mocked call received some different string.
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
      const store = createConversationOwnershipStore(executor, fakeLedger());
      const result = await store.applyTransition(request(), actorRef);
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
      const store = createConversationOwnershipStore(executor, fakeLedger());
      const result = await store.applyTransition(request(), actorRef);
      assert(result.status === 'NO_EXISTING_CONVERSATION', 'a missing conversation row is a legitimate state, not a store failure');
    },
  },
  {
    id: 'COS-STORE-NO-EXISTING-ROW-BUT-PRIOR-IDEMPOTENCY-HIT-STILL-REPLAYS',
    run: async () => {
      const key = conversationOwnershipIdempotencyKey('adapter-conv-replay-1');
      const ledger = fakeLedger({
        tryGet: () => Promise.resolve({ status: 'FOUND', resultSnapshot: { state: 'HUMAN_ACTIVE', epoch: 3 } }),
      });
      const executor = fakeExecutor(null);
      const store = createConversationOwnershipStore(executor, ledger);
      const result = await store.applyTransition(request({ idempotencyKey: key }), actorRef);
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
      const store = createConversationOwnershipStore(executor, fakeLedger());
      const result = await store.applyTransition(request(), actorRef);
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
      const store = createConversationOwnershipStore(executor, fakeLedger());
      const result = await store.applyTransition(request({ expectedEpoch: 1 }), actorRef);
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
      const store = createConversationOwnershipStore(executor, fakeLedger());
      const result = await store.applyTransition(request({ expectedEpoch: 7, trigger: 'HUMAN_TAKEOVER' }), actorRef);
      assert(result.status === 'DENIED' && result.reason === 'TERMINAL_STATE', 'a CLOSED conversation must deny every trigger from the read alone');
      assert(!writeAttempted, 'a terminal-state denial must never attempt a database write at all');
    },
  },
  {
    id: 'COS-STORE-READ-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const store = createConversationOwnershipStore(throwingExecutor(), fakeLedger());
      const result = await store.applyTransition(request(), actorRef);
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
      const store = createConversationOwnershipStore(executor, fakeLedger());
      const result = await store.applyTransition(request(), actorRef);
      assert(result.status === 'STORE_ERROR', 'a write exception on the CAS update itself must fail closed as STORE_ERROR');
    },
  },
  {
    id: 'COS-STORE-AUDIT-INSERT-FAILURE-RETURNS-AUDIT-WRITE-FAILED-BUT-PRESERVES-THE-APPLIED-STATE-CHANGE',
    run: async () => {
      const executor = fakeExecutor({ ownership_state: 'AI_ACTIVE', ownership_epoch: 0 }, { failAuditInsert: true });
      const store = createConversationOwnershipStore(executor, fakeLedger());
      const result = await store.applyTransition(request(), actorRef);
      assert(
        result.status === 'AUDIT_WRITE_FAILED' &&
          result.resultingRecord.state === 'HANDOFF_REQUESTED' &&
          result.resultingRecord.epoch === 1 &&
          result.ledgerWriteFailed === false,
        'a failed audit insert after a successful CAS update and a successful ledger write must be reported as its own distinct outcome, never silently hidden, never claiming the CAS change did not happen, and never misreporting the (successful) ledger write as having also failed',
      );
    },
  },
  {
    id: 'COS-STORE-BOTH-LEDGER-AND-AUDIT-WRITE-FAILURES-ARE-BOTH-REPORTED-NEITHER-SILENTLY-DROPPED',
    run: async () => {
      const executor = fakeExecutor({ ownership_state: 'AI_ACTIVE', ownership_epoch: 0 }, { failAuditInsert: true });
      const store = createConversationOwnershipStore(executor, fakeLedger({ record: () => Promise.resolve({ status: 'STORE_ERROR' }) }));
      const result = await store.applyTransition(request(), actorRef);
      assert(
        result.status === 'AUDIT_WRITE_FAILED' && result.ledgerWriteFailed === true,
        'when the ledger write AND the audit insert both fail in the same request, the outcome must still be AUDIT_WRITE_FAILED with ledgerWriteFailed:true — the ledger failure must never be silently overwritten by the later audit-insert failure',
      );
    },
  },
  {
    id: 'COS-STORE-IDEMPOTENT-RETRY-NEVER-REACHES-THE-DATABASE-WRITE',
    run: async () => {
      const key = conversationOwnershipIdempotencyKey('adapter-conv-retry-1');
      const ledger = fakeLedger({
        tryGet: () => Promise.resolve({ status: 'FOUND', resultSnapshot: { state: 'HUMAN_ACTIVE', epoch: 1 } }),
      });
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
      const store = createConversationOwnershipStore(executor, ledger);
      const result = await store.applyTransition(request({ idempotencyKey: key, expectedEpoch: 0 }), actorRef);
      assert(
        result.status === 'ALREADY_APPLIED' && result.resultingRecord.epoch === 1 && result.resultingRecord.state === 'HUMAN_ACTIVE',
        'a retried request with a previously-applied idempotency key must replay the original outcome, even against a drifted/terminal current row',
      );
      assert(!writeAttempted, 'a replayed idempotent retry must never attempt a database write at all');
    },
  },
  {
    id: 'COS-STORE-LEDGER-READ-FAILURE-RETURNS-STORE-ERROR-EVEN-THOUGH-THE-ROW-READ-RUNS-CONCURRENTLY',
    run: async () => {
      // The ledger lookup and the conversations row read now run via Promise.all (independent reads,
      // no correctness dependency on each other) rather than serially, so the row read DOES still run
      // even when the ledger read fails — the assertion here is that the failure is still reported
      // correctly, not that the row read was skipped (it deliberately no longer is).
      const executor: ConversationOwnershipQueryExecutor = {
        query: () => Promise.resolve({ rows: [{ ownership_state: 'AI_ACTIVE', ownership_epoch: 0 }] }),
      };
      const store = createConversationOwnershipStore(executor, fakeLedger({ tryGet: () => Promise.resolve({ status: 'STORE_ERROR' }) }));
      const result = await store.applyTransition(request(), actorRef);
      assert(result.status === 'STORE_ERROR', 'a ledger read failure must fail closed as STORE_ERROR regardless of what the concurrent row read found');
    },
  },
  {
    id: 'COS-STORE-LEDGER-WRITE-FAILURE-STILL-REPORTS-LEDGER-WRITE-FAILED-NOT-A-PLAIN-STORE-ERROR',
    run: async () => {
      const executor = fakeExecutor({ ownership_state: 'AI_ACTIVE', ownership_epoch: 0 });
      const store = createConversationOwnershipStore(executor, fakeLedger({ record: () => Promise.resolve({ status: 'STORE_ERROR' }) }));
      const result = await store.applyTransition(request(), actorRef);
      assert(
        result.status === 'LEDGER_WRITE_FAILED' && result.resultingRecord.state === 'HANDOFF_REQUESTED' && result.resultingRecord.epoch === 1,
        'a ledger write failure after a successful CAS update must never be reported as a plain STORE_ERROR — the transition itself was really applied',
      );
    },
  },
  {
    id: 'COS-STORE-LEDGER-ALREADY-RECORDED-STILL-REPORTS-THIS-REQUESTS-OWN-REAL-CAS-RESULT-NOT-SOME-OTHER-ENTRYS',
    run: async () => {
      // Unlike message-draft-store.ts, this store's own CAS UPDATE has already uniquely mutated the
      // row by the time ledger.record() runs — a true concurrent duplicate would already have been
      // filtered out as RACE_LOST/CONFLICT before reaching here. So an ALREADY_RECORDED outcome here
      // can only mean this idempotency key was reused for a different, already-completed transition
      // (a caller bug) — and this request's own real, fresher outcome must still be what gets
      // reported, never the other (here: valid-looking but unrelated/stale) entry's snapshot.
      const executor = fakeExecutor({ ownership_state: 'AI_ACTIVE', ownership_epoch: 0 });
      const store = createConversationOwnershipStore(
        executor,
        fakeLedger({
          record: () =>
            Promise.resolve({ status: 'ALREADY_RECORDED', resultSnapshot: { state: 'HUMAN_ACTIVE', epoch: 9 } }),
        }),
      );
      const result = await store.applyTransition(request(), actorRef);
      assert(
        result.status === 'LEDGER_WRITE_FAILED' && result.resultingRecord.state === 'HANDOFF_REQUESTED' && result.resultingRecord.epoch === 1,
        "an ALREADY_RECORDED ledger outcome must report this request's own real resultingRecord (HANDOFF_REQUESTED/epoch 1), never the other, unrelated ledger entry's snapshot (HUMAN_ACTIVE/epoch 9)",
      );
    },
  },
  {
    id: 'COS-STORE-MALFORMED-LEDGER-SNAPSHOT-ON-REPLAY-FAILS-CLOSED-AS-STORE-ERROR',
    run: async () => {
      const store = createConversationOwnershipStore(
        fakeExecutor(null),
        fakeLedger({ tryGet: () => Promise.resolve({ status: 'FOUND', resultSnapshot: { state: 'NOT_A_REAL_STATE', epoch: 'not-a-number' } }) }),
      );
      const result = await store.applyTransition(request(), actorRef);
      assert(result.status === 'STORE_ERROR', 'a malformed/corrupted ledger snapshot on replay must fail closed as STORE_ERROR, never throw uncaught');
    },
  },
  {
    id: 'COS-STORE-ALREADY-RECORDED-WITH-AN-UNPARSEABLE-SNAPSHOT-NEVER-THROWS-AND-STILL-REPORTS-THE-REAL-CAS-RESULT',
    run: async () => {
      // Proves the snapshot is never even read/parsed for ALREADY_RECORDED (not merely that a parse
      // failure falls back gracefully) — a malformed snapshot here must behave identically to a valid
      // one (the previous test case), both resulting in this request's own real resultingRecord.
      const executor = fakeExecutor({ ownership_state: 'AI_ACTIVE', ownership_epoch: 0 });
      const store = createConversationOwnershipStore(
        executor,
        fakeLedger({
          record: () => Promise.resolve({ status: 'ALREADY_RECORDED', resultSnapshot: { state: 'NOT_A_REAL_STATE' } }),
        }),
      );
      const result = await store.applyTransition(request(), actorRef);
      assert(
        result.status === 'LEDGER_WRITE_FAILED' && result.resultingRecord.state === 'HANDOFF_REQUESTED' && result.resultingRecord.epoch === 1,
        'an unparseable ALREADY_RECORDED snapshot must never throw uncaught and must still report this own request\'s real resultingRecord via LEDGER_WRITE_FAILED',
      );
    },
  },
  {
    id: 'COS-STORE-REAL-LEDGER-ROUND-TRIP-SCOPES-BY-CONVERSATION-AND-REPLAYS-CORRECTLY',
    run: async () => {
      const conversationA: ConversationId = internalId('adapter-conv-real-A', 'Conversation');
      const conversationB: ConversationId = internalId('adapter-conv-real-B', 'Conversation');
      const sharedKey = conversationOwnershipIdempotencyKey('shared-raw-key');
      const ledger = createIdempotencyLedgerStore(statefulLedgerExecutor());

      const executorA = fakeExecutor({ ownership_state: 'AI_ACTIVE', ownership_epoch: 0 });
      const storeA = createConversationOwnershipStore(executorA, ledger);
      const firstForA = await storeA.applyTransition(
        request({ conversationId: conversationA, idempotencyKey: sharedKey, expectedEpoch: 0 }),
        actorRef,
      );
      assert(firstForA.status === 'APPLIED', 'first transition for conversation A with a fresh key must apply');

      const executorB = fakeExecutor({ ownership_state: 'AI_ACTIVE', ownership_epoch: 0 });
      const storeB = createConversationOwnershipStore(executorB, ledger);
      const firstForB = await storeB.applyTransition(
        request({ conversationId: conversationB, idempotencyKey: sharedKey, expectedEpoch: 0 }),
        actorRef,
      );
      assert(
        firstForB.status === 'APPLIED',
        'conversation B reusing the SAME raw key as conversation A must never be treated as a replay — real cross-conversation non-collision',
      );

      const retryForA = await storeA.applyTransition(
        request({ conversationId: conversationA, idempotencyKey: sharedKey, expectedEpoch: 5 }),
        actorRef,
      );
      assert(
        retryForA.status === 'ALREADY_APPLIED' &&
          firstForA.status === 'APPLIED' &&
          retryForA.resultingRecord.epoch === firstForA.resultingRecord.epoch &&
          retryForA.resultingRecord.state === firstForA.resultingRecord.state,
        'retrying conversation A with the same key (even with a now-stale expectedEpoch) must replay its own real first outcome — real same-conversation idempotency',
      );
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
