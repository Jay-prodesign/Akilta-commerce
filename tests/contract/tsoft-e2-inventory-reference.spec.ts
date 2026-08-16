import { deriveAvailability } from '../../packages/commerce-contract/src/inventory';

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

const cases = [
  {
    label: 'negative-stock policy allows ordering at zero quantity',
    input: {
      trackingState: 'TRACKED' as const,
      rawQuantity: 0n,
      sellableQuantity: 0n,
      providerAvailability: 'SELLABLE' as const,
      inventoryPolicy: 'ALLOW_SELLING_WITHOUT_POSITIVE_QUANTITY' as const,
      freshnessState: 'FRESH' as const,
    },
    expected: 'AVAILABLE_TO_ORDER',
  },
  {
    label: 'positive-quantity requirement plus provider not-sellable is out of stock',
    input: {
      trackingState: 'TRACKED' as const,
      rawQuantity: 0n,
      sellableQuantity: 0n,
      providerAvailability: 'NOT_SELLABLE' as const,
      inventoryPolicy: 'REQUIRE_POSITIVE_QUANTITY' as const,
      freshnessState: 'FRESH' as const,
    },
    expected: 'OUT_OF_STOCK',
  },
  {
    label: 'quantity zero with unknown provider policy remains unknown',
    input: {
      trackingState: 'TRACKED' as const,
      rawQuantity: 0n,
      sellableQuantity: 0n,
      providerAvailability: 'UNKNOWN' as const,
      inventoryPolicy: 'UNKNOWN' as const,
      freshnessState: 'FRESH' as const,
    },
    expected: 'UNKNOWN',
  },
] as const;

for (const item of cases) {
  assertEqual(deriveAvailability(item.input), item.expected, item.label);
}

console.log(JSON.stringify({ status: 'PASS', passed: cases.length, total: cases.length }));
