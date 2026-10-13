import type { ExternalId, UserId } from '../../domain/src';

/**
 * AC-XSESSION-107A1 slice 1 — pure currentness primitive only (XSESS-03). No persistence/runtime
 * reader exists yet: this mirrors the same split already proven by AC-IDTEN-106D2 -> 106D3 (pure
 * deterministic derivation first, server-owned reader adapter later, never invented together). A
 * caller must never construct CommerceSessionLinkState itself from a copied/cached claim; it is a
 * placeholder for whatever a later server-owned reader returns for the exact scope below.
 */

export type CommercePrincipalId = UserId;
export type ExternalCommerceSessionLinkRef = ExternalId<'CommerceSessionLink'>;

/**
 * The server-owned durable state for one linked Commerce session, exactly as it exists right now.
 * `generation` increments on every relink/rotate; `revoked` is set true on unlink and is sticky —
 * nothing in this module ever turns a revoked link back into a valid one.
 */
export interface CommerceSessionLinkState {
  readonly generation: number;
  readonly revoked: boolean;
}

export interface CommerceSessionLinkSnapshot {
  readonly principalId: CommercePrincipalId;
  readonly externalLinkRef: ExternalCommerceSessionLinkRef;
  readonly generation: number;
  readonly revoked: boolean;
  /** Deterministic encoding of the fields above; never equal across different generation/revoked state. */
  readonly linkVersion: string;
}

export type SessionLinkAuthorityResult =
  | { readonly status: 'READY'; readonly snapshot: CommerceSessionLinkSnapshot }
  | { readonly status: 'DENIED'; readonly reason: 'SESSION_LINK_REVOKED' | 'STALE_SESSION_LINK_REF' };

/**
 * Collision-safe canonical JSON encoding, same technique as permission-authority's authorityVersion:
 * explicit array structure via JSON.stringify, no delimiter-concatenation ambiguity between
 * structurally different inputs. No wall-clock, no randomness.
 */
function deriveLinkVersion(
  principalId: CommercePrincipalId,
  externalLinkRef: ExternalCommerceSessionLinkRef,
  state: CommerceSessionLinkState,
): string {
  return JSON.stringify([principalId, externalLinkRef, state.generation, state.revoked]);
}

/** Pure derivation from already-obtained current state; exposed directly so it is unit-testable without an injected reader. */
export function resolveCommerceSessionLinkSnapshot(
  principalId: CommercePrincipalId,
  externalLinkRef: ExternalCommerceSessionLinkRef,
  state: CommerceSessionLinkState,
): CommerceSessionLinkSnapshot {
  return {
    principalId,
    externalLinkRef,
    generation: state.generation,
    revoked: state.revoked,
    linkVersion: deriveLinkVersion(principalId, externalLinkRef, state),
  };
}

/**
 * Decision-time check. `claimedLinkVersion` is whatever the caller presents (a cached/copied value
 * from a prior response, never trusted as current on its own). Revocation denies unconditionally,
 * even when the claimed version happens to still match the freshly-derived one for a revoked state
 * (XSESS-03: an authoritative unlink/revoke must deny a copied external token/cache that remains
 * otherwise permissive). A mismatched claim against a non-revoked state denies as stale — this is
 * what rejects a copied token after relink/rotation (a new generation) without needing a separate
 * revoked flag for that case: the version itself already changed.
 */
export function evaluateSessionLinkCurrentness(
  claimedLinkVersion: string,
  principalId: CommercePrincipalId,
  externalLinkRef: ExternalCommerceSessionLinkRef,
  state: CommerceSessionLinkState,
): SessionLinkAuthorityResult {
  const snapshot = resolveCommerceSessionLinkSnapshot(principalId, externalLinkRef, state);
  if (snapshot.revoked) {
    return { status: 'DENIED', reason: 'SESSION_LINK_REVOKED' };
  }
  if (claimedLinkVersion !== snapshot.linkVersion) {
    return { status: 'DENIED', reason: 'STALE_SESSION_LINK_REF' };
  }
  return { status: 'READY', snapshot };
}
