import { createIdempotencyLedgerStore } from '../../apps/api/src/idempotency-ledger-store';
import { internalId, type MerchantWorkspaceId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspaceId: MerchantWorkspaceId = internalId('ledger-ws-1', 'MerchantWorkspace');
const operationKey = 'test.operation';
const idempotencyKey = 'caller-key-1';

const cases: ReadonlyArray<{ readonly id: string; readonly run: () => Promise<void> }> = [
  {
    id: 'LEDGER-01-TRYGET-ON-EMPTY-TABLE-RETURNS-NOT-FOUND',
    run: async () => {
      const store = createIdempotencyLedgerStore({ query: () => Promise.resolve({ rows: [] }) });
      const result = await store.tryGet(operationKey, workspaceId, idempotencyKey);
      assert(result.status === 'NOT_FOUND', 'a missing row must be a real NOT_FOUND, never a fabricated snapshot');
    },
  },
  {
    id: 'LEDGER-02-RECORD-A-NEW-KEY-RETURNS-RECORDED',
    run: async () => {
      const store = createIdempotencyLedgerStore({
        query: () => Promise.resolve({ rows: [{ result_snapshot: JSON.stringify({ foo: 'bar' }) }] }),
      });
      const result = await store.record(operationKey, workspaceId, idempotencyKey, { foo: 'bar' });
      assert(result.status === 'RECORDED', 'a first-time INSERT that returns a row must report RECORDED');
    },
  },
  {
    id: 'LEDGER-03-TRYGET-AFTER-RECORD-ROUND-TRIPS-THE-REAL-SNAPSHOT',
    run: async () => {
      const stored = { customerId: 'cust-1', generation: 3 };
      let savedRow: Record<string, unknown> | undefined;
      const store = createIdempotencyLedgerStore({
        query: (sql, params) => {
          if (sql.includes('INSERT INTO idempotency_records')) {
            savedRow = { result_snapshot: params[3] };
            return Promise.resolve({ rows: [savedRow] });
          }
          return Promise.resolve({ rows: savedRow ? [savedRow] : [] });
        },
      });
      await store.record(operationKey, workspaceId, idempotencyKey, stored);
      const result = await store.tryGet(operationKey, workspaceId, idempotencyKey);
      assert(
        result.status === 'FOUND' && result.resultSnapshot.customerId === 'cust-1' && result.resultSnapshot.generation === 3,
        'the real stored snapshot must round-trip through JSON intact, never a fabricated or partial value',
      );
    },
  },
  {
    id: 'LEDGER-04-CONCURRENT-CONFLICT-RETURNS-ALREADY-RECORDED-WITH-THE-WINNERS-SNAPSHOT',
    run: async () => {
      const winnerSnapshot = { customerId: 'cust-winner', generation: 1 };
      const store = createIdempotencyLedgerStore({
        query: (sql) => {
          if (sql.includes('INSERT INTO idempotency_records')) return Promise.resolve({ rows: [] }); // ON CONFLICT DO NOTHING -> no row
          return Promise.resolve({ rows: [{ result_snapshot: JSON.stringify(winnerSnapshot) }] });
        },
      });
      const result = await store.record(operationKey, workspaceId, idempotencyKey, { customerId: 'cust-loser', generation: 1 });
      assert(
        result.status === 'ALREADY_RECORDED' && result.resultSnapshot.customerId === 'cust-winner',
        'a losing concurrent writer must see the actual winning snapshot, never its own unrecorded attempt and never a silent overwrite',
      );
    },
  },
  {
    id: 'LEDGER-05-TRYGET-READ-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const store = createIdempotencyLedgerStore({ query: () => Promise.reject(new Error('connection lost')) });
      const result = await store.tryGet(operationKey, workspaceId, idempotencyKey);
      assert(result.status === 'STORE_ERROR', 'a read failure must fail closed as STORE_ERROR');
    },
  },
  {
    id: 'LEDGER-06-RECORD-INSERT-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const store = createIdempotencyLedgerStore({ query: () => Promise.reject(new Error('insert failed')) });
      const result = await store.record(operationKey, workspaceId, idempotencyKey, { foo: 'bar' });
      assert(result.status === 'STORE_ERROR', 'an insert failure must fail closed as STORE_ERROR, never a false RECORDED');
    },
  },
  {
    id: 'LEDGER-07-CONFLICT-FOLLOWED-BY-A-FAILED-FOLLOW-UP-READ-RETURNS-STORE-ERROR',
    run: async () => {
      const store = createIdempotencyLedgerStore({
        query: (sql) => {
          if (sql.includes('INSERT INTO idempotency_records')) return Promise.resolve({ rows: [] });
          return Promise.reject(new Error('follow-up read failed'));
        },
      });
      const result = await store.record(operationKey, workspaceId, idempotencyKey, { foo: 'bar' });
      assert(result.status === 'STORE_ERROR', 'a conflict whose follow-up read then fails must still fail closed, never a fabricated ALREADY_RECORDED');
    },
  },
  {
    id: 'LEDGER-08-CONFLICT-WITH-NO-FOLLOW-UP-ROW-RETURNS-STORE-ERROR-DEFENSIVELY',
    run: async () => {
      const store = createIdempotencyLedgerStore({ query: () => Promise.resolve({ rows: [] }) });
      const result = await store.record(operationKey, workspaceId, idempotencyKey, { foo: 'bar' });
      assert(
        result.status === 'STORE_ERROR',
        'a conflicting insert whose winning row cannot even be found afterward must fail closed, never report a fabricated success',
      );
    },
  },
  {
    id: 'LEDGER-09-RESULT-SNAPSHOT-ALREADY-PARSED-AS-AN-OBJECT-IS-ALSO-HANDLED',
    run: async () => {
      // Some pg driver/JSONB configurations auto-parse JSONB columns into a JS object already,
      // rather than returning the raw JSON text — both representations must work.
      const store = createIdempotencyLedgerStore({
        query: () => Promise.resolve({ rows: [{ result_snapshot: { already: 'parsed' } }] }),
      });
      const result = await store.tryGet(operationKey, workspaceId, idempotencyKey);
      assert(
        result.status === 'FOUND' && result.resultSnapshot.already === 'parsed',
        'a result_snapshot that the driver already parsed into an object must be handled, not just the JSON-string form',
      );
    },
  },
  {
    id: 'LEDGER-10-OPERATION-KEY-WORKSPACE-AND-IDEMPOTENCY-KEY-ARE-ALL-PASSED-AS-REAL-QUERY-PARAMETERS',
    run: async () => {
      let capturedParams: readonly unknown[] = [];
      const store = createIdempotencyLedgerStore({
        query: (_sql, params) => {
          capturedParams = params;
          return Promise.resolve({ rows: [] });
        },
      });
      await store.tryGet('op.specific', workspaceId, 'key-specific');
      assert(
        capturedParams[0] === 'op.specific' && capturedParams[1] === workspaceId && capturedParams[2] === 'key-specific',
        'the real operationKey/workspace/idempotencyKey must all reach the query scoped exactly as given, never merged or dropped',
      );
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} idempotency ledger store (adapter) scenarios`);
}

void main();
