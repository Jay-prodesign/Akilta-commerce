import { internalId } from '../../../packages/domain/src';
import {
  resolveWorkspaceContextSwitch,
  type WorkspaceContextIdempotencyKey,
  type WorkspaceContextState,
  type WorkspaceContextSwitchRequest,
  type WorkspaceContextSwitchResult,
} from '../../../packages/authz/src';

/**
 * SC-02 persistence adapter for workspace-context switch (XSESS-05). Same split and atomic-boundary
 * technique as provider-store-binding-store.ts and commerce-session-link-store.ts:
 * `resolveWorkspaceContextSwitch` is unchanged and untouched by this file.
 *
 * Unlike the other two SC-02 adapters, this one has no INSERT/bootstrap path at all: a principal's
 * very first workspace context (onboarding) is explicitly out of scope for the pure switch function
 * itself (see its doc comment), so this adapter only ever UPDATEs an already-existing row. A missing
 * row is `NO_EXISTING_CONTEXT`, not `STORE_ERROR` — it is a legitimate state (this principal has no
 * workspace context yet), not a failure — unless the exact idempotency key was already applied
 * before, in which case the prior outcome replays even though no row currently exists for it.
 */

export interface WorkspaceContextQueryExecutor {
  query(sql: string, params: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

export type WorkspaceContextPersistOutcome =
  | WorkspaceContextSwitchResult
  | { readonly status: 'RACE_LOST' }
  | { readonly status: 'NO_EXISTING_CONTEXT' }
  | { readonly status: 'STORE_ERROR' };

const SELECT_CURRENT = 'SELECT merchant_workspace_id, generation FROM workspace_contexts WHERE principal_id = $1';

const UPDATE_CAS = `
  UPDATE workspace_contexts
  SET merchant_workspace_id = $1, generation = $2, updated_at = now()
  WHERE principal_id = $3 AND generation = $4
  RETURNING merchant_workspace_id, generation
`;

export interface WorkspaceContextStore {
  applyTransition(
    request: WorkspaceContextSwitchRequest,
    appliedIdempotencyKeys: ReadonlyMap<WorkspaceContextIdempotencyKey, WorkspaceContextState>,
  ): Promise<WorkspaceContextPersistOutcome>;
}

export function createWorkspaceContextStore(executor: WorkspaceContextQueryExecutor): WorkspaceContextStore {
  return {
    async applyTransition(request, appliedIdempotencyKeys) {
      let row: Record<string, unknown> | undefined;
      try {
        const readResult = await executor.query(SELECT_CURRENT, [request.principalId]);
        row = readResult.rows[0];
      } catch {
        return { status: 'STORE_ERROR' };
      }

      if (!row) {
        const priorOutcome = appliedIdempotencyKeys.get(request.idempotencyKey);
        if (priorOutcome) {
          return { status: 'ALREADY_APPLIED', resultingState: priorOutcome };
        }
        return { status: 'NO_EXISTING_CONTEXT' };
      }

      const currentState: WorkspaceContextState = {
        merchantWorkspaceId: internalId(String(row.merchant_workspace_id), 'MerchantWorkspace'),
        generation: Number(row.generation),
      };

      const decision = resolveWorkspaceContextSwitch(request, currentState, appliedIdempotencyKeys);
      if (decision.status !== 'APPLIED') {
        return decision;
      }

      try {
        const updateResult = await executor.query(UPDATE_CAS, [
          decision.resultingState.merchantWorkspaceId,
          decision.resultingState.generation,
          request.principalId,
          currentState.generation,
        ]);
        if (updateResult.rows.length === 0) {
          return { status: 'RACE_LOST' };
        }
        return decision;
      } catch {
        return { status: 'STORE_ERROR' };
      }
    },
  };
}
