import type { CustomerId, IntegrationId, MerchantWorkspaceId, OrderId } from '../../../packages/domain/src';
import { utcTimestamp } from '../../../packages/domain/src';
import type { CompletenessScope, Order } from '../../../packages/commerce-contract/src/order';
import { providerStatus } from '../../../packages/commerce-contract/src/order';

/** Shape returned by the order(id:) query (see queries.ts SHOPIFY_GET_ORDER_QUERY). */
export interface ShopifyOrderQueryResponse {
  readonly order: {
    readonly id: string;
    readonly name: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly displayFinancialStatus: string | null;
    readonly displayFulfillmentStatus: string;
    readonly closed: boolean;
    readonly cancelledAt: string | null;
    readonly currentTotalPriceSet: { readonly shopMoney: { readonly amount: string; readonly currencyCode: string } };
    readonly customer: { readonly id: string } | null;
  } | null;
}

export interface ParseShopifyOrderResponseContext {
  /** Real internal OrderId lookup; Shopify's GID is never itself an AI Commerce internal ID. */
  readonly resolveOrderId: (providerOrderId: string) => OrderId;
  readonly resolveCustomerId?: (providerCustomerRef: string) => CustomerId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly integrationId: IntegrationId;
  /** From deriveShopifyOrderCompletenessScope (mapping.ts) -- a single order(id:) fetch says nothing about order-history completeness on its own. */
  readonly completenessScope: CompletenessScope;
}

/**
 * Parses a real order(id:) query response into the normalized Order contract. Returns
 * null when the order does not exist (deleted id / wrong id) rather than a
 * partially-fabricated record.
 *
 * orderStatus precedence: cancelledAt takes priority over displayFulfillmentStatus when
 * present -- a cancelled order's fulfillment status alone (e.g. UNFULFILLED) would
 * otherwise hide the real cancellation state, which Shopify tracks as a separate signal
 * from fulfillment. paymentStatus maps displayFinancialStatus directly (nullable on
 * Shopify's side, e.g. draft/test orders -- left unset rather than guessed when absent).
 *
 * totalMoney is intentionally left unset for the same reason as
 * parseShopifyProductResponse's priceMoney: currentTotalPriceSet.shopMoney.amount is a
 * bare decimal string, and decimal-to-minor-unit conversion is currency-dependent (not
 * safely assumable as 2 decimals for every ISO currency). currency (the raw
 * currencyCode) is reported on its own since the normalized contract exposes it as a
 * plain optional string, separate from the Money value.
 */
export function parseShopifyOrderResponse(
  response: ShopifyOrderQueryResponse,
  context: ParseShopifyOrderResponseContext,
): Order | null {
  const { order } = response;
  if (!order) return null;

  const orderStatus = providerStatus(order.cancelledAt !== null ? 'CANCELLED' : order.displayFulfillmentStatus);
  const paymentStatus = order.displayFinancialStatus !== null ? providerStatus(order.displayFinancialStatus) : undefined;
  const customerId = order.customer && context.resolveCustomerId ? context.resolveCustomerId(order.customer.id) : undefined;

  return {
    orderId: context.resolveOrderId(order.id),
    merchantWorkspaceId: context.merchantWorkspaceId,
    integrationId: context.integrationId,
    providerOrderId: order.id,
    displayOrderRef: order.name,
    ...(customerId !== undefined ? { customerId } : {}),
    ...(order.customer ? { providerCustomerRef: order.customer.id } : {}),
    orderStatus,
    ...(paymentStatus !== undefined ? { paymentStatus } : {}),
    currency: order.currentTotalPriceSet.shopMoney.currencyCode,
    createdAtProvider: utcTimestamp(order.createdAt),
    updatedAtProvider: utcTimestamp(order.updatedAt),
    completenessScope: context.completenessScope,
  };
}
