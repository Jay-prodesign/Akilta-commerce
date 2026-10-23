import {
  resolveCustomerIdentityLinkTransition,
  type CustomerIdentityLinkIdempotencyKey,
  type CustomerIdentityLinkRecord,
  type CustomerIdentityLinkRequest,
  type CustomerIdentityLinkResult,
} from '../../../packages/authz/src';
import { internalId, type CustomerIdentityId, type MerchantWorkspaceId } from '../../../packages/domain/src';

/**
 * SC-05 (Conversation Core / AC-XCID-107) persistence adapter for the CustomerIdentity -> CustomerId
 * link pointer. Same split and atomic-boundary technique as `conversation-ownership-store.ts`:
 * `resolveCustomerIdentityLinkTransition` (the pure CAS decision) is unchanged and untouched by this
 * file.
 *
 * UPDATE-only, like `conversation-ownership-store.ts`: a `customer_identities` row (with its initial
 * `customer_id`/`link_generation`) is always created by the identity-resolution path itself, a
 * separate, not-yet-built adapter concern. A missing row here is a legitimate NO_EXISTING_IDENTITY
 * state, not a STORE_ERROR, unless the exact idempotency key was already applied before, in which
 * case the prior outcome replays regardless.
 *
 * Also appends to the pre-existing, already-migrated `customer_identity_link_events` audit table
 * (`CHECK (to_generation = from_generation + 1)`) — the real lineage trail the canonical XCID closure
 * criterion "identity corrections are reversible/auditable" requires. The CAS update and the audit
 * insert are two separate statements (same disclosed limitation as every other audited adapter this
 * session: no transaction primitive exists anywhere in this codebase yet). If the CAS update succeeds
 * but the audit insert then fails, this is reported as its own distinct `AUDIT_WRITE_FAILED` outcome
 * carrying the already-applied `resultingRecord` — the authority-bearing change is real and must never
 * be hidden or implied rolled back, but the incomplete audit trail must never be silently swallowed as
 * a plain, fully-evidenced success either.
 */

