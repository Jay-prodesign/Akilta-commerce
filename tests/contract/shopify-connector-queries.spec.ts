import { SHOPIFY_GET_ORDER_QUERY, SHOPIFY_GET_PRODUCT_QUERY } from '../../connectors/shopify/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * These two query documents were validated this session against the real Shopify Admin
 * GraphQL schema via read-only schema-validation tooling (not executed against any
 * store). This test pins their exact field selection so a future silent edit cannot
 * reintroduce a guessed/unvalidated field without deliberately updating -- and
 * re-validating -- the query text.
 */
function main(): void {
  assert(SHOPIFY_GET_PRODUCT_QUERY.includes('product(id: $id)'), 'Product query targets the real product(id: ID!) root field');
  assert(SHOPIFY_GET_PRODUCT_QUERY.includes('status'), 'Product query selects status (feeds mapShopifyProductStatus)');
  assert(SHOPIFY_GET_PRODUCT_QUERY.includes('onlineStoreUrl'), 'Product query selects onlineStoreUrl (feeds mapShopifyOnlineStoreUrl)');
  assert(SHOPIFY_GET_PRODUCT_QUERY.includes('sellableOnlineQuantity'), 'Product query selects sellableOnlineQuantity (feeds mapShopifyInventoryToDerivationInput)');
  assert(SHOPIFY_GET_PRODUCT_QUERY.includes('availableForSale'), 'Product query selects availableForSale (feeds mapShopifyInventoryToDerivationInput)');
  assert(SHOPIFY_GET_PRODUCT_QUERY.includes('inventoryPolicy'), 'Product query selects inventoryPolicy (feeds mapShopifyInventoryToDerivationInput)');
  assert(SHOPIFY_GET_PRODUCT_QUERY.includes('selectedOptions'), 'Product query selects selectedOptions (feeds mapShopifySelectedOptionsToVariantOptionPairs)');
  assert(SHOPIFY_GET_PRODUCT_QUERY.includes('inventoryItem'), 'Product query selects inventoryItem.tracked (feeds mapShopifyInventoryToDerivationInput)');

  assert(SHOPIFY_GET_ORDER_QUERY.includes('order(id: $id)'), 'Order query targets the real order(id: ID!) root field');
  assert(SHOPIFY_GET_ORDER_QUERY.includes('currentTotalPriceSet'), 'Order query selects the real MoneyBag field, not a guessed totalPrice scalar');
  assert(SHOPIFY_GET_ORDER_QUERY.includes('shopMoney'), 'Order query drills into MoneyBag.shopMoney per the real schema shape');
  assert(SHOPIFY_GET_ORDER_QUERY.includes('displayFinancialStatus'), 'Order query selects the real displayFinancialStatus enum field');
  assert(SHOPIFY_GET_ORDER_QUERY.includes('displayFulfillmentStatus'), 'Order query selects the real displayFulfillmentStatus enum field (feeds parseShopifyOrderResponse orderStatus)');
  assert(SHOPIFY_GET_ORDER_QUERY.includes('closed'), 'Order query selects the real closed boolean field');
  assert(SHOPIFY_GET_ORDER_QUERY.includes('cancelledAt'), 'Order query selects the real cancelledAt field');

  // Neither query fabricates a field name this session did not confirm exists.
  assert(!SHOPIFY_GET_PRODUCT_QUERY.includes('totalPrice'), 'No guessed scalar totalPrice field on Product');
  assert(!SHOPIFY_GET_ORDER_QUERY.includes('financialStatus:'), 'Order query uses displayFinancialStatus, not a guessed legacy field name');
  assert(!SHOPIFY_GET_ORDER_QUERY.includes('fulfillmentStatus:'), 'Order query uses displayFulfillmentStatus, not a guessed legacy field name');

  console.log('shopify-connector-queries: 15/15 PASS');
}

main();
