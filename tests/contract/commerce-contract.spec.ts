import {
  internalId,
  money,
  utcTimestamp,
  type IntegrationId,
  type InventoryObservationId,
  type MerchantWorkspaceId,
  type ProductId,
  type VariantId,
} from '../../packages/domain/src';
import {
  canClaimLifetimeComplete,
  deriveAvailability,
  exactOptionPair,
  fullHistoryScope,
  productStatus,
  providerStatus,
  type Order,
  type Product,
  type Variant,
} from '../../packages/commerce-contract/src';

const workspace = internalId('ws-commerce', 'MerchantWorkspace') as MerchantWorkspaceId;
const integration = internalId('int-commerce', 'Integration') as IntegrationId;
const productId = internalId('product-1', 'Product') as ProductId;
const variantId = internalId('variant-1', 'Variant') as VariantId;

const product: Product = {
  productId,
  merchantWorkspaceId: workspace,
  integrationId: integration,
  providerProductId: 'provider-product-1',
  title: 'Synthetic Product',
  status: productStatus('ACTIVE'),
  mediaRefs: [],
  sourceTimestamp: utcTimestamp('2026-08-07T18:00:00Z'),
  observedAt: utcTimestamp('2026-08-07T18:00:01Z'),
};

const variant: Variant = {
  variantId,
  productId,
  integrationId: integration,
  providerVariantId: 'provider-variant-1',
  optionPairs: [exactOptionPair('Women’s Size', 'US 7 / EU 38')],
  priceMoney: money(1299n, 'USD'),
  sourceTimestamp: product.sourceTimestamp!,
  observedAt: product.observedAt,
};

const boundedOrder: Order = {
  orderId: internalId('order-1', 'Order'),
  merchantWorkspaceId: workspace,
  integrationId: integration,
  providerOrderId: 'provider-order-1',
  orderStatus: providerStatus('OPEN'),
  createdAtProvider: utcTimestamp('2026-08-01T10:00:00Z'),
  completenessScope: { kind: 'BOUNDED', reason: 'TIME_WINDOW' },
};

export const COMMERCE_CONTRACT_SCENARIOS = [
  {
    id: 'VS-02-EXACT-OPTION-LABEL-PRESERVED',
    actual: variant.optionPairs[0],
    expected: { label: 'Women’s Size', value: 'US 7 / EU 38' },
  },
  {
    id: 'F-INVENTORY-01-TRACKED-POSITIVE',
    actual: deriveAvailability({
      trackingState: 'TRACKED',
      rawQuantity: 4n,
      sellableQuantity: 4n,
      providerAvailability: 'SELLABLE',
      inventoryPolicy: 'REQUIRE_POSITIVE_QUANTITY',
      freshnessState: 'FRESH',
    }),
    expected: 'IN_STOCK',
  },
  {
    id: 'F-INVENTORY-02-TRACKED-ZERO-DENY',
    actual: deriveAvailability({
      trackingState: 'TRACKED',
      rawQuantity: 0n,
      sellableQuantity: 0n,
      providerAvailability: 'NOT_SELLABLE',
      inventoryPolicy: 'REQUIRE_POSITIVE_QUANTITY',
      freshnessState: 'FRESH',
    }),
    expected: 'OUT_OF_STOCK',
  },
  {
    id: 'F-INVENTORY-03-UNTRACKED-ZERO-PROVIDER-AVAILABLE',
    actual: deriveAvailability({
      trackingState: 'UNTRACKED',
      rawQuantity: 0n,
      providerAvailability: 'SELLABLE',
      inventoryPolicy: 'UNKNOWN',
      freshnessState: 'FRESH',
    }),
    expected: 'AVAILABLE_TO_ORDER',
  },
  {
    id: 'F-INVENTORY-04-STALE-INVENTORY',
    actual: deriveAvailability({
      trackingState: 'TRACKED',
      rawQuantity: 10n,
      sellableQuantity: 10n,
      providerAvailability: 'SELLABLE',
      inventoryPolicy: 'REQUIRE_POSITIVE_QUANTITY',
      freshnessState: 'STALE',
    }),
    expected: 'UNKNOWN',
  },
  {
    id: 'INVENTORY-CONFLICT-ZERO-BUT-PROVIDER-SELLABLE',
    actual: deriveAvailability({
      trackingState: 'TRACKED',
      rawQuantity: 0n,
      sellableQuantity: 0n,
      providerAvailability: 'SELLABLE',
      inventoryPolicy: 'REQUIRE_POSITIVE_QUANTITY',
      freshnessState: 'FRESH',
    }),
    expected: 'UNKNOWN',
  },
  {
    id: 'F-ORDER-03-BOUNDED-HISTORY-NOT-LIFETIME-COMPLETE',
    actual: canClaimLifetimeComplete(boundedOrder.completenessScope),
    expected: false,
  },
  {
    id: 'ORDER-FULL-HISTORY-REQUIRES-EVIDENCE',
    actual: canClaimLifetimeComplete(fullHistoryScope('provider-acceptance:order-history-v1')),
    expected: true,
  },
] as const;

let commerceContractPass = 0;
for (const scenario of COMMERCE_CONTRACT_SCENARIOS) {
  if (JSON.stringify(scenario.actual) === JSON.stringify(scenario.expected)) commerceContractPass += 1;
  else throw new Error(`${scenario.id}: expected ${JSON.stringify(scenario.expected)} got ${JSON.stringify(scenario.actual)}`);
}
console.log(`COMMERCE_CONTRACT_SCENARIOS ${commerceContractPass}/${COMMERCE_CONTRACT_SCENARIOS.length} PASS`);

export const COMMERCE_TYPE_SMOKE = {
  product,
  variant,
  inventoryObservationId: internalId('inventory-1', 'InventoryObservation') as InventoryObservationId,
};
