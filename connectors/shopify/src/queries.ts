/**
 * Real Shopify Admin GraphQL query documents for the two operations this connector has a
 * normalized mapping for (mapping.ts). Every field was validated this session against the
 * live Admin GraphQL schema via read-only introspection + query validation -- no field is
 * guessed, and no query here has been executed against any store. Required OAuth scopes
 * are exactly what schema validation reported, not assumed.
 */

/** Feeds mapShopifyInventoryToDerivationInput / mapShopifyProductStatus / mapShopifyOnlineStoreUrl / mapShopifySelectedOptionsToVariantOptionPairs. Required scopes: read_products, read_inventory. */
export const SHOPIFY_GET_PRODUCT_QUERY = `query GetProductForNormalizedContract($id: ID!) {
  product(id: $id) {
    id
    title
    handle
    status
    onlineStoreUrl
    variants(first: 50) {
      edges {
        node {
          id
          sku
          price
          compareAtPrice
          availableForSale
          sellableOnlineQuantity
          inventoryPolicy
          selectedOptions {
            name
            value
          }
          inventoryItem {
            tracked
          }
        }
      }
    }
  }
}`;

/** Feeds deriveShopifyOrderCompletenessScope. Required scopes: read_orders, read_marketplace_orders, read_quick_sale, read_customers. */
export const SHOPIFY_GET_ORDER_QUERY = `query GetOrderForNormalizedContract($id: ID!) {
  order(id: $id) {
    id
    name
    createdAt
    updatedAt
    displayFinancialStatus
    currentTotalPriceSet {
      shopMoney {
        amount
        currencyCode
      }
    }
    customer {
      id
    }
  }
}`;
