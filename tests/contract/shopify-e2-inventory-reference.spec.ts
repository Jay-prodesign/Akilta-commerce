import { deriveAvailability } from '../../packages/commerce-contract/src/inventory';

let passed = 0;
function assertEqual(actual: unknown, expected: unknown, name: string) {
  if (actual !== expected) throw new Error(`${name}:${String(actual)}!=${String(expected)}`);
  passed += 1;
  console.log(`PASS ${name}`);
}

const observed = deriveAvailability({
  trackingState: 'UNTRACKED',
  rawQuantity: 0n,
  sellableQuantity: 0n,
  providerAvailability: 'SELLABLE',
  inventoryPolicy: 'REQUIRE_POSITIVE_QUANTITY',
  freshnessState: 'FRESH',
});
assertEqual(observed, 'AVAILABLE_TO_ORDER', 'E2 exact Shopify semantics map to available-to-order');
assertEqual(observed === 'OUT_OF_STOCK', false, 'zero quantity alone does not become out-of-stock');

const withoutSellability = deriveAvailability({
  trackingState: 'UNTRACKED',
  rawQuantity: 0n,
  sellableQuantity: 0n,
  providerAvailability: 'UNKNOWN',
  inventoryPolicy: 'REQUIRE_POSITIVE_QUANTITY',
  freshnessState: 'FRESH',
});
assertEqual(withoutSellability, 'UNKNOWN', 'untracked zero without provider sellability fails closed');
console.log(`SHOPIFY_E2_INVENTORY_REFERENCE_PASS ${passed}/3`);
