import {
  DomainPrimitiveError,
  resolveCurrentAuthority,
  type BillingSourceRef,
  type CurrentAuthorityResolution,
  type EntitlementState,
  type MerchantWorkspaceId,
  type ModuleKey,
  type OperationalStatus,
  type UtcTimestamp,
} from '../../domain/src';

/**
 * SC-04 (Billing & Entitlement Core / AC-BILLENT-106) — provider-neutral core only. Grounded directly
 * in the D108_CLOSURE_PLAN SC-04 row's required_delta ("Provider billing observation is evidence,
 * never direct authority... resolve one workspace+module EffectiveEntitlement with version/
 * effective-time/generation, fail closed on conflicting sources, distinguish reversible hold states
 * from terminal cancellation, and require dispatch-time entitlement generation revalidation") and the
 * canonical ENTITLEMENT state machine (D108_CLOSURE_PLAN STATE_MACHINES sheet).
 *
 * Three pure decisions, each a hard gate the others never reconsider:
 *  1. `resolveEffectiveEntitlementSource` — given raw, possibly-multiple billing-source observations
 *     for one exact workspace+module, pick the one current effective source, or NONE, or fail closed
 *     on CONFLICT. Reuses `resolveCurrentAuthority` (packages/domain/src/tenancy.ts) directly — the
 *     identical "candidate list -> NONE/RESOLVED/CONFLICT over an effective window" engine already
 *     proven by `resolveCurrentMembership`/`resolveCurrentAgencyAssignment`. No second filter+
 *     none/one/conflict implementation exists here.
 *  2. `resolveEntitlementTransition` — the authoritative CAS state-machine transition over a single
 *     workspace+module's EntitlementRecord, same generation/idempotency discipline as every prior
 *     XSESS/SC-02/SC-05 unit this session (expectedGeneration is the CAS precondition, never a
 *     timestamp; a successful transition advances the generation by exactly one; a retried request
 *     replays its original outcome via the idempotency ledger).
 *  3. `evaluateEntitlementGenerationFencing` — the dispatch-time staleness check for a queued/
 *     scheduled action that captured an entitlement generation earlier. Deliberately narrow: it only
 *     answers "is the caller's captured generation still current," never "does this state permit this
 *     action" — which states permit which live effects is explicitly module policy
 *     ("Live effects blocked according to module policy" — D108_CLOSURE_PLAN STATE_MACHINES, RESTRICTED
 *     row), a commercial/product decision this unit does not invent.
 *
 * Billing observation vs. entitlement vs. installation vs. configuration vs. capability vs.
 * authorization — kept structurally separate, never conflated:
 *  - Billing OBSERVATION is a raw provider signal (`BillingObservationCandidate` below) — evidence,
 *    never authority on its own. It carries no generation and decides nothing by itself.
 *  - ENTITLEMENT (`EntitlementRecord`) is the one authoritative, versioned, generation-tracked grant
 *    this file resolves and transitions. It is NOT a capability, NOT a configuration, and NOT an
 *    authorization — see BILLENT-12 in the test file for the structural proof.
 *  - Installation/binding (AC-SHOP-LC-106 / SC-07), module configuration, the specific capability a
 *    module exposes once entitled, and action-level authorization (permission-authority.ts /
 *    evaluator.ts) are each separate, pre-existing or separately-selected authority axes. This file
 *    reads and writes none of them, and `EntitlementRecord` carries no field that could be mistaken
 *    for any of them.
 *
 * Duplicate/out-of-order provider event convergence (BILLENT-07/08) is explicitly NOT reimplemented
 * here: `eventDeduplicationKey` / `classifyDelivery` / `shouldAdvanceMonotonicProjection`
 * (packages/events/src/operational.ts, P0-004, pre-existing, unmodified) already cover it. A caller
 * reconciling a provider billing event dedupes and order-gates with those primitives BEFORE ever
 * calling `resolveEntitlementTransition` — same composition-not-duplication pattern already used by
 * inbound-conversation-binding.ts (CONV-05/CONV-06) — proven here by the equivalent composed test
 * scenarios in the test file, not by a second dedup/ordering implementation.
 *
 * Claim ceiling (explicit, matching AC-BILLENT-106's own canonical notes): this unit invents no
 * price, trial length, refund/proration/chargeback, seller-of-record, split-sponsorship or
 * provider-native state mapping, and performs no real billing/provider activation. Package-to-
 * entitlement feature mapping (BILLENT-14) is a release-gate/config concern, not a decision function,
 * and is deliberately not fabricated here — see the test file for the structural boundary this module
 * does guarantee instead (exact-match ModuleKey scoping, never a pattern/feature-flag inference).
 */

