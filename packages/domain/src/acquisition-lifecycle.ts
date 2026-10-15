import type { MerchantWorkspaceId } from './ids';
import type { UtcTimestamp } from './time';

/**
 * AC-DIST-001 contract maturation — the one genuine gap identified in
 * docs/exec-plans/active/AC-DIST-001-distribution-lifecycle-contract.md Section 4: a merchant-
 * visible lifecycle projection composing the independent install/identity/entitlement/configuration
 * axes (each already decided by its own existing authority: resolveProviderStoreBindingTransition,
 * resolveAuthenticatedPrincipal, resolveEntitlementTransition — packages/authz/src) into one
 * PENDING/PARTIAL/ACTIVE/BLOCKED/CONFLICT/RECONCILIATION_REQUIRED status.
 *
 * Same non-authority precedent as deriveWorkspaceReadiness (readiness.ts): this function GRANTS
 * NOTHING. It only reads axis statuses the caller already resolved from the real CAS/decision
 * functions and derives what a merchant should see — it never substitutes for, and never feeds back
 * into, any of those decisions. In particular it never infers ACTIVE merely because a particular
 * acquisition route was used (DIST-12): there is no "route"/"channel" input anywhere on this
 * function's signature at all, so it is structurally incapable of special-casing one.
 *
 * `reconciliationPending` is checked before every axis: an unreconciled duplicate/out-of-order/
 * timed-out event (packages/events/src/operational.ts's classifyDelivery/
 * shouldAdvanceMonotonicProjection) means the axis statuses themselves cannot yet be trusted, so the
 * merchant-visible state is RECONCILIATION_REQUIRED regardless of what the axes currently say — never
 * a false ACTIVE/success (DIST-13).
 *
 * CONFLICT takes priority over BLOCKED: a conflicting claim (DIST-10, e.g. two simultaneous binding
 * claims) requires an explicit review decision, which is a more severe state than an ordinary blocked/
 * waiting axis.
 *
 * An axis is VERIFIED only when its owning CAS/decision function actually returned a resolved,
 * current, non-conflicting outcome — an incomplete OAuth/entitlement/configuration/consent axis is
 * PENDING or NOT_STARTED, never VERIFIED, so the overall projection can never reach ACTIVE while any
 * axis remains incomplete (DIST-05).
 */

export const ACQUISITION_AXIS_STATUSES = ['NOT_STARTED', 'PENDING', 'VERIFIED', 'BLOCKED', 'CONFLICT'] as const;
export type AcquisitionAxisStatus = (typeof ACQUISITION_AXIS_STATUSES)[number];

export const ACQUISITION_LIFECYCLE_STATES = [
  'PENDING',
  'PARTIAL',
  'ACTIVE',
  'BLOCKED',
  'CONFLICT',
  'RECONCILIATION_REQUIRED',
] as const;
export type AcquisitionLifecycleState = (typeof ACQUISITION_LIFECYCLE_STATES)[number];

export interface AcquisitionAxisInputs {
  /** From resolveProviderStoreBindingTransition / resolveAuthOrganizationBinding. */
  readonly installAxis: AcquisitionAxisStatus;
  /** From resolveAuthenticatedPrincipal. */
  readonly identityAxis: AcquisitionAxisStatus;
  /** From resolveEffectiveEntitlementSource / resolveEntitlementTransition. */
  readonly entitlementAxis: AcquisitionAxisStatus;
  /** Module configuration completeness — no existing authority owns this yet; caller-supplied opaque axis, not invented here. */
  readonly configurationAxis: AcquisitionAxisStatus;
  /** True while a duplicate/out-of-order/timed-out event has not yet been reconciled for this workspace. */
  readonly reconciliationPending: boolean;
}

export interface AcquisitionLifecycleProjection extends AcquisitionAxisInputs {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly overallState: AcquisitionLifecycleState;
  readonly unmetAxes: readonly string[];
  readonly computedAt: UtcTimestamp;
}

const AXIS_KEYS: readonly (keyof Omit<AcquisitionAxisInputs, 'reconciliationPending'>)[] = [
  'installAxis',
  'identityAxis',
  'entitlementAxis',
  'configurationAxis',
];

export function deriveAcquisitionLifecycleState(inputs: AcquisitionAxisInputs): {
  readonly overallState: AcquisitionLifecycleState;
  readonly unmetAxes: readonly string[];
} {
  if (inputs.reconciliationPending) {
    return { overallState: 'RECONCILIATION_REQUIRED', unmetAxes: [] };
  }

  const statuses = AXIS_KEYS.map((key) => [key, inputs[key]] as const);
  const unverified = statuses.filter(([, status]) => status !== 'VERIFIED').map(([key]) => key);

  if (statuses.some(([, status]) => status === 'CONFLICT')) {
    return { overallState: 'CONFLICT', unmetAxes: unverified };
  }
  if (statuses.some(([, status]) => status === 'BLOCKED')) {
    return { overallState: 'BLOCKED', unmetAxes: unverified };
  }
  if (unverified.length === 0) {
    return { overallState: 'ACTIVE', unmetAxes: [] };
  }
  if (statuses.every(([, status]) => status === 'NOT_STARTED')) {
    return { overallState: 'PENDING', unmetAxes: unverified };
  }
  return { overallState: 'PARTIAL', unmetAxes: unverified };
}

export function projectAcquisitionLifecycle(input: {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly axes: AcquisitionAxisInputs;
  readonly computedAt: UtcTimestamp;
}): AcquisitionLifecycleProjection {
  const derived = deriveAcquisitionLifecycleState(input.axes);
  return Object.freeze({
    merchantWorkspaceId: input.merchantWorkspaceId,
    ...input.axes,
    ...derived,
    computedAt: input.computedAt,
  });
}
