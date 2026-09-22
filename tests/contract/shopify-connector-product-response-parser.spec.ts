import { internalId, utcTimestamp } from '../../packages/domain/src';
import { parseShopifyProductResponse, type ShopifyProductQueryResponse } from '../../connectors/shopify/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Synthetic fixture only, shaped exactly like SHOPIFY_GET_PRODUCT_QUERY's real field selection -- never captured from or claimed to be a real store response. */
const SYNTHETIC_RESPONSE: ShopifyProductQueryResponse = {
  product: {
    id: 'gid://shopify/Product/1',
    title: 'Synthetic Test Product',
    handle: 'synthetic-test-product',
    status: 'ACTIVE',
    onlineStoreUrl: 'https://example.myshopify.com/products/synthetic-test-product',
    variants: {
      edges: [
        {
          node: {
            id: 'gid://shopify/ProductVariant/1',
            sku: 'SYN-1',
            price: '19.99',
            compareAtPrice: '24.99',
            availableForSale: true,
            sellableOnlineQuantity: 4,
            inventoryPolicy: 'DENY',
            selectedOptions: [{ name: 'Size', value: 'Medium' }],
            inventoryItem: { tracked: true },
          },
        },
        {
          node: {
            id: 'gid://shopify/ProductVariant/2',
            sku: null,
            price: '29.99',
            compareAtPrice: null,
            availableForSale: false,
            sellableOnlineQuantity: 0,
            inventoryPolicy: 'CONTINUE',
            selectedOptions: [{ name: 'Size', value: 'Large' }],
            inventoryItem: { tracked: false },
          },
        },
      ],
    },
  },
};

function main(): void {
  const merchantWorkspaceId = internalId('mw_test', 'MerchantWorkspace');
  const integrationId = internalId('int_test', 'Integration');
  const observedAt = utcTimestamp('2026-08-27T00:00:00.000Z');

  const parsed = parseShopifyProductResponse(SYNTHETIC_RESPONSE, {
    resolveProductId: (providerProductId) => internalId(`resolved:${providerProductId}`, 'Product'),
    resolveVariantId: (providerVariantId) => internalId(`resolved:${providerVariantId}`, 'Variant'),
    merchantWorkspaceId,
    integrationId,
    observedAt,
  });

  assert(parsed !== null, 'A present product parses to a non-null result');
  assert(parsed?.product.title === 'Synthetic Test Product', 'title passes through unchanged');
  assert(parsed?.product.status === 'ACTIVE', 'status maps via the real ProductStatus mapping');
  assert(parsed?.product.productUrl === 'https://example.myshopify.com/products/synthetic-test-product', 'present onlineStoreUrl becomes productUrl');
  assert(parsed?.product.providerProductId === 'gid://shopify/Product/1', 'the raw Shopify GID is preserved as providerProductId, never used as the internal id');
  assert(Array.isArray(parsed?.product.mediaRefs) && parsed?.product.mediaRefs.length === 0, 'mediaRefs is empty since this query does not fetch media -- not fabricated');

  assert(parsed?.variants.length === 2, 'Both variant edges are parsed');
  const first = parsed?.variants[0];
  assert(first?.providerVariantId === 'gid://shopify/ProductVariant/1', 'first variant GID preserved');
  assert(first?.sku === 'SYN-1', 'present sku passes through');
  assert(first?.optionPairs[0]?.label === 'Size' && first?.optionPairs[0]?.value === 'Medium', 'selectedOptions map to optionPairs');
  assert(first?.priceMoney === undefined, 'priceMoney is deliberately left unset -- currency context is not available from this query, never guessed as a default currency/decimal convention');
  assert(first?.compareAtMoney === undefined, 'compareAtMoney is deliberately left unset for the same reason');

  const second = parsed?.variants[1];
  assert(second?.sku === undefined, 'a null sku becomes undefined, never an empty string');

  const missing = parseShopifyProductResponse({ product: null }, {
    resolveProductId: (id) => internalId(`resolved:${id}`, 'Product'),
    resolveVariantId: (id) => internalId(`resolved:${id}`, 'Variant'),
    merchantWorkspaceId,
    integrationId,
    observedAt,
  });
  assert(missing === null, 'A null product (not found/deleted) parses to null, never a partially-fabricated record');

  console.log('shopify-connector-product-response-parser: 14/14 PASS');
}

main();
