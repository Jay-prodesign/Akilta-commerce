import { DomainPrimitiveError } from '../../domain/src';
import type { ExternalId, MerchantWorkspaceId } from '../../domain/src';
import type { AuthProviderKey } from './auth-identity';

/**
 * AC-IDTEN-106 / AC-XSESSION-107 SC-02 preflight + smallest-safe-slice (provider-originated store
 * bootstrap/multi-store/transfer). Grounds directly in canonical invariant ID-G10 (doc 25):
 * provider install/OAuth may provision a Commerce principal/workspace independently of any other
 * linked system; email/name/provider-identifier similarity never merges it with anything else;
 * later linking requires explicit proof from both applicable authorities, conflict handling and
 * reversible unlink lineage while preserving the underlying Commerce workspace/audit identity.
 *
 * TRUST SOURCE: this module makes no identity-matching decision at all. It never searches,
 * compares or infers a MerchantWorkspaceId from any provider-supplied name/email/identifier — the
 * caller (a verified provider-auth adapter, out of scope here, same split as auth-identity.ts's
 * SessionIdentityProof) must already have resolved the exact target MerchantWorkspaceId through its
 * own authority before calling this function. This function only decides whether a requested
 * (provider, externalStoreRef) -> MerchantWorkspaceId binding transition may be applied, by the
 * same CAS/generation discipline as commerce-session-link-transition.ts (XSESS-06) — never by
 * matching similarity, never by last-writer-wins timestamp.
 *
 * ACCOUNT/STORE LINKING (multi-store): the binding record is keyed by the exact (authProvider,
 * externalStoreRef) scope. One owner can install the same provider integration across many
 * distinct stores; each gets its own independent record and its own independent generation. Two
 * different store refs never share state, and a request scoped to one is rejected against another
 * (SCOPE_MISMATCH), never silently applied by coincidence.
 *
 * TRANSFER/REVOCATION: BOOTSTRAP creates the first generation for a scope that has no record yet.
 * TRANSFER re-points an existing, non-revoked binding to a different MerchantWorkspaceId (ownership
 * change while the store stays installed) under the same CAS precondition as every other transition
 * in this codebase. UNINSTALL is sticky — once revoked, every ordinary further operation on that
 * scope is denied, exactly like XSESS-06's session-link revocation, so a delayed/duplicate op can
 * never resurrect a dead binding by accident. REINSTALL is the one deliberate, separately-typed,
 * still-CAS-gated operation allowed to act on a revoked record — this is what "reversible unlink
 * lineage" means in ID-G10: reinstalling is possible, but only as an explicit, fresh, generation-
 * advancing act that the caller must ask for by name, never as a side effect of retrying a normal
 * operation. UNINSTALL never discards the prior MerchantWorkspaceId — the underlying workspace/audit
 * identity is preserved across uninstall, exactly as the canonical text requires.
 *
 * FAILURE MODES: every rejection is one of CONFLICT (stale CAS) or an enumerated DENIED reason —
 * never a silent no-op and never an exception for an ordinary adversarial input.
 *
 * NON-GOALS / CLAIM CEILING (explicitly out of scope for this unit, per the same sequencing
 * discipline as every prior XSESS-01/05/06 slice): no provider OAuth/webhook verification, no
 * principal/session bootstrap (already covered generically by auth-identity.ts's
 * resolveAuthenticatedPrincipal — a Shopify-authenticated principal is just another AuthProviderKey,
 * nothing new is needed there), no lifecycle/readiness projection (AC-LIFECYCLE-107 / SC-03), no
 * durable persistence or reader adapter, no actual Shopify API/webhook shape. This function only
 * decides a binding-transition outcome from evidence the caller already holds.
 */

export type ExternalProviderStoreRef = ExternalId<'ProviderStore'>;

export type ProviderStoreBindingOperationKind = 'BOOTSTRAP' | 'TRANSFER' | 'UNINSTALL' | 'REINSTALL';

export type ProviderStoreBindingIdempotencyKey = string & {
  readonly __brand: 'ProviderStoreBindingIdempotencyKey';
};

function assertIsProviderStoreBindingIdempotencyKey(
  value: string,
): asserts value is ProviderStoreBindingIdempotencyKey {
  if (!value) throw new DomainPrimitiveError('ProviderStoreBindingIdempotencyKey must be non-empty');
}

export function providerStoreBindingIdempotencyKey(value: string): ProviderStoreBindingIdempotencyKey {
  const normalized = value.trim();
  assertIsProviderStoreBindingIdempotencyKey(normalized);
  return normalized;
}

export interface ProviderStoreBindingState {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly generation: number;
  readonly revoked: boolean;
}

/** The authoritative CAS record for one (authProvider, externalStoreRef) scope. */
export interface ProviderStoreBindingRecord {
  readonly ownerAuthProvider: AuthProviderKey;
  readonly ownerExternalStoreRef: ExternalProviderStoreRef;
  readonly state: ProviderStoreBindingState;
}

export interface ProviderStoreBindingRequest {
  readonly authProvider: AuthProviderKey;
  readonly externalStoreRef: ExternalProviderStoreRef;
  readonly operation: ProviderStoreBindingOperationKind;
  /** CAS precondition. For BOOTSTRAP against a scope with no record yet, this must be 0. */
  readonly expectedGeneration: number;
  /** Required for BOOTSTRAP/TRANSFER/REINSTALL; ignored for UNINSTALL (the prior workspace id is kept as-is). */
  readonly targetMerchantWorkspaceId?: MerchantWorkspaceId;
  readonly idempotencyKey: ProviderStoreBindingIdempotencyKey;
}

