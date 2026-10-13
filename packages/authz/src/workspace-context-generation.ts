import { DomainPrimitiveError, type MerchantWorkspaceId, type UserId } from '../../domain/src';

/**
 * AC-XSESSION-107A1 slice 2 — pure workspace-context currentness primitive only (XSESS-05). Same
 * split as XSESS-03 (commerce-session-link.ts): pure deterministic derivation first, server-owned
 * reader/writer seam later. A caller must never construct WorkspaceContextState itself from a
 * copied/cached claim; it is a placeholder for whatever a later server-owned reader returns for the
 * exact principal below.
 */

export type ContextPrincipalId = UserId;

/**
 * The server-owned durable state of one principal's active workspace context, exactly as it exists
 * right now. `generation` increments on every workspace switch — including a switch back to a
 * workspace the principal was already in before — so a copied claim can never silently re-validate
 * merely because the workspace id happens to match again.
 */
export interface WorkspaceContextState {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly generation: number;
}

export interface WorkspaceContextSnapshot {
  readonly principalId: ContextPrincipalId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly generation: number;
  /** Deterministic encoding of the fields above; never equal across a different workspace or generation. */
  readonly contextVersion: string;
}

export type WorkspaceContextCurrentnessResult =
  | { readonly status: 'READY'; readonly snapshot: WorkspaceContextSnapshot }
  | { readonly status: 'DENIED'; readonly reason: 'STALE_WORKSPACE_CONTEXT_REF' };

/**
 * Collision-safe canonical JSON encoding, same technique as permission-authority's authorityVersion
 * and commerce-session-link's linkVersion: explicit array structure via JSON.stringify, no
 * delimiter-concatenation ambiguity between structurally different inputs. No wall-clock, no
 * randomness.
 */
function deriveContextVersion(
  principalId: ContextPrincipalId,
  state: WorkspaceContextState,
): string {
  return JSON.stringify([principalId, state.merchantWorkspaceId, state.generation]);
}

/** Pure derivation from already-obtained current state; exposed directly so it is unit-testable without an injected reader. */
export function resolveWorkspaceContextSnapshot(
  principalId: ContextPrincipalId,
  state: WorkspaceContextState,
): WorkspaceContextSnapshot {
  return {
    principalId,
    merchantWorkspaceId: state.merchantWorkspaceId,
    generation: state.generation,
    contextVersion: deriveContextVersion(principalId, state),
  };
}

/**
 * Decision-time check. `claimedContextVersion` is whatever the caller presents (a cached/copied
 * value from a prior response, never trusted as current on its own). Because the version already
 * encodes the workspace id, a claim copied from the old workspace cannot be replayed against the new
 * one, and a claim copied from the new workspace cannot be replayed with a stale generation: either
 * mismatch denies as stale (XSESS-05: "stale tab/cache/request cannot act in old/new workspace by
 * copying IDs"), with no separate workspace-equality branch needed.
 */
export function evaluateWorkspaceContextCurrentness(
  claimedContextVersion: string,
  principalId: ContextPrincipalId,
  state: WorkspaceContextState,
): WorkspaceContextCurrentnessResult {
  const snapshot = resolveWorkspaceContextSnapshot(principalId, state);
  if (claimedContextVersion !== snapshot.contextVersion) {
    return { status: 'DENIED', reason: 'STALE_WORKSPACE_CONTEXT_REF' };
  }
  return { status: 'READY', snapshot };
}

/**
 * SC-02 CAS transition for a workspace switch, same discipline as commerce-session-link-transition.ts
 * (XSESS-06) and provider-store-binding.ts: `expectedGeneration` is the CAS precondition, never a
 * timestamp; a switch always advances the generation by exactly one, even when switching back to a
 * workspace the principal was already in before (so a stale copied claim from the first visit can
 * never silently re-validate merely because the workspace id matches again). This function only
 * handles switches against an already-existing WorkspaceContextState — a principal's very first
 * workspace assignment ever (onboarding) is a separate, not-yet-selected concern and out of scope
 * here, exactly as the module-level doc comment already states for WorkspaceContextState itself.
 */

export type WorkspaceContextIdempotencyKey = string & { readonly __brand: 'WorkspaceContextIdempotencyKey' };

function assertIsWorkspaceContextIdempotencyKey(
  value: string,
): asserts value is WorkspaceContextIdempotencyKey {
  if (!value) throw new DomainPrimitiveError('WorkspaceContextIdempotencyKey must be non-empty');
}

export function workspaceContextIdempotencyKey(value: string): WorkspaceContextIdempotencyKey {
  const normalized = value.trim();
  assertIsWorkspaceContextIdempotencyKey(normalized);
  return normalized;
}

export interface WorkspaceContextSwitchRequest {
  readonly principalId: ContextPrincipalId;
  readonly expectedGeneration: number;
  readonly targetMerchantWorkspaceId: MerchantWorkspaceId;
  readonly idempotencyKey: WorkspaceContextIdempotencyKey;
}

export type WorkspaceContextSwitchResult =
  | { readonly status: 'APPLIED'; readonly resultingState: WorkspaceContextState }
  | { readonly status: 'ALREADY_APPLIED'; readonly resultingState: WorkspaceContextState }
  | { readonly status: 'CONFLICT'; readonly reason: 'STALE_EXPECTED_GENERATION' };

export function resolveWorkspaceContextSwitch(
  request: WorkspaceContextSwitchRequest,
  currentState: WorkspaceContextState,
  appliedIdempotencyKeys: ReadonlyMap<WorkspaceContextIdempotencyKey, WorkspaceContextState>,
): WorkspaceContextSwitchResult {
  const priorOutcome = appliedIdempotencyKeys.get(request.idempotencyKey);
  if (priorOutcome) {
    return { status: 'ALREADY_APPLIED', resultingState: priorOutcome };
  }
  if (request.expectedGeneration !== currentState.generation) {
    return { status: 'CONFLICT', reason: 'STALE_EXPECTED_GENERATION' };
  }
  return {
    status: 'APPLIED',
    resultingState: {
      merchantWorkspaceId: request.targetMerchantWorkspaceId,
      generation: currentState.generation + 1,
    },
  };
}