// ---------------------------------------------------------------------------
// 1. Billing-source candidate resolution (BILLENT-01..05)
// ---------------------------------------------------------------------------

/**
 * A raw, non-authoritative billing-source observation for one workspace+module. `status`/
 * `validFrom`/`validTo` give it the exact same effective-window shape `resolveCurrentAuthority`
 * already knows how to resolve — reused unmodified, not re-derived.
 */
export interface BillingObservationCandidate {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly moduleKey: ModuleKey;
  readonly billingSourceRef: BillingSourceRef;
  readonly claimedState: EntitlementState;
  readonly status: OperationalStatus;
  readonly validFrom?: UtcTimestamp;
  readonly validTo?: UtcTimestamp;
}

/**
 * Scopes candidates to the exact (merchantWorkspaceId, moduleKey) pair, then delegates to the shared
 * `resolveCurrentAuthority` engine: `NONE` (no current source at all — BILLENT-01), `RESOLVED` (exactly
 * one current effective source — BILLENT-02), or `CONFLICT` carrying every effective candidate,
 * never a chosen winner (BILLENT-03 — fail closed, no double grant, no first-match/latest-row
 * tie-break). `validFrom`/`validTo` on each candidate is what makes an add/remove boundary exact
 * (BILLENT-04/05): a candidate not yet in its effective window, or past it, is filtered out by
 * `resolveCurrentAuthority` before NONE/RESOLVED/CONFLICT is even decided.
 */
export function resolveEffectiveEntitlementSource(
  candidates: readonly BillingObservationCandidate[],
  merchantWorkspaceId: MerchantWorkspaceId,
  moduleKey: ModuleKey,
  occurredAt: UtcTimestamp,
): CurrentAuthorityResolution<BillingObservationCandidate> {
  const scoped = candidates.filter(
    (candidate) => candidate.merchantWorkspaceId === merchantWorkspaceId && candidate.moduleKey === moduleKey,
  );
  return resolveCurrentAuthority(scoped, occurredAt);
}

// ---------------------------------------------------------------------------
// 2. EffectiveEntitlement CAS state-machine transition (BILLENT-09..11)
// ---------------------------------------------------------------------------

export type EntitlementTransitionTrigger =
  | 'START_TRIAL'
  | 'ACTIVATE'
  | 'ENTER_GRACE'
  | 'ENTER_PAST_DUE'
  | 'RESTRICT'
  | 'REQUEST_CANCEL'
  | 'CANCEL';

/**
 * The exact canonical ENTITLEMENT transition table (D108_CLOSURE_PLAN STATE_MACHINES sheet,
 * machine=ENTITLEMENT rows). Absence of a trigger for a state is itself the forbidden-transition
 * boundary — most importantly CANCELLED, which has none: "terminal cancellation effective; any new
 * purchase/re-subscribe creates a new subscription/entitlement generation" (a brand-new
 * EntitlementRecord built elsewhere, never a transition of this one — BILLENT-10). GRACE/PAST_DUE/
 * RESTRICTED each keep an ACTIVATE edge back to ACTIVE, which is exactly what makes them reversible
 * and distinct from the terminal CANCELLED state (BILLENT-09).
 */
const ALLOWED_ENTITLEMENT_TRANSITIONS: Readonly<
  Record<EntitlementState, Partial<Record<EntitlementTransitionTrigger, EntitlementState>>>
