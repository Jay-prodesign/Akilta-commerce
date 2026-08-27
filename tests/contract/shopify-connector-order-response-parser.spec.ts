import { internalId, utcTimestamp } from '../../packages/domain/src';
import { parseShopifyOrderResponse, type ShopifyOrderQueryResponse } from '../../connectors/shopify/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Synthetic fixture only, shaped exactly like SHOPIFY_GET_ORDER_QUERY's real field selection -- never captured from or claimed to be a real store response. */
const SYNTHETIC_OPEN_ORDER: ShopifyOrderQueryResponse = {
  order: {
    id: 'gid://shopify/Order/1',
    name: '#1001',
    createdAt: '2026-08-20T10:00:00Z',
    updatedAt: '2026-08-21T09:00:00Z',
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    closed: false,
    cancelledAt: null,
    currentTotalPriceSet: { shopMoney: { amount: '49.98', currencyCode: 'USD' } },
    customer: { id: 'gid://shopify/Customer/1' },
  },
};

const SYNTHETIC_CANCELLED_ORDER: ShopifyOrderQueryResponse = {
  order: {
    id: 'gid://shopify/Order/2',
    name: '#1002',
    createdAt: '2026-08-19T10:00:00Z',
    updatedAt: '2026-08-19T11:00:00Z',
    displayFinancialStatus: null,
    displayFulfillmentStatus: 'UNFULFILLED',
    closed: true,
    cancelledAt: '2026-08-19T11:00:00Z',
    currentTotalPriceSet: { shopMoney: { amount: '10.00', currencyCode: 'USD' } },
    customer: null,
  },
};

function main(): void {
  const merchantWorkspaceId = internalId('mw_test', 'MerchantWorkspace');
  const integrationId = internalId('int_test', 'Integration');
  const completenessScope = { kind: 'UNKNOWN' as const, reason: 'SINGLE_ORDER_FETCH_NOT_A_LIST_QUERY' };

  const open = parseShopifyOrderResponse(SYNTHETIC_OPEN_ORDER, {
    resolveOrderId: (id) => internalId(`resolved:${id}`, 'Order'),
    resolveCustomerId: (id) => internalId(`resolved:${id}`, 'Customer'),
    merchantWorkspaceId,
    integrationId,
    completenessScope,
  });

  assert(open !== null, 'A present order parses to a non-null result');
  assert(open?.providerOrderId === 'gid://shopify/Order/1', 'raw GID preserved as providerOrderId, never used as the internal id');
  assert(open?.displayOrderRef === '#1001', 'Order.name maps to displayOrderRef');
  assert(open?.orderStatus === 'UNFULFILLED', 'orderStatus uses displayFulfillmentStatus when not cancelled');
  assert(open?.paymentStatus === 'PAID', 'paymentStatus maps displayFinancialStatus');
  assert(open?.currency === 'USD', 'currency reports the raw currencyCode');
  assert(open?.totalMoney === undefined, 'totalMoney is deliberately left unset -- currency-dependent decimal conversion is not guessed');
  assert(open?.customerId !== undefined, 'customer present + resolver supplied -> customerId set');
  assert(open?.providerCustomerRef === 'gid://shopify/Customer/1', 'raw customer GID preserved');
  assert(open?.createdAtProvider === utcTimestamp('2026-08-20T10:00:00Z'), 'createdAt maps to createdAtProvider');

  const cancelled = parseShopifyOrderResponse(SYNTHETIC_CANCELLED_ORDER, {
    resolveOrderId: (id) => internalId(`resolved:${id}`, 'Order'),
    merchantWorkspaceId,
    integrationId,
    completenessScope,
  });

  assert(cancelled?.orderStatus === 'CANCELLED', 'cancelledAt takes precedence over displayFulfillmentStatus for orderStatus');
  assert(cancelled?.paymentStatus === undefined, 'a null displayFinancialStatus is left unset, never a guessed default');
  assert(cancelled?.customerId === undefined, 'a null customer with no resolver call leaves customerId unset');
  assert(cancelled?.providerCustomerRef === undefined, 'a null customer leaves providerCustomerRef unset');

  const missing = parseShopifyOrderResponse({ order: null }, {
    resolveOrderId: (id) => internalId(`resolved:${id}`, 'Order'),
    merchantWorkspaceId,
    integrationId,
    completenessScope,
  });
  assert(missing === null, 'A null order (not found/deleted) parses to null, never a partially-fabricated record');

  console.log('shopify-connector-order-response-parser: 14/14 PASS');
}

main();
