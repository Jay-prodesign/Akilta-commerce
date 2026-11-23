import { isOperationallyActive, type OperationalStatus } from '../../domain/src';
import type { AuthProviderKey, ExternalAuthSubjectRef } from './auth-identity';
import type { CommercePrincipalId, ExternalCommerceSessionLinkRef } from './commerce-session-link';

/**
 * AC-XSESSION-107A1 (XSESS-02) — "verified subject binding is exact issuer+subject+Commerce
 * principal, conflict/duplicate links fail closed, no identifier-similarity auto-merge."
 *
 * This is the missing step between XSESS-01 (`evaluateFederatedExchangeAdmission`, which only
 * ADMITS an external envelope and structurally cannot return a Commerce principal/link) and XSESS-03
 * /XSESS-06 (`commerce-session-link.ts` / `commerce-session-link-transition.ts`, which both assume a
 * `CommercePrincipalId` + `ExternalCommerceSessionLinkRef` are already known). Given an ADMITTED
 * exchange's verified (authProvider, externalSubjectRef) and a caller-supplied candidate array — same
 * "plain evidence set, no injected reader/writer port" substrate choice as `federated-exchange-
 * admission.ts`'s `consumedNonces` and `auth-identity.ts`'s `identities` — this resolves EXACTLY one
 * session-link candidate to proceed with, or fails closed.
 *
 * Reuses `AuthProviderKey` / `ExternalAuthSubjectRef` from auth-identity.ts rather than inventing
 * parallel "issuer"/"subject" brands: a federated AKILTA-side exchange is itself an auth provider
 * claim in exactly the same structural shape `resolveAuthenticatedPrincipal` already resolves.
 *
 * Exact-match discipline, same as `resolveAuthenticatedPrincipal` (auth-identity.ts) and
 * `resolveAuthOrganizationBinding`: candidates are filtered by `===` equality on both fields only.
 * There is no fuzzy/substring/normalized-similarity comparison anywhere in this function — "no
 * identifier-similarity auto-merge" holds because similarity is never computed at all, not because a
 * threshold was tuned conservatively. More than one exact match is an `IDENTITY_CONFLICT`-shaped
 * `LINK_CONFLICT`, never resolved by array order or recency.
 */

export interface CommerceSessionLinkCandidate {
  readonly principalId: CommercePrincipalId;
  readonly issuerAuthProvider: AuthProviderKey;
  readonly externalSubjectRef: ExternalAuthSubjectRef;
  readonly externalLinkRef: ExternalCommerceSessionLinkRef;
  readonly status: OperationalStatus;
}

export type CommerceSessionLinkCandidateResolutionResult =
  | {
      readonly status: 'RESOLVED';
      readonly principalId: CommercePrincipalId;
      readonly externalLinkRef: ExternalCommerceSessionLinkRef;
    }
  | {
      readonly status: 'DENIED';
      readonly reason: 'NO_MATCHING_LINK' | 'LINK_CONFLICT' | 'LINK_INACTIVE';
    };

/**
 * Decision order: filter to candidates whose (issuerAuthProvider, externalSubjectRef) exactly equal
 * the verified pair -> more than one exact match denies LINK_CONFLICT (an ambiguous duplicate-link
 * data state, never selected by input order) -> zero matches denies NO_MATCHING_LINK -> the single
 * exact match must itself be operationally active, or it denies LINK_INACTIVE (a revoked/expired
 * stale candidate is never silently resurrected merely because no other candidate competes with it).
 */
export function resolveCommerceSessionLinkCandidate(
  verifiedAuthProvider: AuthProviderKey,
  verifiedExternalSubjectRef: ExternalAuthSubjectRef,
  candidates: readonly CommerceSessionLinkCandidate[],
): CommerceSessionLinkCandidateResolutionResult {
  const matches = candidates.filter(
    (candidate) =>
      candidate.issuerAuthProvider === verifiedAuthProvider &&
      candidate.externalSubjectRef === verifiedExternalSubjectRef,
  );

  if (matches.length > 1) {
    return { status: 'DENIED', reason: 'LINK_CONFLICT' };
  }
  if (matches.length === 0) {
    return { status: 'DENIED', reason: 'NO_MATCHING_LINK' };
  }

  const candidate = matches[0];
  if (!candidate || !isOperationallyActive(candidate.status)) {
    return { status: 'DENIED', reason: 'LINK_INACTIVE' };
  }

  return {
    status: 'RESOLVED',
    principalId: candidate.principalId,
    externalLinkRef: candidate.externalLinkRef,
  };
}
