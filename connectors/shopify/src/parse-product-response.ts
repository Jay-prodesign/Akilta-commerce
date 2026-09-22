import type { IntegrationId, MerchantWorkspaceId, ProductId, UtcTimestamp, VariantId } from '../../../packages/domain/src';
import type { Product, Variant } from '../../../packages/commerce-contract/src/product';
import { mapShopifyOnlineStoreUrl, mapShopifyProductStatus, mapShopifySelectedOptionsToVariantOptionPairs } from './mapping';

/** Shape returned by the product(id:) query (see PR "Shopify connector: real, schema-validated GraphQL query documents"). */
export interface ShopifyProductQueryVariantNode {
  readonly id: string;
  readonly sku: string | null;
  readonly price: string;
  readonly compareAtPrice: string | null;
  readonly availableForSale: boolean;
  readonly sellableOnlineQuantity: number;
  readonly inventoryPolicy: 'DENY' | 'CONTINUE';
  readonly selectedOptions: readonly { readonly name: string; readonly value: string }[];
  readonly inventoryItem: { readonly tracked: boolean };
}

export interface ShopifyProductQueryResponse {
  readonly product: {
    readonly id: string;
    readonly title: string;
    readonly handle: string;
    readonly status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT' | 'UNLISTED';
    readonly onlineStoreUrl: string | null;
    readonly variants: { readonly edges: readonly { readonly node: ShopifyProductQueryVariantNode }[] };
  } | null;
}

export interface ParseShopifyProductResponseContext {
  /** Real internal ProductId lookup; Shopify's GID is never itself an AI Commerce internal ID. */
  readonly resolveProductId: (providerProductId: string) => ProductId;
  readonly resolveVariantId: (providerVariantId: string) => VariantId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly integrationId: IntegrationId;
  readonly observedAt: UtcTimestamp;
}

export interface ParsedShopifyProduct {
  readonly product: Product;
  readonly variants: readonly Variant[];
}

/**
 * Parses a real product(id:) query response into the normalized Product/Variant contract.
 * Returns null when the product does not exist (deleted id / wrong id) rather than a
 * partially-fabricated record.
 *
 * priceMoney/compareAtMoney are intentionally left unset: ProductVariant.price and
 * .compareAtPrice are Shopify's bare decimal-string Money scalar with no attached
 * currency, and decimal-to-minor-unit conversion is currency-dependent (not safely
 * assumable as 2 decimal places for every ISO currency, e.g. JPY/KWD differ) -- correct
 * mapping needs the shop's currencyCode, which this query does not fetch. Adding that is
 * a separate, deliberate follow-up, not a default assumption made here.
 *
 * mediaRefs is [] for the same reason: this query does not fetch Product.media/
 * featuredMedia, so there is nothing real to report -- never fabricated.
 */
export function parseShopifyProductResponse(
  response: ShopifyProductQueryResponse,
  context: ParseShopifyProductResponseContext,
): ParsedShopifyProduct | null {
  const { product } = response;
  if (!product) return null;

  const productId = context.resolveProductId(product.id);
  const productUrl = mapShopifyOnlineStoreUrl(product.onlineStoreUrl);

  const normalizedProduct: Product = {
    productId,
    merchantWorkspaceId: context.merchantWorkspaceId,
    integrationId: context.integrationId,
    providerProductId: product.id,
    title: product.title,
    status: mapShopifyProductStatus(product.status),
    ...(productUrl !== undefined ? { productUrl } : {}),
    mediaRefs: [],
    observedAt: context.observedAt,
  };

  const variants: Variant[] = product.variants.edges.map(({ node }) => ({
    variantId: context.resolveVariantId(node.id),
    productId,
    integrationId: context.integrationId,
    providerVariantId: node.id,
    ...(node.sku ? { sku: node.sku } : {}),
    optionPairs: mapShopifySelectedOptionsToVariantOptionPairs(node.selectedOptions),
    observedAt: context.observedAt,
  }));

  return { product: normalizedProduct, variants: Object.freeze(variants) };
}