export interface CustomerIdentityLinkQueryExecutor {
  query(sql: string, params: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

export type CustomerIdentityLinkPersistOutcome =
  | CustomerIdentityLinkResult
  | { readonly status: 'RACE_LOST' }
  | { readonly status: 'NO_EXISTING_IDENTITY' }
  | { readonly status: 'STORE_ERROR' }
  | { readonly status: 'AUDIT_WRITE_FAILED'; readonly resultingRecord: CustomerIdentityLinkRecord };

export type CustomerIdentityLinkReadOutcome =
  | { readonly status: 'FOUND'; readonly record: CustomerIdentityLinkRecord }
  | { readonly status: 'NOT_FOUND' }
  | { readonly status: 'STORE_ERROR' };

const SELECT_CURRENT =
  'SELECT customer_id, link_generation FROM customer_identities WHERE customer_identity_id = $1 AND merchant_workspace_id = $2';

const UPDATE_CAS = `
  UPDATE customer_identities
  SET customer_id = $1, link_generation = $2, updated_at = now()
  WHERE customer_identity_id = $3 AND merchant_workspace_id = $4 AND link_generation = $5
  RETURNING customer_id, link_generation
`;

const INSERT_AUDIT_EVENT = `
  INSERT INTO customer_identity_link_events
    (link_event_id, customer_identity_id, merchant_workspace_id, operation, from_customer_id, to_customer_id, from_generation, to_generation, actor_ref, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
`;

export interface CustomerIdentityLinkStore {
  applyTransition(
    request: CustomerIdentityLinkRequest,
    actorRef: string,
    appliedIdempotencyKeys: ReadonlyMap<CustomerIdentityLinkIdempotencyKey, CustomerIdentityLinkRecord>,
  ): Promise<CustomerIdentityLinkPersistOutcome>;
  /** Plain, non-mutating read of the current link pointer/generation (same SELECT_CURRENT query
   * `applyTransition` already runs internally), exposed directly so a caller can discover the current
   * `generation` it must pass as the CAS precondition on a subsequent LINK/RELINK/UNLINK call. */
  getCurrent(
    customerIdentityId: CustomerIdentityId,
    merchantWorkspaceId: MerchantWorkspaceId,
  ): Promise<CustomerIdentityLinkReadOutcome>;
}

type CurrentRowReadResult =
  | { readonly outcome: 'FOUND'; readonly record: CustomerIdentityLinkRecord }
  | { readonly outcome: 'NOT_FOUND' }
  | { readonly outcome: 'READ_ERROR' };

async function readCurrentRow(
  executor: CustomerIdentityLinkQueryExecutor,
  customerIdentityId: CustomerIdentityId,
  merchantWorkspaceId: MerchantWorkspaceId,
): Promise<CurrentRowReadResult> {
  try {
    const readResult = await executor.query(SELECT_CURRENT, [customerIdentityId, merchantWorkspaceId]);
    const row = readResult.rows[0];
    if (!row) return { outcome: 'NOT_FOUND' };
    const rawCustomerId = row.customer_id;
    return {
      outcome: 'FOUND',
      record: {
        ownerCustomerIdentityId: customerIdentityId,
        ownerMerchantWorkspaceId: merchantWorkspaceId,
        ...(typeof rawCustomerId === 'string' ? { customerId: internalId(rawCustomerId, 'Customer') } : {}),
        generation: Number(row.link_generation),
      },
    };
  } catch {
    return { outcome: 'READ_ERROR' };
  }
}

export function createCustomerIdentityLinkStore(executor: CustomerIdentityLinkQueryExecutor): CustomerIdentityLinkStore {
  return {
    async getCurrent(customerIdentityId, merchantWorkspaceId) {
      const read = await readCurrentRow(executor, customerIdentityId, merchantWorkspaceId);
      if (read.outcome === 'READ_ERROR') return { status: 'STORE_ERROR' };
      if (read.outcome === 'NOT_FOUND') return { status: 'NOT_FOUND' };
      return { status: 'FOUND', record: read.record };
    },
    async applyTransition(request, actorRef, appliedIdempotencyKeys) {
      const read = await readCurrentRow(executor, request.customerIdentityId, request.merchantWorkspaceId);
      if (read.outcome === 'READ_ERROR') return { status: 'STORE_ERROR' };

      if (read.outcome === 'NOT_FOUND') {
        const priorOutcome = appliedIdempotencyKeys.get(request.idempotencyKey);
        if (priorOutcome) {
          return { status: 'ALREADY_APPLIED', resultingRecord: priorOutcome };
        }
        return { status: 'NO_EXISTING_IDENTITY' };
      }

      const currentRecord = read.record;

      const decision = resolveCustomerIdentityLinkTransition(request, currentRecord, appliedIdempotencyKeys);
      if (decision.status !== 'APPLIED') {
        return decision;
      }

      try {
        const updateResult = await executor.query(UPDATE_CAS, [
          decision.resultingRecord.customerId ?? null,
          decision.resultingRecord.generation,
          request.customerIdentityId,
          request.merchantWorkspaceId,
          currentRecord.generation,
        ]);
        if (updateResult.rows.length === 0) {
          return { status: 'RACE_LOST' };
        }
      } catch {
        return { status: 'STORE_ERROR' };
      }

      try {
        await executor.query(INSERT_AUDIT_EVENT, [
          crypto.randomUUID(),
          request.customerIdentityId,
          request.merchantWorkspaceId,
          request.operation,
          currentRecord.customerId ?? null,
          decision.resultingRecord.customerId ?? null,
          currentRecord.generation,
          decision.resultingRecord.generation,
          actorRef,
        ]);
      } catch {
        return { status: 'AUDIT_WRITE_FAILED', resultingRecord: decision.resultingRecord };
      }

      return decision;
    },
  };
}
