import {
  createCustomerOrdersStore,
  CUSTOMER_ORDERS_DEFAULT_LIMIT,
  type CustomerOrdersQueryExecutor,
} from '../../apps/api/src/customer-orders-store';
import { internalId, type CustomerId, type MerchantWorkspaceId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const customerId: CustomerId = internalId('cust-orders-1', 'Customer');
const workspaceId: MerchantWorkspaceId = internalId('cust-orders-ws-1', 'MerchantWorkspace');

function executor(rows: readonly Record<string, unknown>[]): CustomerOrdersQueryExecutor {
  return { query: () => Promise.resolve({ rows }) };
}

const cases: ReadonlyArray<{ readonly id: string; readonly run: () => Promise<void> }> = [
  {
    id: 'ORDERS-01-FOUND-ORDER-WITH-AMOUNT-MAPS-CORRECTLY',
    run: async () => {
      const store = createCustomerOrdersStore(
        executor([
          {
            order_id: 'ord-1',
            display_order_ref: 'ORD-1001',
            order_status: 'FULFILLED',
            payment_status: 'CAPTURED',
            currency: 'USD',
            total_amount_minor: '4599',
            completeness_scope: 'FULL_HISTORY',
            provider_created_at: '2026-09-01T10:00:00.000Z',
          },
        ]),
      );
      const result = await store.readRecentOrders(customerId, workspaceId);
      assert(result.status === 'FOUND', 'a row with a real amount must be found');
      assert(
        result.status === 'FOUND' &&
          result.orders.length === 1 &&
          result.orders[0]!.totalAmount?.amountMinor === 4599n &&
          result.orders[0]!.totalAmount?.currency === 'USD' &&
          result.orders[0]!.completenessScope === 'FULL_HISTORY',
        'the real amount/currency/completeness scope must map through verbatim',
      );
    },
  },
  {
    id: 'ORDERS-02-NULL-AMOUNT-OMITS-TOTAL-AMOUNT-NEVER-DEFAULTS-TO-ZERO',
    run: async () => {
      const store = createCustomerOrdersStore(
        executor([
          {
            order_id: 'ord-2',
            display_order_ref: 'ORD-1002',
            order_status: 'PENDING',
            payment_status: 'UNPAID',
            currency: null,
            total_amount_minor: null,
            completeness_scope: 'BOUNDED_HISTORY',
            provider_created_at: '2026-09-02T10:00:00.000Z',
          },
        ]),
      );
      const result = await store.readRecentOrders(customerId, workspaceId);
      assert(
        result.status === 'FOUND' && result.orders.length === 1 && result.orders[0]!.totalAmount === undefined,
        'a null total_amount_minor must leave totalAmount absent, never a fabricated zero',
      );
    },
  },
  {
    id: 'ORDERS-03-HALF-PRESENT-AMOUNT-CURRENCY-PAIR-FAILS-CLOSED',
    run: async () => {
      const store = createCustomerOrdersStore(
        executor([
          {
            order_id: 'ord-3',
            display_order_ref: 'ORD-1003',
            order_status: 'FULFILLED',
            payment_status: 'CAPTURED',
            currency: null,
            total_amount_minor: '1000',
            completeness_scope: 'FULL_HISTORY',
            provider_created_at: '2026-09-03T10:00:00.000Z',
          },
        ]),
      );
      const result = await store.readRecentOrders(customerId, workspaceId);
      assert(
        result.status === 'STORE_ERROR',
        'an amount with no currency to pair it with is an inconsistent row, never silently coerced',
      );
    },
  },
  {
    id: 'ORDERS-04-READ-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const store = createCustomerOrdersStore({ query: () => Promise.reject(new Error('connection lost')) });
      const result = await store.readRecentOrders(customerId, workspaceId);
      assert(result.status === 'STORE_ERROR', 'a query failure must fail closed as STORE_ERROR');
    },
  },
  {
    id: 'ORDERS-05-PROVIDER-CREATED-AT-AS-A-DATE-OBJECT-IS-HANDLED',
    run: async () => {
      // A real `pg` driver parses timestamptz columns into native Date instances, not strings.
      const store = createCustomerOrdersStore(
        executor([
          {
            order_id: 'ord-5',
            display_order_ref: 'ORD-1005',
            order_status: 'FULFILLED',
            payment_status: 'CAPTURED',
            currency: 'EUR',
            total_amount_minor: '2500',
            completeness_scope: 'UNKNOWN',
            provider_created_at: new Date('2026-09-05T10:00:00.000Z'),
          },
        ]),
      );
      const result = await store.readRecentOrders(customerId, workspaceId);
      assert(
        result.status === 'FOUND' && result.orders[0]!.providerCreatedAt === '2026-09-05T10:00:00.000Z',
        'a real Date-typed provider_created_at column value must map correctly, never be dropped or throw',
      );
    },
  },
  {
    id: 'ORDERS-06-UNRECOGNIZED-COMPLETENESS-SCOPE-FAILS-CLOSED',
    run: async () => {
      const store = createCustomerOrdersStore(
        executor([
          {
            order_id: 'ord-6',
            display_order_ref: 'ORD-1006',
            order_status: 'FULFILLED',
            payment_status: 'CAPTURED',
            currency: 'USD',
            total_amount_minor: '100',
            completeness_scope: 'SOMETHING_UNEXPECTED',
            provider_created_at: '2026-09-06T10:00:00.000Z',
          },
        ]),
      );
      const result = await store.readRecentOrders(customerId, workspaceId);
      assert(
        result.status === 'STORE_ERROR',
        'an unrecognized completeness_scope value must fail closed, never be passed through or silently coerced',
      );
    },
  },
  {
    id: 'ORDERS-07-ZERO-ROWS-FOUND-WITH-EMPTY-ARRAY',
    run: async () => {
      const store = createCustomerOrdersStore(executor([]));
      const result = await store.readRecentOrders(customerId, workspaceId);
      assert(
        result.status === 'FOUND' && result.orders.length === 0,
        'a customer with no orders must be a real empty array, never an error',
      );
    },
  },
  {
    id: 'ORDERS-08-CUSTOM-LIMIT-IS-PASSED-THROUGH-TO-THE-QUERY',
    run: async () => {
      let capturedParams: readonly unknown[] = [];
      const store = createCustomerOrdersStore({
        query: (_sql, params) => {
          capturedParams = params;
          return Promise.resolve({ rows: [] });
        },
      });
      await store.readRecentOrders(customerId, workspaceId, 5);
      assert(capturedParams[2] === 5, 'an explicit limit override must reach the query, not the default');

      let defaultParams: readonly unknown[] = [];
      const defaultStore = createCustomerOrdersStore({
        query: (_sql, params) => {
          defaultParams = params;
          return Promise.resolve({ rows: [] });
        },
      });
      await defaultStore.readRecentOrders(customerId, workspaceId);
      assert(
        defaultParams[2] === CUSTOMER_ORDERS_DEFAULT_LIMIT,
        'omitting the limit must fall back to the documented default, never an unbounded read',
      );
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} customer orders store (adapter) scenarios`);
}

void main();
