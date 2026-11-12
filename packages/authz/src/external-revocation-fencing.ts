import type {
  CommercePrincipalId,
  ExternalCommerceSessionLinkRef,
} from './commerce-session-link';
import type { SessionLinkAuthoritativeRecord } from './commerce-session-link-transition';

/**
 * AC-XSESSION-107A1 (XSESS-04) — "external AKILTA logout/revocation fences only sessions actually
 * derived from that link under declared policy, not unrelated independently authenticated Commerce
 * sessions."
 *
 * Declared policy (routine technical scoping, not a new architecture): an external revocation signal
 * can only ever declare the one thing the external (AKILTA) side actually knows about a Commerce
 * federation — its own `externalLinkRef`. It has no visibility into, and therefore can never
 * legitimately name, any OTHER Commerce session-link or any independently-authenticated Commerce
 * session (`auth-identity.ts`'s `UserIdentity` / `AuthenticatedPrincipal`, a structurally separate
 * record this module never reads or references). Fencing is therefore defined as: a signal may only
 * ever target the exact session-link record whose `ownerLinkRef` equals the signal's declared
 * `externalLinkRef` — never a different link, never a different principal's link, and never anything
 * outside the session-link record type at all.
 *
 * This composes with, and does not duplicate, `resolveSessionLinkTransition`'s existing UNLINK
 * operation and its already-proven SCOPE_MISMATCH fail-closed behavior (XSESS-06): this function only
 * decides whether a given record is in scope for a signal at all. The caller only invokes UNLINK for a
 * `TARGETED` result; a `NOT_TARGETED` record must not be touched by this signal, full stop.
 */

export interface ExternalRevocationSignal {
  readonly externalLinkRef: ExternalCommerceSessionLinkRef;
}

export type ExternalRevocationFencingResult =
  | { readonly status: 'TARGETED'; readonly principalId: CommercePrincipalId; readonly externalLinkRef: ExternalCommerceSessionLinkRef }
  | { readonly status: 'NOT_TARGETED' };

/**
 * `candidateRecord` is null when the caller has no session-link record at all for whatever scope it
 * was checking (e.g. an unrelated principal who never linked to AKILTA) — trivially NOT_TARGETED.
 * Otherwise the match is exact-equality on `ownerLinkRef` only; there is no broader "same principal"
 * or "same issuer" fallback, because the external signal's only legitimate claim is its own link ref.
 */
export function resolveExternalRevocationFencing(
  signal: ExternalRevocationSignal,
  candidateRecord: SessionLinkAuthoritativeRecord | null,
): ExternalRevocationFencingResult {
  if (!candidateRecord || candidateRecord.ownerLinkRef !== signal.externalLinkRef) {
    return { status: 'NOT_TARGETED' };
  }
  return {
    status: 'TARGETED',
    principalId: candidateRecord.ownerPrincipalId,
    externalLinkRef: candidateRecord.ownerLinkRef,
  };
}
