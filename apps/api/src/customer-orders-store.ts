import {
  internalId,
  isoCurrencyCode,
  money,
  utcTimestamp,
  type CustomerId,
  type Money,
  type MerchantWorkspaceId,
  type OrderId,
  type UtcTimestamp,
} from '../../../packages/domain/src';

/**
 * AC-CCIA-001 ("customer.context" Control Center read operation, order-history extension) —
 * persistence adapter for a bounded, most-recent-first list of a customer's own orders. A plain
 * read, not a decision: `authorizeCustomerOrderAccess` (packages/domain/src/customer-identity.ts)
 * exists for a structurally different problem — verifying a *customer's own* channel identity
 * before disclosing order detail back to that same customer (e.g. a WhatsApp bot) — and is neither
 * reused nor duplicated here. This adapter instead backs an *internal staff* view already gated by
 * the caller's own `commerce.order:read` grant (checked by the route, not by this file); once a
 * support agent is authorized to see order data at all, no further per-order disclosure decision is
 * invented here.
 *
 * `completenessScope` is carried through verbatim, never hidden: a merchant-visible order list must
 * never imply a complete order history when the underlying observation is `BOUNDED_HISTORY` or
 * `UNKNOWN` (same completeness-scope discipline as the canonical P0-009 contract). `totalAmount` is
 * omitted, never defaulted to zero, when `total_amount_minor` is null.
 */

export interface CustomerOrdersQueryExecutor {
  query(sql: string, params: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

const SELECT_RECENT_ORDERS = `
  SELECT order_id, display_order_ref, order_status, payment_status, currency, total_amount_minor,
         completeness_scope, provider_created_at
  FROM orders
  WHERE customer_id = $1 AND merchant_workspace_id = $2
  ORDER BY provider_created_at DESC
  LIMIT $3
`;

export const CUSTOMER_ORDERS_DEFAULT_LIMIT = 20;

export interface CustomerOrderSummary {
  readonly orderId: OrderId;
  readonly displayOrderRef: string;
  readonly orderStatus: string;
  readonly paymentStatus: string;
  readonly totalAmount?: Money;
  readonly completenessScope: 'FULL_HISTORY' | 'BOUNDED_HISTORY' | 'UNKNOWN';
  readonly providerCreatedAt: UtcTimestamp;
}

export type CustomerOrdersReadOutcome =
  | { readonly status: 'FOUND'; readonly orders: readonly CustomerOrderSummary[] }
  | { readonly status: 'STORE_ERROR' };

function assertIsCompletenessScope(value: string): asserts value is CustomerOrderSummary['completenessScope'] {
  if (value !== 'FULL_HISTORY' && value !== 'BOUNDED_HISTORY' && value !== 'UNKNOWN') {
    throw new Error(`Unrecognized completeness_scope from store: ${value}`);
  }
}

function rowToOrderSummary(row: Record<string, unknown>): CustomerOrderSummary {
  const hasAmount = row.total_amount_minor !== null && row.total_amount_minor !== undefined;
  const currency = row.currency;
  if (hasAmount && typeof currency !== 'string') {
    throw new Error('orders row has a total_amount_minor value but no currency to pair it with');
  }

  const completenessScopeRaw = String(row.completeness_scope);
  assertIsCompletenessScope(completenessScopeRaw);

  return {
    orderId: internalId(String(row.order_id), 'Order'),
    displayOrderRef: String(row.display_order_ref),
    orderStatus: String(row.order_status),
    paymentStatus: String(row.payment_status),
    ...(hasAmount
      ? { totalAmount: money(BigInt(String(row.total_amount_minor)), isoCurrencyCode(String(currency))) }
      : {}),
    completenessScope: completenessScopeRaw,
    providerCreatedAt: utcTimestamp(
      row.provider_created_at instanceof Date ? row.provider_created_at : String(row.provider_created_at),
    ),
  };
}

export interface CustomerOrdersStore {
  readRecentOrders(
    customerId: CustomerId,
    merchantWorkspaceId: MerchantWorkspaceId,
    limit?: number,
  ): Promise<CustomerOrdersReadOutcome>;
}

export function createCustomerOrdersStore(executor: CustomerOrdersQueryExecutor): CustomerOrdersStore {
  return {
    async readRecentOrders(customerId, merchantWorkspaceId, limit = CUSTOMER_ORDERS_DEFAULT_LIMIT) {
      let rows: readonly Record<string, unknown>[];
      try {
        const result = await executor.query(SELECT_RECENT_ORDERS, [customerId, merchantWorkspaceId, limit]);
        rows = result.rows;
      } catch {
        return { status: 'STORE_ERROR' };
      }

      try {
        return { status: 'FOUND', orders: rows.map(rowToOrderSummary) };
      } catch {
        return { status: 'STORE_ERROR' };
      }
    },
  };
}
