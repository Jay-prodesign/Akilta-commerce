import type { InventoryObservationId, UtcTimestamp, VariantId } from '../../domain/src';

export const TRACKING_STATES = ['TRACKED', 'UNTRACKED', 'UNKNOWN'] as const;
export type TrackingState = (typeof TRACKING_STATES)[number];

export const INVENTORY_POLICY_SEMANTICS = [
  'REQUIRE_POSITIVE_QUANTITY',
  'ALLOW_SELLING_WITHOUT_POSITIVE_QUANTITY',
  'UNKNOWN',
] as const;
export type InventoryPolicySemantics = (typeof INVENTORY_POLICY_SEMANTICS)[number];

export const PROVIDER_AVAILABILITY_STATES = ['SELLABLE', 'NOT_SELLABLE', 'UNKNOWN'] as const;
export type ProviderAvailabilityState = (typeof PROVIDER_AVAILABILITY_STATES)[number];

export const FRESHNESS_STATES = ['FRESH', 'STALE', 'UNKNOWN'] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

export const DERIVED_AVAILABILITY_STATES = [
  'IN_STOCK',
  'OUT_OF_STOCK',
  'AVAILABLE_TO_ORDER',
  'UNKNOWN',
] as const;
export type DerivedAvailability = (typeof DERIVED_AVAILABILITY_STATES)[number];

export interface InventoryObservation {
  readonly inventoryObservationId: InventoryObservationId;
  readonly variantId: VariantId;
  readonly scopeRef?: string;
  readonly trackingState: TrackingState;
  readonly rawQuantity?: bigint;
  readonly sellableQuantity?: bigint;
  readonly providerAvailability: ProviderAvailabilityState;
  readonly inventoryPolicy: InventoryPolicySemantics;
  readonly freshnessState: FreshnessState;
  readonly derivedAvailability: DerivedAvailability;
  readonly derivationRuleRef: string;
  /** Provider/source-origin inventory timestamp when explicitly supplied. Never substitute observedAt. */
  readonly sourceTimestamp?: UtcTimestamp;
  /** AI Commerce observation time. Always required. */
  readonly observedAt: UtcTimestamp;
}

export interface InventoryDerivationInput {
  readonly trackingState: TrackingState;
  readonly rawQuantity?: bigint;
  readonly sellableQuantity?: bigint;
  readonly providerAvailability: ProviderAvailabilityState;
  readonly inventoryPolicy: InventoryPolicySemantics;
  readonly freshnessState: FreshnessState;
}

export function deriveAvailability(input: InventoryDerivationInput): DerivedAvailability {
  if (input.freshnessState !== 'FRESH') return 'UNKNOWN';

  if (input.sellableQuantity !== undefined && input.sellableQuantity > 0n) {
    return input.providerAvailability === 'NOT_SELLABLE' ? 'UNKNOWN' : 'IN_STOCK';
  }

  if (input.trackingState === 'TRACKED') {
    const quantity = input.sellableQuantity ?? input.rawQuantity;
    if (quantity === undefined) return 'UNKNOWN';
    if (quantity > 0n) return input.providerAvailability === 'NOT_SELLABLE' ? 'UNKNOWN' : 'IN_STOCK';

    if (input.inventoryPolicy === 'REQUIRE_POSITIVE_QUANTITY') {
      return input.providerAvailability === 'SELLABLE' ? 'UNKNOWN' : 'OUT_OF_STOCK';
    }
    if (input.inventoryPolicy === 'ALLOW_SELLING_WITHOUT_POSITIVE_QUANTITY') {
      return input.providerAvailability === 'NOT_SELLABLE' ? 'UNKNOWN' : 'AVAILABLE_TO_ORDER';
    }
    return 'UNKNOWN';
  }

  if (input.trackingState === 'UNTRACKED') {
    if (input.providerAvailability === 'SELLABLE') return 'AVAILABLE_TO_ORDER';
    return 'UNKNOWN';
  }

  return 'UNKNOWN';
}
