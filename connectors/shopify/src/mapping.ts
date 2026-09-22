import type { CompletenessScope } from '../../../packages/commerce-contract/src/order';
import type {
  DerivedAvailability,
  FreshnessState,
  InventoryDerivationInput,
} from '../../../packages/commerce-contract/src/inventory';
import { deriveAvailability } from '../../../packages/commerce-contract/src/inventory';
import type { ProductStatus, VariantOptionPair } from '../../../packages/commerce-contract/src/product';
import { exactOptionPair, productStatus } from '../../../packages/commerce-contract/src/product';
import { utcTimestamp, type UtcTimestamp } from '../../../packages/domain/src';

/**
 * Real, schema-verified Shopify Admin GraphQL field mapping only -- no execution, no store
 * access. Every input here names an actual field confirmed by read-only schema introspection
 * this session: InventoryItem.tracked, ProductVariant.inventoryPolicy
 * (ProductVariantInventoryPolicy: DENY | CONTINUE), ProductVariant.availableForSale,
 * ProductVariant.sellableOnlineQuantity. This function performs no HTTP call and requires no
 * credential; it only proves the normalized-contract mapping is well-defined ahead of E3
 * execution evidence.
 */
export interface ShopifyInventorySnapshot {
  /** InventoryItem.tracked */
  readonly tracked: boolean;
  /** ProductVariant.inventoryPolicy */
  readonly inventoryPolicy: 'DENY' | 'CONTINUE';
  /** ProductVariant.availableForSale */
  readonly availableForSale: boolean;
  /** ProductVariant.sellableOnlineQuantity (always present, never null, per schema) */
  readonly sellableOnlineQuantity: number;
  /** Caller-supplied read-recency signal; Shopify does not expose this itself. */
  readonly freshnessState: FreshnessState;
}

export function mapShopifyInventoryToDerivationInput(
  snapshot: ShopifyInventorySnapshot,
): InventoryDerivationInput {
  if (!Number.isInteger(snapshot.sellableOnlineQuantity) || snapshot.sellableOnlineQuantity < 0) {
    throw new Error('SHOPIFY_INVENTORY_MAPPING_INVALID_QUANTITY');
  }
  return {
    trackingState: snapshot.tracked ? 'TRACKED' : 'UNTRACKED',
    sellableQuantity: BigInt(snapshot.sellableOnlineQuantity),
    providerAvailability: snapshot.availableForSale ? 'SELLABLE' : 'NOT_SELLABLE',
    inventoryPolicy: snapshot.inventoryPolicy === 'DENY' ? 'REQUIRE_POSITIVE_QUANTITY' : 'ALLOW_SELLING_WITHOUT_POSITIVE_QUANTITY',
    freshnessState: snapshot.freshnessState,
  };
}

/** Convenience composition proving the mapping feeds the existing normalized derivation rule unchanged. */
export function deriveShopifyAvailability(snapshot: ShopifyInventorySnapshot): DerivedAvailability {
  return deriveAvailability(mapShopifyInventoryToDerivationInput(snapshot));
}

const SHOPIFY_DEFAULT_ORDER_WINDOW_DAYS = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The Order object is scoped to the last 60 days by default; older records require the
 * merchant to have explicitly granted read_all_orders (in addition to read_orders/
 * write_orders). This is exact E2 schema-reference behavior, not an assumption: without
 * confirmed grant of that scope, completeness must fail closed to BOUNDED/PERMISSION_SCOPE
 * rather than being silently reported as a time-window artifact of the query itself.
 */
export function deriveShopifyOrderCompletenessScope(input: {
  readonly hasReadAllOrdersScopeGranted: boolean;
  readonly oldestReturnedOrderCreatedAt?: UtcTimestamp;
  readonly observedAt: UtcTimestamp;
}): CompletenessScope {
  if (input.hasReadAllOrdersScopeGranted) {
    return { kind: 'UNKNOWN', reason: 'SHOPIFY_READ_ALL_ORDERS_GRANTED_BUT_NO_E3_READBACK_YET' };
  }

  const observedAtMs = new Date(input.observedAt).getTime();
  const windowStartMs = observedAtMs - SHOPIFY_DEFAULT_ORDER_WINDOW_DAYS * MS_PER_DAY;
  const windowStart = utcTimestamp(new Date(windowStartMs));

  if (input.oldestReturnedOrderCreatedAt !== undefined) {
    const oldestMs = new Date(input.oldestReturnedOrderCreatedAt).getTime();
    if (oldestMs < windowStartMs) {
      // Real orders older than the documented default window were returned: the store's exact
      // access-scope state does not match the default-window assumption. Fail closed rather
      // than silently claim a 60-day boundary that the observed data contradicts.
      return { kind: 'UNKNOWN', reason: 'SHOPIFY_ORDER_WINDOW_ASSUMPTION_CONTRADICTED_BY_OBSERVED_DATA' };
    }
  }

  return {
    kind: 'BOUNDED',
    reason: 'PERMISSION_SCOPE',
    windowStart,
    windowEnd: input.observedAt,
  };
}

/**
 * Product.status is a real ProductStatus! enum (ACTIVE | ARCHIVED | DRAFT | UNLISTED,
 * confirmed by schema introspection this session) with no lossy transformation needed --
 * the normalized ProductStatus brand accepts any non-empty provider string as-is. Kept as
 * an explicit function (not a raw cast at the call site) so a future non-string/renamed
 * enum value fails loudly here rather than silently at an arbitrary call site.
 */
export function mapShopifyProductStatus(rawStatus: 'ACTIVE' | 'ARCHIVED' | 'DRAFT' | 'UNLISTED'): ProductStatus {
  return productStatus(rawStatus);
}

/**
 * Product.onlineStoreUrl is nullable: Shopify returns null whenever the product is not
 * currently published/reachable on the Online Store sales channel (for example DRAFT/
 * ARCHIVED status, or ACTIVE but not published to that channel). Never substitute a
 * constructed handle-based URL for a null onlineStoreUrl -- that would assert reachability
 * the provider itself did not confirm.
 */
export function mapShopifyOnlineStoreUrl(onlineStoreUrl: string | null): string | undefined {
  return onlineStoreUrl ?? undefined;
}

/** ProductVariant.selectedOptions: [SelectedOption!]! -- each has real, non-null name/value fields. */
export function mapShopifySelectedOptionsToVariantOptionPairs(
  selectedOptions: readonly { readonly name: string; readonly value: string }[],
): readonly VariantOptionPair[] {
  return selectedOptions.map((option) => exactOptionPair(option.name, option.value));
}
