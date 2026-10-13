import {
  createWorkspaceContextStore,
  type WorkspaceContextQueryExecutor,
} from '../../apps/api/src/workspace-context-store';
import {
  workspaceContextIdempotencyKey,
  type ContextPrincipalId,
  type WorkspaceContextIdempotencyKey,
  type WorkspaceContextState,
  type WorkspaceContextSwitchRequest,
} from '../../packages/authz/src';
import { internalId, type MerchantWorkspaceId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const principalId: ContextPrincipalId = internalId('adapter-context-principal-1', 'User');
const workspaceA: MerchantWorkspaceId = internalId('adapter-context-workspace-a', 'MerchantWorkspace');
const workspaceB: MerchantWorkspaceId = internalId('adapter-context-workspace-b', 'MerchantWorkspace');

const noPriorApplications: ReadonlyMap<WorkspaceContextIdempotencyKey, WorkspaceContextState> = new Map();

function switchRequest(overrides: Partial<WorkspaceContextSwitchRequest> = {}): WorkspaceContextSwitchRequest {
  return {
    principalId,
    expectedGeneration: 1,
    targetMerchantWorkspaceId: workspaceB,
    idempotencyKey: workspaceContextIdempotencyKey('adapter-context-op-1'),
    ...overrides,
  };
}

function fakeExecutor(initialRow: Record<string, unknown> | null): WorkspaceContextQueryExecutor {
  let row: Record<string, unknown> | null = initialRow;
  return {
    query(sql, params) {
      if (sql.startsWith('SELECT')) {
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      const [newWorkspace, newGeneration, , expectedGeneration] = params;
      if (row === null || Number(row.generation) !== Number(expectedGeneration)) {
        return Promise.resolve({ rows: [] });
      }
      row = { merchant_workspace_id: newWorkspace, generation: newGeneration };
      return Promise.resolve({ rows: [row] });
    },
  };
}

const cases: Array<{ id: string; run: () => Promise<void> }> = [
  {
    id: 'WCS-STORE-SWITCH-WITH-MATCHING-CAS-APPLIES-VIA-UPDATE',
    run: async () => {
      const executor = fakeExecutor({ merchant_workspace_id: workspaceA, generation: 1 });
      const store = createWorkspaceContextStore(executor);
      const result = await store.applyTransition(switchRequest(), noPriorApplications);
      assert(
        result.status === 'APPLIED' && result.resultingState.generation === 2 && result.resultingState.merchantWorkspaceId === workspaceB,
        'a switch whose CAS precondition matches the stored row must apply via UPDATE and advance the generation',
      );
    },
  },
  {
    id: 'WCS-STORE-NO-EXISTING-ROW-RETURNS-NO-EXISTING-CONTEXT-NOT-STORE-ERROR',
    run: async () => {
      const store = createWorkspaceContextStore(fakeExecutor(null));
      const result = await store.applyTransition(switchRequest(), noPriorApplications);
      assert(
        result.status === 'NO_EXISTING_CONTEXT',
        'a principal with no workspace context row yet must get NO_EXISTING_CONTEXT, a legitimate state, not STORE_ERROR',
      );
    },
  },
  {
    id: 'WCS-STORE-NO-EXISTING-ROW-BUT-PRIOR-IDEMPOTENCY-HIT-STILL-REPLAYS',
    run: async () => {
      const key = workspaceContextIdempotencyKey('context-retry-key');
      const priorApplied: WorkspaceContextState = { merchantWorkspaceId: workspaceB, generation: 2 };
      const ledger: ReadonlyMap<WorkspaceContextIdempotencyKey, WorkspaceContextState> = new Map([[key, priorApplied]]);
      const store = createWorkspaceContextStore(fakeExecutor(null));
      const result = await store.applyTransition(switchRequest({ idempotencyKey: key }), ledger);
      assert(
        result.status === 'ALREADY_APPLIED' && result.resultingState.generation === 2,
        'a previously-applied idempotency key must still replay its outcome even if the row no longer exists',
      );
    },
  },
  {
    id: 'WCS-STORE-CONCURRENT-SWITCH-RACE-LOSER-GETS-RACE-LOST',
    run: async () => {
      const racyExecutor: WorkspaceContextQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ merchant_workspace_id: workspaceA, generation: 1 }] });
          }
          // A concurrent writer already advanced the row to generation 2 before this UPDATE ran.
          return Promise.resolve({ rows: [] });
        },
      };
      const store = createWorkspaceContextStore(racyExecutor);
      const result = await store.applyTransition(switchRequest(), noPriorApplications);
      assert(result.status === 'RACE_LOST', 'a database-level lost race must report RACE_LOST, distinct from the pure function\'s own logical CONFLICT');
    },
  },
  {
    id: 'WCS-STORE-LOGICAL-CONFLICT-FROM-STALE-CALLER-NEVER-REACHES-THE-DATABASE-WRITE',
    run: async () => {
      let writeAttempted = false;
      const executor: WorkspaceContextQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ merchant_workspace_id: workspaceA, generation: 5 }] });
          }
          writeAttempted = true;
          return Promise.resolve({ rows: [] });
        },
      };
      const store = createWorkspaceContextStore(executor);
      const result = await store.applyTransition(switchRequest({ expectedGeneration: 1 }), noPriorApplications);
      assert(
        result.status === 'CONFLICT' && result.reason === 'STALE_EXPECTED_GENERATION',
        'a caller presenting a stale expectedGeneration against the adapter\'s own fresh read must get the pure function\'s logical CONFLICT',
      );
      assert(!writeAttempted, 'a CONFLICT decided from the read alone must never attempt a database write at all');
    },
  },
  {
    id: 'WCS-STORE-READ-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const executor: WorkspaceContextQueryExecutor = {
        query: () => {
          throw new Error('simulated connectivity failure');
        },
      };
      const store = createWorkspaceContextStore(executor);
      const result = await store.applyTransition(switchRequest(), noPriorApplications);
      assert(result.status === 'STORE_ERROR', 'a SELECT that throws must fail closed as STORE_ERROR');
    },
  },
  {
    id: 'WCS-STORE-WRITE-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const executor: WorkspaceContextQueryExecutor = {
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            return Promise.resolve({ rows: [{ merchant_workspace_id: workspaceA, generation: 1 }] });
          }
          throw new Error('simulated write failure');
        },
      };
      const store = createWorkspaceContextStore(executor);
      const result = await store.applyTransition(switchRequest(), noPriorApplications);
      assert(result.status === 'STORE_ERROR', 'a write that throws after a successful read must still fail closed as STORE_ERROR');
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} workspace context store (adapter) scenarios`);
}

void main();
