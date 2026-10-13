import {
  createCommerceSessionLinkStore,
  type CommerceSessionLinkQueryExecutor,
} from '../../apps/api/src/commerce-session-link-store';
import {
  sessionLinkIdempotencyKey,
  type CommercePrincipalId,
  type ExternalCommerceSessionLinkRef,
  type SessionLinkAuthoritativeRecord,
  type SessionLinkIdempotencyKey,
  type SessionLinkTransitionRequest,
} from '../../packages/authz/src';
import { externalId, internalId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const principalId: CommercePrincipalId = internalId('adapter-session-principal-1', 'User');
const linkRef: ExternalCommerceSessionLinkRef = externalId('adapter-session-link-1', 'CommerceSessionLink');

const noPriorApplications: ReadonlyMap<SessionLinkIdempotencyKey, SessionLinkAuthoritativeRecord> = new Map();

function linkRequest(overrides: Partial<SessionLinkTransitionRequest> = {}): SessionLinkTransitionRequest {
  return {
    principalId,
    linkRef,
    operation: 'LINK',
    expectedGeneration: 0,
    idempotencyKey: sessionLinkIdempotencyKey('adapter-session-op-1'),
    ...overrides,
  };
}

function fakeExecutor(initialRow: Record<string, unknown> | null): CommerceSessionLinkQueryExecutor {
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
        row = { generation: 1, revoked: params[3] };
        return Promise.resolve({ rows: [row] });
      }
      const [newGeneration, newRevoked, , , expectedGeneration] = params;
      if (row === null || Number(row.generation) !== Number(expectedGeneration)) {
        return Promise.resolve({ rows: [] });
      }
      row = { generation: newGeneration, revoked: newRevoked };
      return Promise.resolve({ rows: [row] });
    },
  };
}

function throwingExecutor(): CommerceSessionLinkQueryExecutor {
  return {
    query: () => {
      throw new Error('simulated connectivity failure');
    },
  };
}

