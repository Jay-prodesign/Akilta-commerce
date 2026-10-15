import { assertNonEmptyString, type Brand } from './brand';

/**
 * SC-04 (Billing & Entitlement Core / AC-BILLENT-106) — canonical ENTITLEMENT state machine, exactly
 * as specified in the D108_CLOSURE_PLAN STATE_MACHINES sheet (machine=ENTITLEMENT rows). This file
 * holds only the shared domain vocabulary; the pure resolver/CAS decision functions live in
 * packages/authz/src/entitlement-resolution.ts — same split as conversation.ts /
 * conversation-ownership-transition.ts.
 *
 * CANCELLED is terminal: the canonical table defines no outgoing edge from it ("terminal
 * cancellation effective; any new purchase/re-subscribe creates a new subscription/entitlement
 * generation" — a brand-new EntitlementRecord, never a transition of this one). NONE is the only
 * state with no current grant at all.
 */
export const ENTITLEMENT_STATES = [
  'NONE',
  'TRIAL',
  'ACTIVE',
  'GRACE',
  'PAST_DUE',
  'RESTRICTED',
  'CANCEL_PENDING',
  'CANCELLED',
] as const;
export type EntitlementState = (typeof ENTITLEMENT_STATES)[number];

/**
 * Observational provenance only — which billing/payer source most recently established an
 * entitlement generation's authority (e.g. a specific Shopify Billing subscription resource).
 * Never part of a workspace's identity, and never itself authority for anything: switching which
 * billing source backs a workspace's entitlement never changes `MerchantWorkspaceId`, and a
 * `BillingSourceRef` alone grants nothing without going through the authoritative CAS transition.
 */
export type BillingSourceRef = Brand<string, 'BillingSourceRef'>;

function assertIsBillingSourceRef(value: string): asserts value is BillingSourceRef {
  assertNonEmptyString(value, 'BillingSourceRef');
}

export function billingSourceRef(value: string): BillingSourceRef {
  assertIsBillingSourceRef(value);
  return value;
}

/** True only for the one state that structurally means "no grant exists at all." */
export function hasAnyEntitlementGrant(state: EntitlementState): boolean {
  return state !== 'NONE';
}
