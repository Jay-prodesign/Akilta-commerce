import { internalId } from '../../../packages/domain/src';
import {
  resolveProviderStoreBindingTransition,
  type ProviderStoreBindingIdempotencyKey,
  type ProviderStoreBindingRecord,
  type ProviderStoreBindingRequest,
  type ProviderStoreBindingResult,
} from '../../../packages/authz/src';

/**
 * SC-02 persistence adapter for provider-store binding (ID-G10). This is the one authoritative
 * runtime boundary where `resolveProviderStoreBindingTransition`'s decision gets durably applied —
 * the pure function itself is unchanged and untouched by this file. Same split as
 * apps/api/src/membership-role-reader.ts: this executor owns no connection pool, secrets,
 * migrations, or vendor initialization; any executor that can run one parameterized SQL statement
 * and return rows satisfies the contract.
 *
 * ATOMIC TRANSITION BOUNDARY: a single `UPDATE ... WHERE generation = $n RETURNING *` (or, for a
 * first-ever binding, `INSERT ... ON CONFLICT (auth_provider, external_store_ref) DO NOTHING
 * RETURNING *`) is already atomic in PostgreSQL on its own — no explicit transaction/locking is
 * needed. The CAS precondition and the uniqueness constraint are enforced by the database itself,
 * not by application-level locking, so this adapter never reads-decides-writes across two separate
 * round trips without the database re-validating the precondition at write time.
 *
 * RECOVERY BEHAVIOR: a query that throws (connectivity/timeout/syntax) maps to `STORE_ERROR` —
 * fail closed, never assume success or fall back to a default state. A write whose `RETURNING`
 * clause comes back empty means the database's own precondition (CAS generation match, or the
 * conflict-free insert) was not met at the moment of the write — this is `RACE_LOST`, distinct from
 * the pure function's own logical `CONFLICT` (which is computed from a read that is already stale
 * the instant another writer commits between this adapter's read and write). A caller that gets
 * `RACE_LOST` should re-read current state and decide whether to retry, exactly like a `CONFLICT`.
 *
 * NON-GOALS for this unit: idempotency-key ledger persistence (the pure function still takes
 * `appliedIdempotencyKeys` as caller-supplied evidence — persisting that ledger is a separate,
 * later concern), provider OAuth/webhook verification, and any multi-row/batch operation.
 */

export interface ProviderStoreBindingQueryExecutor {
  query(sql: string, params: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

export type ProviderStoreBindingPersistOutcome =
  | ProviderStoreBindingResult
  | { readonly status: 'RACE_LOST' }
  | { readonly status: 'STORE_ERROR' };

const SELECT_CURRENT =
  'SELECT merchant_workspace_id, generation, revoked FROM provider_store_bindings WHERE auth_provider = $1 AND external_store_ref = $2';

const INSERT_BOOTSTRAP = `
  INSERT INTO provider_store_bindings
    (provider_store_binding_id, auth_provider, external_store_ref, merchant_workspace_id, generation, revoked, created_at, updated_at)
  VALUES ($1, $2, $3, $4, 1, false, now(), now())
  ON CONFLICT (auth_provider, external_store_ref) DO NOTHING
  RETURNING merchant_workspace_id, generation, revoked
`;

const UPDATE_CAS = `
  UPDATE provider_store_bindings
  SET merchant_workspace_id = $1, generation = $2, revoked = $3, updated_at = now()
  WHERE auth_provider = $4 AND external_store_ref = $5 AND generation = $6
  RETURNING merchant_workspace_id, generation, revoked
`;

function rowToRecord(
  request: Pick<ProviderStoreBindingRequest, 'authProvider' | 'externalStoreRef'>,
  row: Record<string, unknown>,
): ProviderStoreBindingRecord {
  return {
    ownerAuthProvider: request.authProvider,
    ownerExternalStoreRef: request.externalStoreRef,
    state: {
      merchantWorkspaceId: internalId(String(row.merchant_workspace_id), 'MerchantWorkspace'),
      generation: Number(row.generation),
      revoked: Boolean(row.revoked),
    },
  };
}

export interface ProviderStoreBindingStore {
  applyTransition(
    request: ProviderStoreBindingRequest,
    appliedIdempotencyKeys: ReadonlyMap<ProviderStoreBindingIdempotencyKey, ProviderStoreBindingRecord>,
  ): Promise<ProviderStoreBindingPersistOutcome>;
}

export function createProviderStoreBindingStore(
  executor: ProviderStoreBindingQueryExecutor,
): ProviderStoreBindingStore {
  return {
    async applyTransition(request, appliedIdempotencyKeys) {
      let currentRecord: ProviderStoreBindingRecord | null;
      try {
        const readResult = await executor.query(SELECT_CURRENT, [request.authProvider, request.externalStoreRef]);
        const row = readResult.rows[0];
        currentRecord = row ? rowToRecord(request, row) : null;
      } catch {
        return { status: 'STORE_ERROR' };
      }

      const decision = resolveProviderStoreBindingTransition(request, currentRecord, appliedIdempotencyKeys);
      if (decision.status !== 'APPLIED') {
        return decision;
      }

      try {
        if (currentRecord === null) {
          const insertResult = await executor.query(INSERT_BOOTSTRAP, [
            crypto.randomUUID(),
            request.authProvider,
            request.externalStoreRef,
            decision.resultingRecord.state.merchantWorkspaceId,
          ]);
          if (insertResult.rows.length === 0) {
            return { status: 'RACE_LOST' };
          }
          return decision;
        }

        const updateResult = await executor.query(UPDATE_CAS, [
          decision.resultingRecord.state.merchantWorkspaceId,
          decision.resultingRecord.state.generation,
          decision.resultingRecord.state.revoked,
          request.authProvider,
          request.externalStoreRef,
          currentRecord.state.generation,
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