export type ProviderStoreBindingResult =
  | { readonly status: 'APPLIED'; readonly resultingRecord: ProviderStoreBindingRecord }
  | { readonly status: 'ALREADY_APPLIED'; readonly resultingRecord: ProviderStoreBindingRecord }
  | { readonly status: 'CONFLICT'; readonly reason: 'STALE_EXPECTED_GENERATION' }
  | {
      readonly status: 'DENIED';
      readonly reason:
        | 'SCOPE_MISMATCH'
        | 'ALREADY_REVOKED'
        | 'ALREADY_BOUND'
        | 'NOT_REVOKED'
        | 'NO_EXISTING_BINDING'
        | 'MISSING_TARGET_WORKSPACE';
    };

/**
 * `currentRecord` is `null` when no binding exists yet for this exact scope. Decision order, each
 * one a hard gate the next never reconsiders: idempotency replay, then (no-record) BOOTSTRAP-only
 * gate, then owner-scope match, then BOOTSTRAP-over-existing-record gate, then the sticky-revocation
 * gate (with REINSTALL as its one explicit exception), then the CAS precondition, then apply.
 */
export function resolveProviderStoreBindingTransition(
  request: ProviderStoreBindingRequest,
  currentRecord: ProviderStoreBindingRecord | null,
  appliedIdempotencyKeys: ReadonlyMap<ProviderStoreBindingIdempotencyKey, ProviderStoreBindingRecord>,
): ProviderStoreBindingResult {
  const priorOutcome = appliedIdempotencyKeys.get(request.idempotencyKey);
  if (priorOutcome) {
    return { status: 'ALREADY_APPLIED', resultingRecord: priorOutcome };
  }

  if (currentRecord === null) {
    if (request.operation !== 'BOOTSTRAP') {
      return { status: 'DENIED', reason: 'NO_EXISTING_BINDING' };
    }
    if (!request.targetMerchantWorkspaceId) {
      return { status: 'DENIED', reason: 'MISSING_TARGET_WORKSPACE' };
    }
    if (request.expectedGeneration !== 0) {
      return { status: 'CONFLICT', reason: 'STALE_EXPECTED_GENERATION' };
    }
    return {
      status: 'APPLIED',
      resultingRecord: {
        ownerAuthProvider: request.authProvider,
        ownerExternalStoreRef: request.externalStoreRef,
        state: { merchantWorkspaceId: request.targetMerchantWorkspaceId, generation: 1, revoked: false },
      },
    };
  }

  if (
    request.authProvider !== currentRecord.ownerAuthProvider ||
    request.externalStoreRef !== currentRecord.ownerExternalStoreRef
  ) {
    return { status: 'DENIED', reason: 'SCOPE_MISMATCH' };
  }

  if (request.operation === 'BOOTSTRAP') {
    return { status: 'DENIED', reason: 'ALREADY_BOUND' };
  }

  if (currentRecord.state.revoked) {
    if (request.operation !== 'REINSTALL') {
      return { status: 'DENIED', reason: 'ALREADY_REVOKED' };
    }
    if (!request.targetMerchantWorkspaceId) {
      return { status: 'DENIED', reason: 'MISSING_TARGET_WORKSPACE' };
    }
    if (request.expectedGeneration !== currentRecord.state.generation) {
      return { status: 'CONFLICT', reason: 'STALE_EXPECTED_GENERATION' };
    }
    return {
      status: 'APPLIED',
      resultingRecord: {
        ownerAuthProvider: currentRecord.ownerAuthProvider,
        ownerExternalStoreRef: currentRecord.ownerExternalStoreRef,
        state: {
          merchantWorkspaceId: request.targetMerchantWorkspaceId,
          generation: currentRecord.state.generation + 1,
          revoked: false,
        },
      },
    };
  }

  if (request.operation === 'REINSTALL') {
    return { status: 'DENIED', reason: 'NOT_REVOKED' };
  }

  if (request.expectedGeneration !== currentRecord.state.generation) {
    return { status: 'CONFLICT', reason: 'STALE_EXPECTED_GENERATION' };
  }

  if (request.operation === 'TRANSFER') {
    if (!request.targetMerchantWorkspaceId) {
      return { status: 'DENIED', reason: 'MISSING_TARGET_WORKSPACE' };
    }
    return {
      status: 'APPLIED',
      resultingRecord: {
        ownerAuthProvider: currentRecord.ownerAuthProvider,
        ownerExternalStoreRef: currentRecord.ownerExternalStoreRef,
        state: {
          merchantWorkspaceId: request.targetMerchantWorkspaceId,
          generation: currentRecord.state.generation + 1,
          revoked: false,
        },
      },
    };
  }

  // operation === 'UNINSTALL'
  return {
    status: 'APPLIED',
    resultingRecord: {
      ownerAuthProvider: currentRecord.ownerAuthProvider,
      ownerExternalStoreRef: currentRecord.ownerExternalStoreRef,
      state: {
        merchantWorkspaceId: currentRecord.state.merchantWorkspaceId,
        generation: currentRecord.state.generation + 1,
        revoked: true,
      },
    },
  };
}
