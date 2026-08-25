import { utcTimestamp } from '../../packages/domain/src';
import {
  deriveShopifyAvailability,
  deriveShopifyOrderCompletenessScope,
  mapShopifyInventoryToDerivationInput,
} from '../../connectors/shopify/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function main(): void {
  // Real ProductVariant/InventoryItem field mapping, not guessed.
  const trackedDeny = mapShopifyInventoryToDerivationInput({
    tracked: true,
    inventoryPolicy: 'DENY',
    availableForSale: true,
    sellableOnlineQuantity: 5,
    freshnessState: 'FRESH',
  });
  assert(trackedDeny.trackingState === 'TRACKED', 'InventoryItem.tracked=true maps to TRACKED');
  assert(trackedDeny.inventoryPolicy === 'REQUIRE_POSITIVE_QUANTITY', 'DENY maps to REQUIRE_POSITIVE_QUANTITY');
  assert(trackedDeny.providerAvailability === 'SELLABLE', 'availableForSale=true maps to SELLABLE');
  assert(trackedDeny.sellableQuantity === 5n, 'sellableOnlineQuantity maps to sellableQuantity');

  const untrackedContinue = mapShopifyInventoryToDerivationInput({
    tracked: false,
    inventoryPolicy: 'CONTINUE',
    availableForSale: false,
    sellableOnlineQuantity: 0,
    freshnessState: 'FRESH',
  });
  assert(untrackedContinue.trackingState === 'UNTRACKED', 'InventoryItem.tracked=false maps to UNTRACKED');
  assert(untrackedContinue.inventoryPolicy === 'ALLOW_SELLING_WITHOUT_POSITIVE_QUANTITY', 'CONTINUE maps to ALLOW_SELLING_WITHOUT_POSITIVE_QUANTITY');
  assert(untrackedContinue.providerAvailability === 'NOT_SELLABLE', 'availableForSale=false maps to NOT_SELLABLE');

  let rejectedNegative = false;
  try {
    mapShopifyInventoryToDerivationInput({
      tracked: true,
      inventoryPolicy: 'DENY',
      availableForSale: true,
      sellableOnlineQuantity: -1,
      freshnessState: 'FRESH',
    });
  } catch {
    rejectedNegative = true;
  }
  assert(rejectedNegative, 'Negative sellableOnlineQuantity must be rejected, never silently coerced');

  // Composition: mapping must feed the existing, already-accepted normalized derivation rule unchanged.
  const availability = deriveShopifyAvailability({
    tracked: true,
    inventoryPolicy: 'DENY',
    availableForSale: true,
    sellableOnlineQuantity: 3,
    freshnessState: 'FRESH',
  });
  assert(availability === 'IN_STOCK', 'Tracked+positive+sellable composes to IN_STOCK via the existing derivation rule');

  const staleAvailability = deriveShopifyAvailability({
    tracked: true,
    inventoryPolicy: 'DENY',
    availableForSale: true,
    sellableOnlineQuantity: 3,
    freshnessState: 'STALE',
  });
  assert(staleAvailability === 'UNKNOWN', 'Stale freshness fails closed to UNKNOWN regardless of quantity');

  // Order completeness scope: real 60-day default window + read_all_orders scope fact.
  const observedAt = utcTimestamp('2026-08-25T00:00:00.000Z');
  const withinWindow = deriveShopifyOrderCompletenessScope({
    hasReadAllOrdersScopeGranted: false,
    oldestReturnedOrderCreatedAt: utcTimestamp('2026-07-10T00:00:00.000Z'),
    observedAt,
  });
  assert(withinWindow.kind === 'BOUNDED', 'Default (no read_all_orders) scope is BOUNDED');
  assert(withinWindow.kind === 'BOUNDED' && withinWindow.reason === 'PERMISSION_SCOPE', 'BOUNDED reason is PERMISSION_SCOPE, not a guessed TIME_WINDOW label');

  const grantedScope = deriveShopifyOrderCompletenessScope({
    hasReadAllOrdersScopeGranted: true,
    observedAt,
  });
  assert(grantedScope.kind === 'UNKNOWN', 'read_all_orders grant alone is not FULL_HISTORY proof without E3 readback');

  const contradicted = deriveShopifyOrderCompletenessScope({
    hasReadAllOrdersScopeGranted: false,
    oldestReturnedOrderCreatedAt: utcTimestamp('2026-01-01T00:00:00.000Z'),
    observedAt,
  });
  assert(contradicted.kind === 'UNKNOWN', 'Observed data older than the assumed default window fails closed instead of asserting a wrong boundary');

  console.log('shopify-connector-mapping: 11/11 PASS');
}

main();
