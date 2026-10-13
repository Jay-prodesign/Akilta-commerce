import { DomainPrimitiveError, type UtcTimestamp } from '../../domain/src';

/**
 * AC-XSESSION-107A1 slice 3 — pure federated exchange admission primitive only (XSESS-01). Nonce
 * replay detection needs a durable ledger, but — mirroring AC-IDTEN-106D2's established substrate
 * choice for role keys — that ledger is represented here as a plain caller-supplied evidence set
 * (`consumedNonces`, same shape as `membershipCandidates`/`agencyAssignmentCandidates`), not an
 * injected reader/writer port. The decision itself stays pure and testable now; who durably records
 * a consumed nonce across requests is a later persistence-adapter concern, exactly as "who populates
 * membershipCandidates from a real Membership table" was outside 106A/106B/106C's scope.
 *
 * This function only decides whether to ADMIT an external federated-exchange envelope for further
 * Commerce-side identity binding (auth-identity.ts); it structurally cannot return a Commerce role,
 * workspace or entitlement grant — `FederatedExchangeAdmissionResult` has no such field — those
 * remain exclusively resolved by the existing membership/agency/permission authority seams.
 */

function assertNonEmpty(value: string, label: string): void {
  if (!value) throw new DomainPrimitiveError(`${label} must be non-empty`);
}

export type FederatedExchangeAudience = string & { readonly __brand: 'FederatedExchangeAudience' };
export type FederatedExchangePurpose = string & { readonly __brand: 'FederatedExchangePurpose' };
export type FederatedExchangeNonce = string & { readonly __brand: 'FederatedExchangeNonce' };

function assertIsFederatedExchangeAudience(value: string): asserts value is FederatedExchangeAudience {
  assertNonEmpty(value, 'FederatedExchangeAudience');
}
function assertIsFederatedExchangePurpose(value: string): asserts value is FederatedExchangePurpose {
  assertNonEmpty(value, 'FederatedExchangePurpose');
}
function assertIsFederatedExchangeNonce(value: string): asserts value is FederatedExchangeNonce {
  assertNonEmpty(value, 'FederatedExchangeNonce');
}

export function federatedExchangeAudience(value: string): FederatedExchangeAudience {
  const normalized = value.trim();
  assertIsFederatedExchangeAudience(normalized);
  return normalized;
}

export function federatedExchangePurpose(value: string): FederatedExchangePurpose {
  const normalized = value.trim();
  assertIsFederatedExchangePurpose(normalized);
  return normalized;
}

export function federatedExchangeNonce(value: string): FederatedExchangeNonce {
  const normalized = value.trim();
  assertIsFederatedExchangeNonce(normalized);
  return normalized;
}

/** The untrusted envelope presented by the external (AKILTA) side for a Commerce session-link exchange. */
export interface FederatedExchangeEnvelope {
  readonly audience: FederatedExchangeAudience;
  readonly purpose: FederatedExchangePurpose;
  readonly version: string;
  readonly nonce: FederatedExchangeNonce;
  readonly issuedAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
}

/** Server-owned expectation this Commerce deployment currently requires; never derived from the envelope itself. */
export interface FederatedExchangePolicy {
  readonly expectedAudience: FederatedExchangeAudience;
  readonly expectedPurpose: FederatedExchangePurpose;
  readonly expectedVersion: string;
}

export type FederatedExchangeAdmissionResult =
  | { readonly status: 'ADMITTED' }
  | {
      readonly status: 'DENIED';
      readonly reason: 'WRONG_AUDIENCE' | 'WRONG_PURPOSE' | 'WRONG_VERSION' | 'EXPIRED' | 'NONCE_REPLAYED';
    };

function isExpired(expiresAt: UtcTimestamp, now: UtcTimestamp): boolean {
  return new Date(expiresAt).getTime() <= new Date(now).getTime();
}

/**
 * Decision-time check. Structural mismatch (audience/purpose/version) is checked before freshness,
 * which is checked before replay — a wrong-audience envelope is rejected for that reason even if it
 * also happens to be expired or to reuse a consumed nonce. `consumedNonces` is whatever the caller
 * currently has on record; this function only reads it and never itself decides how/when a nonce is
 * recorded as consumed.
 */
export function evaluateFederatedExchangeAdmission(
  envelope: FederatedExchangeEnvelope,
  policy: FederatedExchangePolicy,
  consumedNonces: ReadonlySet<FederatedExchangeNonce>,
  now: UtcTimestamp,
): FederatedExchangeAdmissionResult {
  if (envelope.audience !== policy.expectedAudience) {
    return { status: 'DENIED', reason: 'WRONG_AUDIENCE' };
  }
  if (envelope.purpose !== policy.expectedPurpose) {
    return { status: 'DENIED', reason: 'WRONG_PURPOSE' };
  }
  if (envelope.version !== policy.expectedVersion) {
    return { status: 'DENIED', reason: 'WRONG_VERSION' };
  }
  if (isExpired(envelope.expiresAt, now)) {
    return { status: 'DENIED', reason: 'EXPIRED' };
  }
  if (consumedNonces.has(envelope.nonce)) {
    return { status: 'DENIED', reason: 'NONCE_REPLAYED' };
  }
  return { status: 'ADMITTED' };
}
