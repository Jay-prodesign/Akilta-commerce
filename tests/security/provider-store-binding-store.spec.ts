import {
  createProviderStoreBindingStore,
  type ProviderStoreBindingQueryExecutor,
} from '../../apps/api/src/provider-store-binding-store';
import {
  authProviderKey,
  providerStoreBindingIdempotencyKey,
  type ProviderStoreBindingIdempotencyKey,
  type ProviderStoreBindingRecord,
  type ProviderStoreBindingRequest,
} from '../../packages/authz/src';
import { externalId, internalId, type MerchantWorkspaceId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const shopify = authProviderKey('shopify');
const storeRef = externalId('adapter-store-1.myshopify.com', 'ProviderStore');
const workspaceA: MerchantWorkspaceId = internalId('adapter-workspace-a', 'MerchantWorkspace');
const workspaceB: MerchantWorkspaceId = internalId('adapter-workspace-b', 'MerchantWorkspace');

const noPriorApplications: ReadonlyMap<ProviderStoreBindingIdempotencyKey, ProviderStoreBindingRecord> = new Map();

function bootstrapRequest(overrides: Partial<ProviderStoreBindingRequest> = {}): ProviderStoreBindingRequest {
  return {
    authProvider: shopify,
    externalStoreRef: storeRef,
    operation: 'BOOTSTRAP',
    expectedGeneration: 0,
    targetMerchantWorkspaceId: workspaceA,
    idempotencyKey: providerStoreBindingIdempotencyKey('adapter-op-1'),
    ...overrides,
  };
}

/** A minimal in-memory stand-in for the real provider_store_bindings table, enforcing the exact same CAS/uniqueness semantics a real Postgres UNIQUE + `WHERE generation = $n` would. */
function fakeExecutor(initialRow: Record<string, unknown> | null): ProviderStoreBindingQueryExecutor & {
  readonly selectCount: () => number;
} {
  let row: Record<string, unknown> | null = initialRow;
  let selectCalls = 0;
  return {
    selectCount: () => selectCalls,
    query(sql, params) {
      if (sql.startsWith('SELECT')) {
        selectCalls += 1;
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      if (sql.includes('INSERT')) {
        if (row !== null) {
          return Promise.resolve({ rows: [] }); // ON CONFLICT DO NOTHING
        }
        row = {
          merchant_workspace_id: params[3],
          generation: 1,
          revoked: false,
        };
        return Promise.resolve({ rows: [row] });
      }
      // UPDATE ... WHERE generation = $6
      const [newWorkspace, newGeneration, newRevoked, , , expectedGeneration] = params;
      if (row === null || Number(row.generation) !== Number(expectedGeneration)) {
        return Promise.resolve({ rows: [] });
      }
      row = { merchant_workspace_id: newWorkspace, generation: newGeneration, revoked: newRevoked };
      return Promise.resolve({ rows: [row] });
    },
  };
}

function throwingExecutor(): ProviderStoreBindingQueryExecutor {
  return {
    query: () => {
      throw new Error('simulated connectivity failure');
    },
  };
}

const cases: Array<{ id: string; run: () => Promise<void> }> = [
  {
    id: 'PSB-STORE-BOOTSTRAP-AGAINST-EMPTY-TABLE-APPLIES',
    run: async () => {
      const store = createProviderStoreBindingStore(fakeExecutor(null));
      const result = await store.applyTransition(bootstrapRequest(), noPriorApplications);
      assert(
        result.status === 'APPLIED' &&
          result.resultingRecord.state.generation === 1 &&
          result.resultingRecord.state.merchantWorkspaceId === workspaceA,
        'a bootstrap against an empty table must apply via INSERT at generation 1',
      );
    },
  },
  {
    id: 'PSB-STORE-CONCURRENT-BOOTSTRAP-RACE-LOSER-GETS-RACE-LOST',
    run: async () => {
      // Simulates two concurrent bootstraps: the executor's INSERT already has a row by the time
      // this adapter's own INSERT runs (another process won the UNIQUE constraint first), even
      // though this adapter's own prior SELECT saw no row — the real race window a two-step
      // read-then-write boundary must still defend against.
      const executor = fakeExecutor(null);
      // Pre-seed the "row" only at INSERT time by wrapping query to insert a competing row right
      // after the SELECT returns empty, before this adapter's own INSERT executes.
      let selectHappened = false;
      const racyExecutor: ProviderStoreBindingQueryExecutor = {
        query: (sql, params) => {
          if (sql.startsWith('SELECT')) {
            selectHappened = true;
            return Promise.resolve({ rows: [] });
          }
          if (sql.includes('INSERT')) {
            assert(selectHappened, 'INSERT must only be attempted after a SELECT');
            // A concurrent writer already committed the row — ON CONFLICT DO NOTHING fires.
            return Promise.resolve({ rows: [] });
          }
          return executor.query(sql, params);
        },
      };
      const store = createProviderStoreBindingStore(racyExecutor);
      const result = await store.applyTransition(bootstrapRequest(), noPriorApplications);
      assert(
        result.status === 'RACE_LOST',
        'a bootstrap whose INSERT affects zero rows (lost the UNIQUE race to a concurrent writer) must report RACE_LOST, never silently succeed or silently no-op',
      );
    },
  },
  {
    id: 'PSB-STORE-TRANSFER-WITH-MATCHING-CAS-APPLIES-VIA-UPDATE',
    run: async () => {
      const executor = fakeExecutor({ merchant_workspace_id: workspaceA, generation: 1, revoked: false });
      const store = createProviderStoreBindingStore(executor);
      const result = await store.applyTransition(
        bootstrapRequest({ operation: 'TRANSFER', expectedGeneration: 1, targetMerchantWorkspaceId: workspaceB }),
        noPriorApplications,
      );
      assert(
        result.status === 'APPLIED' &&
          result.resultingRecord.state.generation === 2 &&
          result.resultingRecord.state.merchantWorkspaceId === workspaceB,
        'a transfer whose CAS precondition matches the stored row must apply via UPDATE and advance the generation',
      );
    },
  },
  {
    id: 'PSB-STORE-CONCURRENT-TRANSFER-RACE-LOSER-GETS-RACE-LOST-NOT-A-LOGICAL-CONFLICT',
    run: async () => {
      // This adapter's own SELECT reads generation 1 (believing it is current), but by the time its
      // UPDATE runs, a concurrent writer has already advanced the row to generation 2 — the UPDATE's
      // WHERE generation = 1 clause now matches zero rows at the database level, even though the
      // pure decision function (working from the adapter's now-stale in-memory read) thought the
      // CAS precondition was satisfied and returned APPLIED. This is exactly the race a two-step
      // read-then-write boundary must still catch, and it is NOT the same thing as the pure
      // function's own logical CONFLICT (which only fires when the adapter's own read already
      // disagreed with the request up front).
      const racyExecutor: ProviderStoreBindingQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ merchant_workspace_id: workspaceA, generation: 1, revoked: false }] });
          }
          // Another writer already committed generation 2 before this adapter's own UPDATE ran, so
          // its WHERE generation = 1 clause matches nothing — simulate that directly.
          return Promise.resolve({ rows: [] });
        },
      };
      const store = createProviderStoreBindingStore(racyExecutor);
      const result = await store.applyTransition(
        bootstrapRequest({ operation: 'TRANSFER', expectedGeneration: 1, targetMerchantWorkspaceId: workspaceB }),
        noPriorApplications,
      );
      assert(
        result.status === 'RACE_LOST',
        'a transfer whose UPDATE affects zero rows because a concurrent writer already advanced the generation must report RACE_LOST, never silently succeed',
      );
    },
  },
  {
    id: 'PSB-STORE-LOGICAL-CONFLICT-FROM-STALE-CALLER-NEVER-REACHES-THE-DATABASE-WRITE',
    run: async () => {
      let writeAttempted = false;
      const executor: ProviderStoreBindingQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ merchant_workspace_id: workspaceA, generation: 5, revoked: false }] });
          }
          writeAttempted = true;
          return Promise.resolve({ rows: [] });
        },
      };
      const store = createProviderStoreBindingStore(executor);
      const result = await store.applyTransition(
        bootstrapRequest({ operation: 'TRANSFER', expectedGeneration: 1, targetMerchantWorkspaceId: workspaceB }),
        noPriorApplications,
      );
      assert(
        result.status === 'CONFLICT' && result.reason === 'STALE_EXPECTED_GENERATION',
        'a caller presenting a stale expectedGeneration against the adapter\'s own fresh read must get the pure function\'s logical CONFLICT',
      );
      assert(!writeAttempted, 'a logical CONFLICT decided from the read alone must never attempt a database write at all');
    },
  },
  {
    id: 'PSB-STORE-READ-FAILURE-RETURNS-STORE-ERROR-NEVER-ASSUMES-NO-RECORD',
    run: async () => {
      const store = createProviderStoreBindingStore(throwingExecutor());
      const result = await store.applyTransition(bootstrapRequest(), noPriorApplications);
      assert(result.status === 'STORE_ERROR', 'a SELECT that throws must fail closed as STORE_ERROR, never be treated as "no existing record"');
    },
  },
  {
    id: 'PSB-STORE-WRITE-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const executor: ProviderStoreBindingQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ merchant_workspace_id: workspaceA, generation: 1, revoked: false }] });
          }
          throw new Error('simulated write failure');
        },
      };
      const store = createProviderStoreBindingStore(executor);
      const result = await store.applyTransition(
        bootstrapRequest({ operation: 'TRANSFER', expectedGeneration: 1, targetMerchantWorkspaceId: workspaceB }),
        noPriorApplications,
      );
      assert(result.status === 'STORE_ERROR', 'a write that throws after a successful read must still fail closed as STORE_ERROR');
    },
  },
  {
    id: 'PSB-STORE-IDEMPOTENT-RETRY-NEVER-REACHES-THE-DATABASE-AT-ALL',
    run: async () => {
      const key = providerStoreBindingIdempotencyKey('adapter-retry-key');
      const priorApplied: ProviderStoreBindingRecord = {
        ownerAuthProvider: shopify,
        ownerExternalStoreRef: storeRef,
        state: { merchantWorkspaceId: workspaceB, generation: 2, revoked: false },
      };
      const ledger: ReadonlyMap<ProviderStoreBindingIdempotencyKey, ProviderStoreBindingRecord> = new Map([[key, priorApplied]]);
      let queried = false;
      const executor: ProviderStoreBindingQueryExecutor = {
        query: () => {
          queried = true;
          return Promise.resolve({ rows: [] });
        },
      };
      const store = createProviderStoreBindingStore(executor);
      const result = await store.applyTransition(
        bootstrapRequest({ operation: 'TRANSFER', expectedGeneration: 1, targetMerchantWorkspaceId: workspaceB, idempotencyKey: key }),
        ledger,
      );
      assert(
        result.status === 'ALREADY_APPLIED' && result.resultingRecord.state.generation === 2,
        'an idempotent replay must return the prior outcome',
      );
      assert(queried, 'the adapter still performs its read (to build currentRecord) even on a replay — only the write is skipped by the pure function already short-circuiting to ALREADY_APPLIED');
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} provider store binding store (adapter) scenarios`);
}

void main();
