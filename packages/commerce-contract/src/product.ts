import { assertNonEmptyString, type Brand } from '../../domain/src/brand';
import type {
  IntegrationId,
  MerchantWorkspaceId,
  Money,
  ProductId,
  UtcTimestamp,
  VariantId,
} from '../../domain/src';

export type ProductStatus = Brand<string, 'ProductStatus'>;
export type ProviderSellabilityState = Brand<string, 'ProviderSellabilityState'>;

export function productStatus(value: string): ProductStatus {
  return assertNonEmptyString(value, 'ProductStatus') as ProductStatus;
}

export function providerSellabilityState(value: string): ProviderSellabilityState {
  return assertNonEmptyString(value, 'ProviderSellabilityState') as ProviderSellabilityState;
}

export interface Product {
  readonly productId: ProductId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly integrationId: IntegrationId;
  readonly providerProductId: string;
  readonly title: string;
  readonly status: ProductStatus;
  readonly productUrl?: string;
  readonly mediaRefs: readonly string[];
  /** Provider/source-origin timestamp when explicitly supplied. Never substitute observedAt. */
  readonly sourceTimestamp?: UtcTimestamp;
  /** AI Commerce capture/read time. Always required. */
  readonly observedAt: UtcTimestamp;
}

export interface VariantOptionPair {
  /** Exact provider-facing option label, preserved without normalization. */
  readonly label: string;
  /** Exact provider-facing option value, preserved without normalization. */
  readonly value: string;
}

export interface Variant {
  readonly variantId: VariantId;
  readonly productId: ProductId;
  readonly integrationId: IntegrationId;
  readonly providerVariantId: string;
  readonly sku?: string;
  readonly optionPairs: readonly VariantOptionPair[];
  readonly priceMoney?: Money;
  readonly compareAtMoney?: Money;
  readonly providerSellabilityState?: ProviderSellabilityState;
  /** Provider/source-origin timestamp when explicitly supplied. Never substitute observedAt. */
  readonly sourceTimestamp?: UtcTimestamp;
  /** AI Commerce capture/read time. Always required. */
  readonly observedAt: UtcTimestamp;
}

export function exactOptionPair(label: string, value: string): VariantOptionPair {
  return Object.freeze({
    label: assertNonEmptyString(label, 'VariantOptionPair.label'),
    value: assertNonEmptyString(value, 'VariantOptionPair.value'),
  });
}
