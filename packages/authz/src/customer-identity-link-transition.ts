import { DomainPrimitiveError } from '../../domain/src';
import type { CustomerId, CustomerIdentityId, MerchantWorkspaceId } from '../../domain/src';

/**
 * SC-05 (Conversation Core / AC-XCID-107) — pure CAS transition for the CustomerIdentity -> CustomerId
 * link pointer, grounded in the canonical D108_CLOSURE_PLAN SC-05 row's explicit gap marker
 * (CUSTOMER_LINK_LINEAGE_GAP) and its required_delta: "customer identity+verification lineage ...
 * customer linking needs reversible lineage", with closure_criterion "identity corrections are
 * reversible/auditable" and acceptance tests XCID-01..09 ("verified anonymous->known; no similarity
 * merge; cross-tenant/conflict fail-closed; reversible link lineage; verification non-transfer;
 * identity-generation stale-work fence").
 *
 * Same CAS/idempotency discipline as every prior unit this session: `expectedGeneration` is the CAS
 * precondition, never a timestamp; a successful transition advances the generation by exactly one;
 * a losing concurrent actor gets an explicit CONFLICT; a retried request (same idempotency key)
 * replays its original outcome.
 *
 * This function's own record type carries only `customerId` and `generation` — it has no field for
 * verification level/expiry at all. That is a deliberate structural property, not an omission: it
 * makes "verification non-transfer" true by construction. `CustomerIdentity.verificationLevel` /
 * `verificationExpiresAt` (domain/src/customer-identity.ts) remain properties of the identity itself,
 * read and evaluated independently (via `authorizeCustomerOrderAccess`) regardless of which
 * CustomerId this pointer is linked to; relinking can never implicitly elevate or carry over a
 * verification grant from a previous link.
 *
 * "No similarity merge" is enforced by having exactly two distinct operations rather than one
 * overloaded "set the pointer" call: LINK only succeeds against a currently-unlinked identity:
 * overwriting an existing link requires the explicit, separately-audited RELINK operation. An
 * automated best-guess match can never silently overwrite an established link merely by calling the
 * same entry point as a first-time link.
 */

export type CustomerIdentityLinkOperationKind = 'LINK' | 'RELINK' | 'UNLINK';

export type CustomerIdentityLinkIdempotencyKey = string & {
  readonly __brand: 'CustomerIdentityLinkIdempotencyKey';
};

function assertIsCustomerIdentityLinkIdempotencyKey(
  value: string,
): asserts value is CustomerIdentityLinkIdempotencyKey {
  if (!value) throw new DomainPrimitiveError('CustomerIdentityLinkIdempotencyKey must be non-empty');
}

export function customerIdentityLinkIdempotencyKey(value: string): CustomerIdentityLinkIdempotencyKey {
  const normalized = value.trim();
  assertIsCustomerIdentityLinkIdempotencyKey(normalized);
  return normalized;
}

export interface CustomerIdentityLinkRecord {
  readonly ownerCustomerIdentityId: CustomerIdentityId;
  readonly ownerMerchantWorkspaceId: MerchantWorkspaceId;
  /** Absent means currently unlinked (anonymous). */
  readonly customerId?: CustomerId;
  readonly generation: number;
}

export interface CustomerIdentityLinkRequest {
  readonly customerIdentityId: CustomerIdentityId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly operation: CustomerIdentityLinkOperationKind;
  /** Required for LINK and RELINK; ignored for UNLINK. */
  readonly targetCustomerId?: CustomerId;
  /** CAS precondition: the generation the caller last observed. Never a timestamp. */
  readonly expectedGeneration: number;
  readonly idempotencyKey: CustomerIdentityLinkIdempotencyKey;
}

export type CustomerIdentityLinkResult =
  | { readonly status: 'APPLIED'; readonly resultingRecord: CustomerIdentityLinkRecord }
  | { readonly status: 'ALREADY_APPLIED'; readonly resultingRecord: CustomerIdentityLinkRecord }
  | { readonly status: 'CONFLICT'; readonly reason: 'STALE_EXPECTED_GENERATION' }
  | {
      readonly status: 'DENIED';
      readonly reason: 'SCOPE_MISMATCH' | 'MISSING_TARGET_CUSTOMER' | 'ALREADY_LINKED' | 'NOT_LINKED';
    };

/**
 * Decision order, each a hard gate the next never reconsiders:
 *  1. Idempotency replay — a previously-APPLIED request with this exact key returns its original
 *     outcome verbatim, regardless of what `currentRecord` has since become.
 *  2. Scope match — the request's (customerIdentityId, merchantWorkspaceId) must be the record's own
 *     scope, or this is denied outright (fail-closed against cross-tenant/cross-identity conflict).
 *  3. Operation-vs-current-link-state gate — LINK requires currently unlinked (else ALREADY_LINKED,
 *     use RELINK); RELINK and UNLINK both require currently linked (else NOT_LINKED); LINK/RELINK
 *     both require a `targetCustomerId` (else MISSING_TARGET_CUSTOMER).
 *  4. CAS precondition — `expectedGeneration` must equal the current generation exactly. Any mismatch
 *     is an explicit CONFLICT, never a silent overwrite.
 * A successful transition advances the generation by exactly one. RELINK to the same customerId the
 * record already holds still advances the generation (same precedent as workspace-context-generation's
 * switch-to-same-workspace case) — the lineage event itself is what matters, not merely the resulting
 * value.
 */
export function resolveCustomerIdentityLinkTransition(
  request: CustomerIdentityLinkRequest,
  currentRecord: CustomerIdentityLinkRecord,
  appliedIdempotencyKeys: ReadonlyMap<CustomerIdentityLinkIdempotencyKey, CustomerIdentityLinkRecord>,
): CustomerIdentityLinkResult {
  const priorOutcome = appliedIdempotencyKeys.get(request.idempotencyKey);
  if (priorOutcome) {
    return { status: 'ALREADY_APPLIED', resultingRecord: priorOutcome };
  }

  if (
    request.customerIdentityId !== currentRecord.ownerCustomerIdentityId ||
    request.merchantWorkspaceId !== currentRecord.ownerMerchantWorkspaceId
  ) {
    return { status: 'DENIED', reason: 'SCOPE_MISMATCH' };
  }

  const currentlyLinked = currentRecord.customerId !== undefined;

  if (request.operation === 'LINK') {
    if (currentlyLinked) return { status: 'DENIED', reason: 'ALREADY_LINKED' };
    if (!request.targetCustomerId) return { status: 'DENIED', reason: 'MISSING_TARGET_CUSTOMER' };
  } else if (request.operation === 'RELINK') {
    if (!currentlyLinked) return { status: 'DENIED', reason: 'NOT_LINKED' };
    if (!request.targetCustomerId) return { status: 'DENIED', reason: 'MISSING_TARGET_CUSTOMER' };
  } else {
    if (!currentlyLinked) return { status: 'DENIED', reason: 'NOT_LINKED' };
  }

  if (request.expectedGeneration !== currentRecord.generation) {
    return { status: 'CONFLICT', reason: 'STALE_EXPECTED_GENERATION' };
  }

  const resultingCustomerId = request.operation === 'UNLINK' ? undefined : request.targetCustomerId;
  return {
    status: 'APPLIED',
    resultingRecord: {
      ownerCustomerIdentityId: currentRecord.ownerCustomerIdentityId,
      ownerMerchantWorkspaceId: currentRecord.ownerMerchantWorkspaceId,
      ...(resultingCustomerId !== undefined ? { customerId: resultingCustomerId } : {}),
      generation: currentRecord.generation + 1,
    },
  };
}