> = {
  NONE: {
    START_TRIAL: 'TRIAL',
    ACTIVATE: 'ACTIVE',
  },
  TRIAL: {
    ACTIVATE: 'ACTIVE',
    ENTER_GRACE: 'GRACE',
    RESTRICT: 'RESTRICTED',
    REQUEST_CANCEL: 'CANCEL_PENDING',
  },
  ACTIVE: {
    ENTER_GRACE: 'GRACE',
    ENTER_PAST_DUE: 'PAST_DUE',
    RESTRICT: 'RESTRICTED',
    REQUEST_CANCEL: 'CANCEL_PENDING',
  },
  GRACE: {
    ACTIVATE: 'ACTIVE',
    RESTRICT: 'RESTRICTED',
    REQUEST_CANCEL: 'CANCEL_PENDING',
  },
  PAST_DUE: {
    ACTIVATE: 'ACTIVE',
    ENTER_GRACE: 'GRACE',
    RESTRICT: 'RESTRICTED',
    REQUEST_CANCEL: 'CANCEL_PENDING',
  },
  RESTRICTED: {
    ACTIVATE: 'ACTIVE',
    REQUEST_CANCEL: 'CANCEL_PENDING',
    CANCEL: 'CANCELLED',
  },
  CANCEL_PENDING: {
    ACTIVATE: 'ACTIVE',
    CANCEL: 'CANCELLED',
  },
  CANCELLED: {},
};

export type EntitlementIdempotencyKey = string & { readonly __brand: 'EntitlementIdempotencyKey' };

function assertIsEntitlementIdempotencyKey(value: string): asserts value is EntitlementIdempotencyKey {
  if (!value) throw new DomainPrimitiveError('EntitlementIdempotencyKey must be non-empty');
}

export function entitlementIdempotencyKey(value: string): EntitlementIdempotencyKey {
  const normalized = value.trim();
  assertIsEntitlementIdempotencyKey(normalized);
  return normalized;
}

/**
 * The single authoritative, versioned workspace+module grant. `billingSourceRef` is carried as
 * observational provenance only (see module doc) — it is never part of this record's scope identity;
 * scope is `(ownerMerchantWorkspaceId, ownerModuleKey)` alone, so a payer/billing-source switch can
 * never change which workspace this record belongs to (BILLENT-11).
 *
 * Deliberately absent, by construction, so BILLENT-12 ("entitled != configured != capable !=
 * authorized") holds structurally rather than by convention: no installation/binding field, no
 * configuration field, no capability field, no authorization/permission field exists anywhere on
 * this type.
 */
export interface EntitlementRecord {
  readonly ownerMerchantWorkspaceId: MerchantWorkspaceId;
  readonly ownerModuleKey: ModuleKey;
  readonly state: EntitlementState;
  readonly generation: number;
  readonly billingSourceRef?: BillingSourceRef;
}

export interface EntitlementTransitionRequest {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly moduleKey: ModuleKey;
  readonly trigger: EntitlementTransitionTrigger;
  /** CAS precondition: the generation the caller last observed. Never a timestamp. */
  readonly expectedGeneration: number;
  readonly idempotencyKey: EntitlementIdempotencyKey;
  /** Observational provenance for the resulting record; never part of the CAS scope/precondition. */
  readonly billingSourceRef?: BillingSourceRef;
}

export type EntitlementTransitionResult =
  | { readonly status: 'APPLIED'; readonly resultingRecord: EntitlementRecord }
  | { readonly status: 'ALREADY_APPLIED'; readonly resultingRecord: EntitlementRecord }
  | { readonly status: 'CONFLICT'; readonly reason: 'STALE_EXPECTED_GENERATION' }
  | {
      readonly status: 'DENIED';
      readonly reason: 'SCOPE_MISMATCH' | 'TERMINAL_STATE' | 'TRIGGER_NOT_ALLOWED_FROM_STATE';
    };

