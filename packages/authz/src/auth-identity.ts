import { DomainPrimitiveError, isOperationallyActive, type OperationalStatus } from '../../domain/src';
import type {
  OrganizationId,
  UserId,
  UserIdentityId,
  UtcTimestamp,
} from '../../domain/src';
import type { AuthAssuranceLevel } from './types';

export type AuthProviderKey = string & { readonly __brand: 'AuthProviderKey' };
export type ExternalAuthSubjectRef = string & { readonly __brand: 'ExternalAuthSubjectRef' };
export type ExternalAuthOrganizationRef = string & { readonly __brand: 'ExternalAuthOrganizationRef' };
export type ExternalSessionRef = string & { readonly __brand: 'ExternalSessionRef' };

function nonEmptyBrand<T extends string>(value: string, label: string): T {
  const normalized = value.trim();
  if (!normalized) throw new DomainPrimitiveError(`${label} must be non-empty`);
  return normalized as T;
}

export function authProviderKey(value: string): AuthProviderKey {
  return nonEmptyBrand<AuthProviderKey>(value, 'AuthProviderKey');
}

export function externalAuthSubjectRef(value: string): ExternalAuthSubjectRef {
  return nonEmptyBrand<ExternalAuthSubjectRef>(value, 'ExternalAuthSubjectRef');
}

export function externalAuthOrganizationRef(value: string): ExternalAuthOrganizationRef {
  return nonEmptyBrand<ExternalAuthOrganizationRef>(value, 'ExternalAuthOrganizationRef');
}

export function externalSessionRef(value: string): ExternalSessionRef {
  return nonEmptyBrand<ExternalSessionRef>(value, 'ExternalSessionRef');
}

export interface UserIdentity {
  readonly userIdentityId: UserIdentityId;
  readonly userId: UserId;
  readonly authProvider: AuthProviderKey;
  readonly externalSubjectRef: ExternalAuthSubjectRef;
  readonly status: OperationalStatus;
  readonly verifiedAt: UtcTimestamp;
  readonly createdAt: UtcTimestamp;
}

export interface AuthOrganizationBinding {
  readonly authProvider: AuthProviderKey;
  readonly externalOrganizationRef: ExternalAuthOrganizationRef;
  readonly internalOrganizationId: OrganizationId;
  readonly status: OperationalStatus;
  readonly verifiedAt: UtcTimestamp;
  readonly sourceRef: string;
}

export type SessionIdentityStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

/**
 * Safe server-side identity proof after provider token/session verification.
 * External organization claims are advisory inputs only and never establish
 * MerchantWorkspace, AgencyClientAssignment, permission, approval or customer-verification authority.
 */
export interface SessionIdentityProof {
  readonly authProvider: AuthProviderKey;
  readonly externalSubjectRef: ExternalAuthSubjectRef;
  readonly externalSessionRef: ExternalSessionRef;
  readonly assuranceLevel: AuthAssuranceLevel;
  readonly status: SessionIdentityStatus;
  readonly issuedAt: UtcTimestamp;
  readonly verifiedAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
  readonly assertedExternalOrganizationRef?: ExternalAuthOrganizationRef;
}

export interface AuthenticatedPrincipal {
  readonly userId: UserId;
  readonly userIdentityId: UserIdentityId;
  readonly authProvider: AuthProviderKey;
  readonly assuranceLevel: AuthAssuranceLevel;
  readonly sessionRef: ExternalSessionRef;
  readonly verifiedAt: UtcTimestamp;
}

export type IdentityResolutionResult =
  | { readonly status: 'AUTHENTICATED'; readonly principal: AuthenticatedPrincipal }
  | {
      readonly status: 'DENIED';
      readonly reason:
        | 'SESSION_REVOKED'
        | 'SESSION_EXPIRED'
        | 'SUBJECT_NOT_BOUND'
        | 'IDENTITY_INACTIVE'
        | 'IDENTITY_PROVIDER_MISMATCH';
    }
  | { readonly status: 'UNAVAILABLE'; readonly reason: 'PROVIDER_UNAVAILABLE' };

export interface ExternalAuthenticationAttempt {
  readonly outcome: 'VERIFIED' | 'DENIED' | 'UNAVAILABLE';
  readonly proof?: SessionIdentityProof;
}

function isExpired(expiresAt: UtcTimestamp, now: UtcTimestamp): boolean {
  return new Date(expiresAt).getTime() <= new Date(now).getTime();
}

/**
 * Resolves authentication only. It intentionally does NOT create ExecutionContext.
 * Membership, assignment, active workspace and permissions are resolved later from
 * AI Commerce server-side records.
 */
export function resolveAuthenticatedPrincipal(
  attempt: ExternalAuthenticationAttempt,
  identities: readonly UserIdentity[],
  now: UtcTimestamp,
): IdentityResolutionResult {
  if (attempt.outcome === 'UNAVAILABLE') {
    return { status: 'UNAVAILABLE', reason: 'PROVIDER_UNAVAILABLE' };
  }
  if (attempt.outcome !== 'VERIFIED' || !attempt.proof) {
    return { status: 'DENIED', reason: 'SUBJECT_NOT_BOUND' };
  }

  const proof = attempt.proof;
  if (proof.status === 'REVOKED') return { status: 'DENIED', reason: 'SESSION_REVOKED' };
  if (proof.status === 'EXPIRED' || isExpired(proof.expiresAt, now)) {
    return { status: 'DENIED', reason: 'SESSION_EXPIRED' };
  }

  const identity = identities.find(
    (candidate) =>
      candidate.authProvider === proof.authProvider &&
      candidate.externalSubjectRef === proof.externalSubjectRef,
  );
  if (!identity) return { status: 'DENIED', reason: 'SUBJECT_NOT_BOUND' };
  if (identity.authProvider !== proof.authProvider) {
    return { status: 'DENIED', reason: 'IDENTITY_PROVIDER_MISMATCH' };
  }
  if (!isOperationallyActive(identity.status)) {
    return { status: 'DENIED', reason: 'IDENTITY_INACTIVE' };
  }

  return {
    status: 'AUTHENTICATED',
    principal: {
      userId: identity.userId,
      userIdentityId: identity.userIdentityId,
      authProvider: proof.authProvider,
      assuranceLevel: proof.assuranceLevel,
      sessionRef: proof.externalSessionRef,
      verifiedAt: proof.verifiedAt,
    },
  };
}

/**
 * Maps an external organization reference only through a verified binding.
 * The result is an OrganizationId, never a MerchantWorkspaceId.
 */
export function resolveAuthOrganizationBinding(
  authProvider: AuthProviderKey,
  externalOrganizationRef: ExternalAuthOrganizationRef,
  bindings: readonly AuthOrganizationBinding[],
): OrganizationId | null {
  const binding = bindings.find(
    (candidate) =>
      candidate.authProvider === authProvider &&
      candidate.externalOrganizationRef === externalOrganizationRef &&
      isOperationallyActive(candidate.status),
  );
  return binding?.internalOrganizationId ?? null;
}
