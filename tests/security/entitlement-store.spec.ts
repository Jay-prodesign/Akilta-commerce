import {
  createEntitlementStore,
  type EntitlementQueryExecutor,
} from '../../apps/api/src/entitlement-store';
import {
  entitlementIdempotencyKey,
  type EntitlementIdempotencyKey,
  type EntitlementRecord,
  type EntitlementTransitionRequest,
} from '../../packages/authz/src';
import { billingSourceRef, internalId, moduleKey, type MerchantWorkspaceId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspaceId: MerchantWorkspaceId = internalId('adapter-ent-workspace-1', 'MerchantWorkspace');
const whatsappModule = moduleKey('whatsapp-support');
const noPriorApplications: ReadonlyMap<EntitlementIdempotencyKey, EntitlementRecord> = new Map();

function request(overrides: Partial<EntitlementTransitionRequest> = {}): EntitlementTransitionRequest {
  return {
    merchantWorkspaceId: workspaceId,
    moduleKey: whatsappModule,
    trigger: 'ACTIVATE',
    expectedGeneration: 0,
    idempotencyKey: entitlementIdempotencyKey('adapter-ent-op-1'),
    ...overrides,
  };
}

function fakeExecutor(
  initialRow: Record<string, unknown> | null,
): EntitlementQueryExecutor {
  let row: Record<string, unknown> | null = initialRow;
  return {
    query(sql, params) {
      if (sql.startsWith('SELECT')) {
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      if (sql.includes('INSERT')) {
        if (row !== null) {
          return Promise.resolve({ rows: [] });
        }
        const [, , , newState, newBillingSourceRef] = params;
        row = { state: newState, generation: 1, billing_source_ref: newBillingSourceRef };
        return Promise.resolve({ rows: [row] });
      }
      const [newState, newGeneration, newBillingSourceRef, , , expectedGeneration] = params;
      if (row === null || Number(row.generation) !== Number(expectedGeneration)) {
        return Promise.resolve({ rows: [] });
      }
      row = { state: newState, generation: newGeneration, billing_source_ref: newBillingSourceRef };
      return Promise.resolve({ rows: [row] });
    },
  };
}

function throwingExecutor(): EntitlementQueryExecutor {
  return {
    query: () => {
      throw new Error('simulated connectivity failure');
    },
  };
}

const cases: Array<{ id: string; run: () => Promise<void> }> = [
  {
    id: 'ENT-STORE-FIRST-GRANT-AGAINST-EMPTY-TABLE-APPLIES-VIA-INSERT',
    run: async () => {
      const store = createEntitlementStore(fakeExecutor(null));
      const result = await store.applyTransition(request(), noPriorApplications);
      assert(
        result.status === 'APPLIED' && result.resultingRecord.state === 'ACTIVE' && result.resultingRecord.generation === 1,
        'a first ACTIVATE against an empty table must apply at generation 1 via INSERT',
      );
    },
  },
  {
    id: 'ENT-STORE-CONCURRENT-FIRST-GRANT-RACE-LOSER-GETS-RACE-LOST',
    run: async () => {
      let selectHappened = false;
      const racyExecutor: EntitlementQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            selectHappened = true;
            return Promise.resolve({ rows: [] });
          }
          assert(selectHappened, 'INSERT must only be attempted after a SELECT');
          return Promise.resolve({ rows: [] }); // a concurrent writer already won the UNIQUE scope
        },
      };
      const store = createEntitlementStore(racyExecutor);
      const result = await store.applyTransition(request(), noPriorApplications);
      assert(result.status === 'RACE_LOST', 'a concurrently-won first-grant race must report RACE_LOST, never silently succeed');
    },
  },
  {
    id: 'ENT-STORE-TRANSITION-WITH-MATCHING-CAS-APPLIES-VIA-UPDATE',
    run: async () => {
      const executor = fakeExecutor({ state: 'ACTIVE', generation: 1, billing_source_ref: null });
      const store = createEntitlementStore(executor);
      const result = await store.applyTransition(
        request({ trigger: 'ENTER_GRACE', expectedGeneration: 1 }),
        noPriorApplications,
      );
      assert(
        result.status === 'APPLIED' && result.resultingRecord.state === 'GRACE' && result.resultingRecord.generation === 2,
        'a transition whose CAS precondition matches the stored row must apply via UPDATE and advance the generation',
      );
    },
  },
  {
    id: 'ENT-STORE-CONCURRENT-TRANSITION-RACE-LOSER-GETS-RACE-LOST-NOT-A-LOGICAL-CONFLICT',
    run: async () => {
      const racyExecutor: EntitlementQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ state: 'ACTIVE', generation: 1, billing_source_ref: null }] });
          }
          // A concurrent writer already advanced the row to generation 2 before this UPDATE ran.
          return Promise.resolve({ rows: [] });
        },
      };
      const store = createEntitlementStore(racyExecutor);
      const result = await store.applyTransition(
        request({ trigger: 'ENTER_GRACE', expectedGeneration: 1 }),
        noPriorApplications,
      );
      assert(
        result.status === 'RACE_LOST',
        'a database-level lost race must report RACE_LOST, distinct from the pure function\'s own logical CONFLICT',
      );
    },
  },
  {
    id: 'ENT-STORE-LOGICAL-CONFLICT-FROM-STALE-CALLER-NEVER-REACHES-THE-DATABASE-WRITE',
    run: async () => {
      let writeAttempted = false;
      const executor: EntitlementQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ state: 'ACTIVE', generation: 5, billing_source_ref: null }] });
          }
          writeAttempted = true;
          return Promise.resolve({ rows: [] });
        },
      };
      const store = createEntitlementStore(executor);
      const result = await store.applyTransition(
        request({ trigger: 'ENTER_GRACE', expectedGeneration: 1 }),
        noPriorApplications,
      );
      assert(
        result.status === 'CONFLICT' && result.reason === 'STALE_EXPECTED_GENERATION',
        'a caller presenting a stale expectedGeneration against the adapter\'s own fresh read must get the pure function\'s logical CONFLICT',
      );
      assert(!writeAttempted, 'a CONFLICT decided from the read alone must never attempt a database write at all');
    },
  },
  {
    id: 'ENT-STORE-TERMINAL-STATE-DENIAL-NEVER-REACHES-THE-DATABASE-WRITE',
    run: async () => {
      let writeAttempted = false;
      const executor: EntitlementQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ state: 'CANCELLED', generation: 9, billing_source_ref: null }] });
          }
          writeAttempted = true;
          return Promise.resolve({ rows: [] });
        },
      };
      const store = createEntitlementStore(executor);
      const result = await store.applyTransition(
        request({ trigger: 'ACTIVATE', expectedGeneration: 9 }),
        noPriorApplications,
      );
      assert(result.status === 'DENIED' && result.reason === 'TERMINAL_STATE', 'a CANCELLED entitlement must deny every trigger from the read alone');
      assert(!writeAttempted, 'a terminal-state denial must never attempt a database write at all');
    },
  },
  {
    id: 'ENT-STORE-READ-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const store = createEntitlementStore(throwingExecutor());
      const result = await store.applyTransition(request(), noPriorApplications);
      assert(result.status === 'STORE_ERROR', 'a read exception must fail closed as STORE_ERROR, never assume no row exists');
    },
  },
  {
    id: 'ENT-STORE-WRITE-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const executor: EntitlementQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ state: 'ACTIVE', generation: 1, billing_source_ref: null }] });
          }
          throw new Error('simulated write failure');
        },
      };
      const store = createEntitlementStore(executor);
      const result = await store.applyTransition(
        request({ trigger: 'ENTER_GRACE', expectedGeneration: 1 }),
        noPriorApplications,
      );
      assert(result.status === 'STORE_ERROR', 'a write exception must fail closed as STORE_ERROR');
    },
  },
  {
    id: 'ENT-STORE-IDEMPOTENT-RETRY-NEVER-REACHES-THE-DATABASE-WRITE',
    run: async () => {
      const key = entitlementIdempotencyKey('adapter-ent-retry-1');
      const applied: EntitlementRecord = {
        ownerMerchantWorkspaceId: workspaceId,
        ownerModuleKey: whatsappModule,
        state: 'ACTIVE',
        generation: 3,
      };
      const ledger: ReadonlyMap<EntitlementIdempotencyKey, EntitlementRecord> = new Map([[key, applied]]);
      let writeAttempted = false;
      const executor: EntitlementQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ state: 'CANCELLED', generation: 9, billing_source_ref: null }] });
          }
          writeAttempted = true;
          return Promise.resolve({ rows: [] });
        },
      };
      const store = createEntitlementStore(executor);
      const result = await store.applyTransition(
        request({ idempotencyKey: key, expectedGeneration: 0 }),
        ledger,
      );
      assert(
        result.status === 'ALREADY_APPLIED' && result.resultingRecord.generation === 3 && result.resultingRecord.state === 'ACTIVE',
        'a retried request with a previously-applied idempotency key must replay the original outcome, even against a drifted/terminal current row',
      );
      assert(!writeAttempted, 'a replayed idempotent retry must never attempt a database write at all');
    },
  },
  {
    id: 'ENT-STORE-BILLING-SOURCE-REF-IS-PERSISTED-AND-ROUND-TRIPPED-ON-THE-NEXT-READ',
    run: async () => {
      const ref = billingSourceRef('shopify-billing:sub-42');
      const store = createEntitlementStore(fakeExecutor(null));
      const first = await store.applyTransition(
        request({ trigger: 'START_TRIAL', billingSourceRef: ref }),
        noPriorApplications,
      );
      assert(first.status === 'APPLIED' && first.resultingRecord.billingSourceRef === ref, 'billingSourceRef must be persisted on the first INSERT');

      const second = await store.applyTransition(
        request({ trigger: 'ENTER_GRACE', expectedGeneration: 1 }),
        noPriorApplications,
      );
      assert(
        second.status === 'APPLIED' && second.resultingRecord.billingSourceRef === ref,
        'a subsequent transition that does not supply a new billingSourceRef must carry forward the value read back from the store on the prior row, not lose it',
      );
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} entitlement store (adapter) scenarios`);
}

void main();
