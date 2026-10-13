import { DomainPrimitiveError } from '../../domain/src';
import type {
  CommercePrincipalId,
  CommerceSessionLinkState,
  ExternalCommerceSessionLinkRef,
} from './commerce-session-link';

/**
 * AC-XSESSION-107A1 slice 4 — pure CAS transition primitive only (XSESS-06). Concurrent/duplicate/
 * out-of-order link/unlink/relink attempts must converge to exactly one accepted generation advance
 * or an explicit CONFLICT — never a timestamp-ordered "last write wins". This function makes that one
 * decision; it does not read or write any durable store. A caller passes in whatever the authoritative
 * reader currently returns for this exact (principal, link) scope (`currentState`) and whatever
 * idempotency ledger it already holds (`appliedIdempotencyKeys`) — same substrate-as-plain-evidence
 * choice already used by AC-IDTEN-106D2 (membershipRoleKeys) and XSESS-01 (consumedNonces). Who durably
 * persists a newly APPLIED state, and what happens when the authoritative reader itself is unavailable,
 * is explicitly the later persistence-adapter concern (XSESS-07) and is out of scope here.
 */

export type SessionLinkOperationKind = 'LINK' | 'RELINK' | 'UNLINK';

export type SessionLinkIdempotencyKey = string & { readonly __brand: 'SessionLinkIdempotencyKey' };

function assertIsSessionLinkIdempotencyKey(value: string): asserts value is SessionLinkIdempotencyKey {
  if (!value) throw new DomainPrimitiveError('SessionLinkIdempotencyKey must be non-empty');
}

export function sessionLinkIdempotencyKey(value: string): SessionLinkIdempotencyKey {
  const normalized = value.trim();
  assertIsSessionLinkIdempotencyKey(normalized);
  return normalized;
}

/** The authoritative CAS record for one (principal, link) scope; `ownerPrincipalId`/`ownerLinkRef` bind it to that scope so a request cannot be evaluated against a record it does not actually own. */
export interface SessionLinkAuthoritativeRecord {
  readonly ownerPrincipalId: CommercePrincipalId;
  readonly ownerLinkRef: ExternalCommerceSessionLinkRef;
  readonly state: CommerceSessionLinkState;
}

export interface SessionLinkTransitionRequest {
  readonly principalId: CommercePrincipalId;
  readonly linkRef: ExternalCommerceSessionLinkRef;
  readonly operation: SessionLinkOperationKind;
  /** CAS precondition: the generation the caller last observed. Never a timestamp. */
  readonly expectedGeneration: number;
  readonly idempotencyKey: SessionLinkIdempotencyKey;
}

export type SessionLinkTransitionResult =
  | { readonly status: 'APPLIED'; readonly resultingRecord: SessionLinkAuthoritativeRecord }
  | { readonly status: 'ALREADY_APPLIED'; readonly resultingRecord: SessionLinkAuthoritativeRecord }
  | { readonly status: 'CONFLICT'; readonly reason: 'STALE_EXPECTED_GENERATION' }
  | { readonly status: 'DENIED'; readonly reason: 'SCOPE_MISMATCH' | 'ALREADY_REVOKED' };

/**
 * Decision order, each one a hard gate the next never reconsiders:
 *  1. Idempotency replay — a previously-APPLIED request with this exact key returns its original
 *     outcome verbatim, regardless of what `currentRecord` has since become. A retry can never
 *     re-advance the generation or flip a prior outcome.
 *  2. Scope match — the request's (principalId, linkRef) must be the record's own owner scope, or
 *     this is a caller/wiring defect, not a staleness condition.
 *  3. Revocation is sticky — once revoked, every further operation on this scope is DENIED, even one
 *     whose `expectedGeneration` is exactly current (a delayed-but-technically-fresh operation must
 *     not undo a revoke; this is what makes revocation irreversible by retry, not just by version).
 *  4. CAS precondition — `expectedGeneration` must equal the current generation exactly. Any mismatch
 *     (duplicate, out-of-order, or genuinely concurrent competing writer) is an explicit CONFLICT, not
 *     a silent overwrite and not resolved by comparing timestamps.
 * A successful transition advances the generation by exactly one; UNLINK also sets revoked true.
 */
export function resolveSessionLinkTransition(
  request: SessionLinkTransitionRequest,
  currentRecord: SessionLinkAuthoritativeRecord,
  appliedIdempotencyKeys: ReadonlyMap<SessionLinkIdempotencyKey, SessionLinkAuthoritativeRecord>,
): SessionLinkTransitionResult {
  const priorOutcome = appliedIdempotencyKeys.get(request.idempotencyKey);
  if (priorOutcome) {
    return { status: 'ALREADY_APPLIED', resultingRecord: priorOutcome };
  }

  if (
    request.principalId !== currentRecord.ownerPrincipalId ||
    request.linkRef !== currentRecord.ownerLinkRef
  ) {
    return { status: 'DENIED', reason: 'SCOPE_MISMATCH' };
  }

  if (currentRecord.state.revoked) {
    return { status: 'DENIED', reason: 'ALREADY_REVOKED' };
  }

  if (request.expectedGeneration !== currentRecord.state.generation) {
    return { status: 'CONFLICT', reason: 'STALE_EXPECTED_GENERATION' };
  }

  return {
    status: 'APPLIED',
    resultingRecord: {
      ownerPrincipalId: currentRecord.ownerPrincipalId,
      ownerLinkRef: currentRecord.ownerLinkRef,
      state: {
        generation: currentRecord.state.generation + 1,
        revoked: request.operation === 'UNLINK',
      },
    },
  };
}
