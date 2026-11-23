import {
  resolveEntitlementTransition,
  type EntitlementIdempotencyKey,
  type EntitlementRecord,
  type EntitlementTransitionRequest,
  type EntitlementTransitionResult,
} from '../../../packages/authz/src';
import {
  billingSourceRef,
  DomainPrimitiveError,
  ENTITLEMENT_STATES,
  type EntitlementState,
} from '../../../packages/domain/src';

function assertIsEntitlementState(value: string): asserts value is EntitlementState {
  if (!(ENTITLEMENT_STATES as readonly string[]).includes(value)) {
    throw new DomainPrimitiveError(`Unrecognized entitlement state from store: ${value}`);
  }
}

function parseEntitlementState(value: unknown): EntitlementState {
  const candidate = String(value);
  assertIsEntitlementState(candidate);
  return candidate;
}

/**
 * SC-04 persistence adapter for the EffectiveEntitlement CAS transition (AC-BILLENT-106). Same split
 * and same atomic-boundary technique as commerce-session-link-store.ts: `resolveEntitlementTransition`
 * is unchanged and untouched by this file. A missing row is the structural NONE state (no grant has
 * ever existed for this workspace+module) rather than a store error, so the first grant is a
 * conflict-free `INSERT ... ON CONFLICT DO NOTHING RETURNING *`, every later transition a CAS
 * `UPDATE ... WHERE generation = $n RETURNING *` — the same bridging technique
 * commerce-session-link-store.ts uses via its own synthetic baseline record.
 *
 * `resolveEntitlementTransition` itself has no explicit "no row yet" case; this adapter supplies the
 * NONE/generation-0 baseline so a first START_TRIAL/ACTIVATE is just an ordinary CAS transition
 * whose `expectedGeneration` must be exactly 0, never a special case in the decision function.
 */

export interface EntitlementQueryExecutor {
  query(sql: string, params: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

export type EntitlementPersistOutcome =
  | EntitlementTransitionResult
  | { readonly status: 'RACE_LOST' }
  | { readonly status: 'STORE_ERROR' };

const SELECT_CURRENT =
  'SELECT state, generation, billing_source_ref FROM entitlements WHERE merchant_workspace_id = $1 AND module_key = $2';

const INSERT_FIRST_GRANT = `
  INSERT INTO entitlements
    (entitlement_id, merchant_workspace_id, module_key, state, generation, billing_source_ref, created_at, updated_at)
  VALUES ($1, $2, $3, $4, 1, $5, now(), now())
  ON CONFLICT (merchant_workspace_id, module_key) DO NOTHING
  RETURNING state, generation, billing_source_ref
`;

const UPDATE_CAS = `
  UPDATE entitlements
  SET state = $1, generation = $2, billing_source_ref = $3, updated_at = now()
  WHERE merchant_workspace_id = $4 AND module_key = $5 AND generation = $6
  RETURNING state, generation, billing_source_ref
`;

function baselineRecord(
  request: EntitlementTransitionRequest,
): EntitlementRecord {
  return {
    ownerMerchantWorkspaceId: request.merchantWorkspaceId,
    ownerModuleKey: request.moduleKey,
    state: 'NONE',
    generation: 0,
  };
}

function toRecord(
  request: EntitlementTransitionRequest,
  row: Record<string, unknown>,
): EntitlementRecord {
  const rawBillingSourceRef = row.billing_source_ref;
  return {
    ownerMerchantWorkspaceId: request.merchantWorkspaceId,
    ownerModuleKey: request.moduleKey,
    state: parseEntitlementState(row.state),
    generation: Number(row.generation),
    ...(typeof rawBillingSourceRef === 'string' ? { billingSourceRef: billingSourceRef(rawBillingSourceRef) } : {}),
  };
}

export interface EntitlementStore {
  applyTransition(
    request: EntitlementTransitionRequest,
    appliedIdempotencyKeys: ReadonlyMap<EntitlementIdempotencyKey, EntitlementRecord>,
  ): Promise<EntitlementPersistOutcome>;
}

export function createEntitlementStore(executor: EntitlementQueryExecutor): EntitlementStore {
  return {
    async applyTransition(request, appliedIdempotencyKeys) {
      let currentRecord: EntitlementRecord;
      let rowExisted: boolean;
      try {
        const readResult = await executor.query(SELECT_CURRENT, [request.merchantWorkspaceId, request.moduleKey]);
        const row = readResult.rows[0];
        rowExisted = Boolean(row);
        currentRecord = row ? toRecord(request, row) : baselineRecord(request);
      } catch {
        return { status: 'STORE_ERROR' };
      }

      const decision = resolveEntitlementTransition(request, currentRecord, appliedIdempotencyKeys);
      if (decision.status !== 'APPLIED') {
        return decision;
      }

      try {
        if (!rowExisted) {
          const insertResult = await executor.query(INSERT_FIRST_GRANT, [
            crypto.randomUUID(),
            request.merchantWorkspaceId,
            request.moduleKey,
            decision.resultingRecord.state,
            decision.resultingRecord.billingSourceRef ?? null,
          ]);
          if (insertResult.rows.length === 0) {
            return { status: 'RACE_LOST' };
          }
          return decision;
        }

        const updateResult = await executor.query(UPDATE_CAS, [
          decision.resultingRecord.state,
          decision.resultingRecord.generation,
          decision.resultingRecord.billingSourceRef ?? null,
          request.merchantWorkspaceId,
          request.moduleKey,
          currentRecord.generation,
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