const cases: Array<{ id: string; run: () => Promise<void> }> = [
  {
    id: 'CSL-STORE-FIRST-LINK-AGAINST-EMPTY-TABLE-APPLIES-VIA-INSERT',
    run: async () => {
      const store = createCommerceSessionLinkStore(fakeExecutor(null));
      const result = await store.applyTransition(linkRequest(), noPriorApplications);
      assert(
        result.status === 'APPLIED' && result.resultingRecord.state.generation === 1,
        'a first LINK against an empty table must apply at generation 1 via INSERT',
      );
    },
  },
  {
    id: 'CSL-STORE-CONCURRENT-FIRST-LINK-RACE-LOSER-GETS-RACE-LOST',
    run: async () => {
      let selectHappened = false;
      const racyExecutor: CommerceSessionLinkQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            selectHappened = true;
            return Promise.resolve({ rows: [] });
          }
          assert(selectHappened, 'INSERT must only be attempted after a SELECT');
          return Promise.resolve({ rows: [] }); // a concurrent writer already won the UNIQUE scope
        },
      };
      const store = createCommerceSessionLinkStore(racyExecutor);
      const result = await store.applyTransition(linkRequest(), noPriorApplications);
      assert(result.status === 'RACE_LOST', 'a concurrently-won first-link race must report RACE_LOST, never silently succeed');
    },
  },
  {
    id: 'CSL-STORE-RELINK-WITH-MATCHING-CAS-APPLIES-VIA-UPDATE',
    run: async () => {
      const executor = fakeExecutor({ generation: 1, revoked: false });
      const store = createCommerceSessionLinkStore(executor);
      const result = await store.applyTransition(
        linkRequest({ operation: 'RELINK', expectedGeneration: 1 }),
        noPriorApplications,
      );
      assert(
        result.status === 'APPLIED' && result.resultingRecord.state.generation === 2,
        'a RELINK whose CAS precondition matches the stored row must apply via UPDATE and advance the generation',
      );
    },
  },
  {
    id: 'CSL-STORE-CONCURRENT-RELINK-RACE-LOSER-GETS-RACE-LOST-NOT-A-LOGICAL-CONFLICT',
    run: async () => {
      const racyExecutor: CommerceSessionLinkQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ generation: 1, revoked: false }] });
          }
          // A concurrent writer already advanced the row to generation 2 before this UPDATE ran.
          return Promise.resolve({ rows: [] });
        },
      };
      const store = createCommerceSessionLinkStore(racyExecutor);
      const result = await store.applyTransition(
        linkRequest({ operation: 'RELINK', expectedGeneration: 1 }),
        noPriorApplications,
      );
      assert(result.status === 'RACE_LOST', 'a database-level lost race on RELINK must report RACE_LOST, distinct from the pure function\'s own logical CONFLICT');
    },
  },
  {
    id: 'CSL-STORE-LOGICAL-CONFLICT-FROM-STALE-CALLER-NEVER-REACHES-THE-DATABASE-WRITE',
    run: async () => {
      let writeAttempted = false;
      const executor: CommerceSessionLinkQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ generation: 5, revoked: false }] });
          }
          writeAttempted = true;
          return Promise.resolve({ rows: [] });
        },
      };
      const store = createCommerceSessionLinkStore(executor);
      const result = await store.applyTransition(
        linkRequest({ operation: 'RELINK', expectedGeneration: 1 }),
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
    id: 'CSL-STORE-UNINSTALL-STYLE-UNLINK-SETS-REVOKED',
    run: async () => {
      const executor = fakeExecutor({ generation: 2, revoked: false });
      const store = createCommerceSessionLinkStore(executor);
      const result = await store.applyTransition(
        linkRequest({ operation: 'UNLINK', expectedGeneration: 2 }),
        noPriorApplications,
      );
      assert(
        result.status === 'APPLIED' && result.resultingRecord.state.revoked === true && result.resultingRecord.state.generation === 3,
        'UNLINK must advance the generation and set revoked true',
      );
    },
  },
  {
    id: 'CSL-STORE-REVOKED-ROW-DENIES-FURTHER-RELINK-EVEN-WITH-CORRECT-CAS',
    run: async () => {
      const executor = fakeExecutor({ generation: 3, revoked: true });
      const store = createCommerceSessionLinkStore(executor);
      const result = await store.applyTransition(
        linkRequest({ operation: 'RELINK', expectedGeneration: 3 }),
        noPriorApplications,
      );
      assert(
        result.status === 'DENIED' && result.reason === 'ALREADY_REVOKED',
        'a revoked row must deny a further RELINK even with a technically-correct CAS precondition, read correctly from the database',
      );
    },
  },
  {
    id: 'CSL-STORE-READ-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const store = createCommerceSessionLinkStore(throwingExecutor());
      const result = await store.applyTransition(linkRequest(), noPriorApplications);
      assert(result.status === 'STORE_ERROR', 'a SELECT that throws must fail closed as STORE_ERROR');
    },
  },
  {
    id: 'CSL-STORE-WRITE-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const executor: CommerceSessionLinkQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ generation: 1, revoked: false }] });
          }
          throw new Error('simulated write failure');
        },
      };
      const store = createCommerceSessionLinkStore(executor);
      const result = await store.applyTransition(
        linkRequest({ operation: 'RELINK', expectedGeneration: 1 }),
        noPriorApplications,
      );
      assert(result.status === 'STORE_ERROR', 'a write that throws after a successful read must still fail closed as STORE_ERROR');
    },
  },
  {
    id: 'CSL-STORE-IDEMPOTENT-RETRY-SKIPS-THE-WRITE',
    run: async () => {
      const key = sessionLinkIdempotencyKey('adapter-session-retry-key');
      const priorApplied: SessionLinkAuthoritativeRecord = {
        ownerPrincipalId: principalId,
        ownerLinkRef: linkRef,
        state: { generation: 2, revoked: false },
      };
      const ledger: ReadonlyMap<SessionLinkIdempotencyKey, SessionLinkAuthoritativeRecord> = new Map([[key, priorApplied]]);
      let writeAttempted = false;
      const executor: CommerceSessionLinkQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ generation: 9, revoked: false }] });
          }
          writeAttempted = true;
          return Promise.resolve({ rows: [] });
        },
      };
      const store = createCommerceSessionLinkStore(executor);
      const result = await store.applyTransition(
        linkRequest({ operation: 'RELINK', expectedGeneration: 1, idempotencyKey: key }),
        ledger,
      );
      assert(
        result.status === 'ALREADY_APPLIED' && result.resultingRecord.state.generation === 2,
        'an idempotent replay must return the prior outcome regardless of drifted current state',
      );
      assert(!writeAttempted, 'a replay decided from the idempotency ledger must never attempt a database write');
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} commerce session link store (adapter) scenarios`);
}

void main();
