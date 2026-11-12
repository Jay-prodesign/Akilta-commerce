import {
  resolveCustomerIdentityLinkTransition,
  type CustomerIdentityLinkIdempotencyKey,
  type CustomerIdentityLinkRecord,
  type CustomerIdentityLinkRequest,
  type CustomerIdentityLinkResult,
} from '../../../packages/authz/src';
import { internalId, type CustomerIdentityId, type MerchantWorkspaceId } from '../../../packages/domain/src';
import type { IdempotencyLedgerStore } from './idempotency-ledger-store';

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
 *
 * Idempotency is backed by the durable `idempotency-ledger-store.ts` (stage 4/4 of that retrofit —
 * stage 1 the generic adapter, stage 2 `message-draft-store.ts`, stage 3
 * `conversation-ownership-store.ts`). The caller-injected `appliedIdempotencyKeys` map this adapter
 * used to accept has been removed entirely; the one real prior-outcome lookup
 * `resolveCustomerIdentityLinkTransition` needs is now sourced from a single `ledger.tryGet` call per
 * `applyTransition`, keyed by `scopedLedgerKey` (customerIdentityId + operation + the raw
 * caller-supplied key — same JSON-encoding collision-safety technique as the other two retrofitted
 * stores). The route-layer-composed scoped key from the original AC-XCID-107 unit
 * (`JSON.stringify([workspaceId, customerIdentityId, operation, rawKey])`) is removed from
 * `customer-identity-link-route.ts`: `merchantWorkspaceId` no longer needs to be folded in by hand
 * (the ledger's own primary key already carries it as a separate column), but `operation` still does
 * — unlike `conversation-ownership-store.ts` (whose `trigger` likewise never appears in its own key,
 * but whose single `CONVERSATION_OWNERSHIP_OPERATION_KEY` genuinely identifies one transition kind)
 * or `message-draft-store.ts` (one create operation), this store's single
 * `CUSTOMER_IDENTITY_LINK_OPERATION_KEY` passed to the ledger covers three distinct operations
 * (LINK/RELINK/UNLINK), so `operationKey` alone does NOT scope by logical operation the way the
 * now-removed route-layer key used to — `scopedLedgerKey` folds `request.operation` into the key
 * string itself specifically to preserve that distinction. The pure decision function's own
 * signature/contract and tests are entirely unchanged.
 *
 * Learning carried over directly from `conversation-ownership-store.ts`'s own independent-review
 * finding (not rediscovered here): this store's CAS UPDATE has already uniquely and authoritatively
 * mutated the row by the time `ledger.record(...)` is called, so an `ALREADY_RECORDED` ledger outcome
 * can only mean idempotency-key reuse across a different, already-completed transition on the same
 * identity (a caller bug) — never a genuine concurrent duplicate, which would already have been
 * filtered out as `RACE_LOST`/`CONFLICT` beforehand. `ALREADY_RECORDED` is therefore treated exactly
 * like `STORE_ERROR`: this request's own real `resultingRecord` is always what gets reported, never
 * some other, unrelated ledger entry's snapshot.
 */

const CUSTOMER_IDENTITY_LINK_OPERATION_KEY = 'customer_identity.link';

// Unlike conversation-ownership-store.ts (a single transition kind driven by `trigger`, which is
// never part of its own scoped key either) and message-draft-store.ts (a single create operation),
// this store's `CUSTOMER_IDENTITY_LINK_OPERATION_KEY` passed to the ledger is one constant shared by
// three distinct operations (LINK/RELINK/UNLINK). `request.operation` MUST therefore be folded into
// the scoped key string itself, or a caller reusing the same raw idempotencyKey across two different
// operations on the same identity (e.g. LINK then RELINK) would incorrectly replay the first
// operation's result instead of executing the second.
function scopedLedgerKey(
  customerIdentityId: CustomerIdentityId,
  operation: CustomerIdentityLinkRequest['operation'],
  idempotencyKey: CustomerIdentityLinkIdempotencyKey,
): string {
  return JSON.stringify([customerIdentityId, operation, idempotencyKey]);
}

function serializeRecordForLedger(record: CustomerIdentityLinkRecord): Record<string, unknown> {
  return { customerId: record.customerId ?? null, generation: record.generation };
}

function deserializeRecordFromLedger(
  snapshot: Readonly<Record<string, unknown>>,
  customerIdentityId: CustomerIdentityId,
  merchantWorkspaceId: MerchantWorkspaceId,
): CustomerIdentityLinkRecord {
  const generationCandidate = snapshot.generation;
  if (typeof generationCandidate !== 'number' || !Number.isInteger(generationCandidate)) {
    throw new Error('idempotency ledger snapshot for customer_identity.link is missing a usable generation');
  }
  const customerIdCandidate = snapshot.customerId;
  return {
    ownerCustomerIdentityId: customerIdentityId,
    ownerMerchantWorkspaceId: merchantWorkspaceId,
    ...(typeof customerIdCandidate === 'string' ? { customerId: internalId(customerIdCandidate, 'Customer') } : {}),
    generation: generationCandidate,
  };
}

export interface CustomerIdentityLinkQueryExecutor {
  query(sql: string, params: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

export type CustomerIdentityLinkPersistOutcome =
  | CustomerIdentityLinkResult
  | { readonly status: 'RACE_LOST' }
  | { readonly status: 'NO_EXISTING_IDENTITY' }
  | { readonly status: 'STORE_ERROR' }
  | { readonly status: 'AUDIT_WRITE_FAILED'; readonly resultingRecord: CustomerIdentityLinkRecord; readonly ledgerWriteFailed: boolean }
  | { readonly status: 'LEDGER_WRITE_FAILED'; readonly resultingRecord: CustomerIdentityLinkRecord };

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

export function createCustomerIdentityLinkStore(
  executor: CustomerIdentityLinkQueryExecutor,
  ledger: IdempotencyLedgerStore,
): CustomerIdentityLinkStore {
  return {
    async getCurrent(customerIdentityId, merchantWorkspaceId) {
      const read = await readCurrentRow(executor, customerIdentityId, merchantWorkspaceId);
      if (read.outcome === 'READ_ERROR') return { status: 'STORE_ERROR' };
      if (read.outcome === 'NOT_FOUND') return { status: 'NOT_FOUND' };
      return { status: 'FOUND', record: read.record };
    },
    async applyTransition(request, actorRef) {
      const scopedKey = scopedLedgerKey(request.customerIdentityId, request.operation, request.idempotencyKey);
      // Independent reads — see conversation-ownership-store.ts's identical Promise.all for the
      // reasoning (neither callee rejects; both are needed only at the decision step below).
      const [replay, read] = await Promise.all([
        ledger.tryGet(CUSTOMER_IDENTITY_LINK_OPERATION_KEY, request.merchantWorkspaceId, scopedKey),
        readCurrentRow(executor, request.customerIdentityId, request.merchantWorkspaceId),
      ]);
      if (replay.status === 'STORE_ERROR') return { status: 'STORE_ERROR' };
      if (read.outcome === 'READ_ERROR') return { status: 'STORE_ERROR' };

      let appliedIdempotencyKeys: ReadonlyMap<CustomerIdentityLinkIdempotencyKey, CustomerIdentityLinkRecord> = new Map();
      if (replay.status === 'FOUND') {
        try {
          const priorRecord = deserializeRecordFromLedger(
            replay.resultSnapshot,
            request.customerIdentityId,
            request.merchantWorkspaceId,
          );
          appliedIdempotencyKeys = new Map([[request.idempotencyKey, priorRecord]]);
        } catch {
          return { status: 'STORE_ERROR' };
        }
      }

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

      const ledgerOutcome = await ledger.record(
        CUSTOMER_IDENTITY_LINK_OPERATION_KEY,
        request.merchantWorkspaceId,
        scopedKey,
        serializeRecordForLedger(decision.resultingRecord),
      );
      // ALREADY_RECORDED is treated exactly like STORE_ERROR — see this file's own doc comment and
      // conversation-ownership-store.ts's identical reasoning: this request's own CAS UPDATE has
      // already uniquely mutated the row, so any pre-existing ledger entry under this exact scoped key
      // can only be a different, unrelated transition (idempotency-key reuse), never a genuine
      // concurrent duplicate.
      const ledgerWriteFailed = ledgerOutcome.status !== 'RECORDED';

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
        // The ledger write's own outcome must never be silently lost just because the audit insert
        // also failed — both flags are independently reported, never merged into one.
        return { status: 'AUDIT_WRITE_FAILED', resultingRecord: decision.resultingRecord, ledgerWriteFailed };
      }

      if (ledgerWriteFailed) {
        // The authority-bearing CAS update (and the audit insert) already succeeded; only the
        // idempotency ledger write failed. Never report this as a plain STORE_ERROR, which would
        // falsely imply nothing happened.
        return { status: 'LEDGER_WRITE_FAILED', resultingRecord: decision.resultingRecord };
      }

      return decision;
    },
  };
}