/**
 * Decision order, each one a hard gate the next never reconsiders:
 *  1. Idempotency replay — a previously-APPLIED request with this exact key returns its original
 *     outcome verbatim, regardless of what `currentRecord` has since become (duplicate-provider-event
 *     half of BILLENT-07 — no generation churn on redelivery).
 *  2. Scope match — the request's (merchantWorkspaceId, moduleKey) must be the record's own scope, or
 *     this is a caller/wiring defect, not a staleness condition.
 *  3. Terminal-state gate — CANCELLED accepts no trigger at all (DENIED TERMINAL_STATE), never an
 *     implicit resurrection (BILLENT-10).
 *  4. Allowed-transition lookup — the trigger must be defined for the current state in the exact
 *     canonical table above, or DENIED TRIGGER_NOT_ALLOWED_FROM_STATE.
 *  5. CAS precondition — `expectedGeneration` must equal the current generation exactly. Any mismatch
 *     is an explicit CONFLICT, never a silent overwrite.
 * A successful transition advances the generation by exactly one.
 */
export function resolveEntitlementTransition(
  request: EntitlementTransitionRequest,
  currentRecord: EntitlementRecord,
  appliedIdempotencyKeys: ReadonlyMap<EntitlementIdempotencyKey, EntitlementRecord>,
): EntitlementTransitionResult {
  const priorOutcome = appliedIdempotencyKeys.get(request.idempotencyKey);
  if (priorOutcome) {
    return { status: 'ALREADY_APPLIED', resultingRecord: priorOutcome };
  }

  if (
    request.merchantWorkspaceId !== currentRecord.ownerMerchantWorkspaceId ||
    request.moduleKey !== currentRecord.ownerModuleKey
  ) {
    return { status: 'DENIED', reason: 'SCOPE_MISMATCH' };
  }

  if (currentRecord.state === 'CANCELLED') {
    return { status: 'DENIED', reason: 'TERMINAL_STATE' };
  }

  const targetState = ALLOWED_ENTITLEMENT_TRANSITIONS[currentRecord.state][request.trigger];
  if (!targetState) {
    return { status: 'DENIED', reason: 'TRIGGER_NOT_ALLOWED_FROM_STATE' };
  }

  if (request.expectedGeneration !== currentRecord.generation) {
    return { status: 'CONFLICT', reason: 'STALE_EXPECTED_GENERATION' };
  }

  const resultingBillingSourceRef = request.billingSourceRef ?? currentRecord.billingSourceRef;
  return {
    status: 'APPLIED',
    resultingRecord: {
      ownerMerchantWorkspaceId: currentRecord.ownerMerchantWorkspaceId,
      ownerModuleKey: currentRecord.ownerModuleKey,
      state: targetState,
      generation: currentRecord.generation + 1,
      ...(resultingBillingSourceRef !== undefined ? { billingSourceRef: resultingBillingSourceRef } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Dispatch-time entitlement generation fencing (BILLENT-06)
// ---------------------------------------------------------------------------

export type EntitlementGenerationFencingResult =
  | { readonly status: 'CURRENT' }
  | { readonly status: 'STALE'; readonly reason: 'STALE_ENTITLEMENT_GENERATION' };

/**
 * A queued/scheduled action captures `claimedGeneration` at enqueue time; immediately before the
 * external effect, the dispatcher revalidates it against whatever `currentRecord` now is. Any
 * mismatch denies as STALE — the caller never re-executes a decision made against an entitlement
 * generation that has since moved (recovered, restricted, or cancelled). This function answers only
 * "is the generation current," never "does this state permit this action" — see module doc.
 */
export function evaluateEntitlementGenerationFencing(
  claimedGeneration: number,
  currentRecord: EntitlementRecord,
): EntitlementGenerationFencingResult {
  if (claimedGeneration !== currentRecord.generation) {
    return { status: 'STALE', reason: 'STALE_ENTITLEMENT_GENERATION' };
  }
  return { status: 'CURRENT' };
}
