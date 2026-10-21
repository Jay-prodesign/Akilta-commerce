import {
  handleCustomerContextRequest,
  type CustomerContextHttpRequest,
} from '../../apps/api/src/customer-context-route';
import { createCustomerContextStore, type CustomerContextQueryExecutor } from '../../apps/api/src/customer-context-store';
import { createCustomerOrdersStore, type CustomerOrdersQueryExecutor } from '../../apps/api/src/customer-orders-store';
import {
  permission,
  resolvePermissionAuthoritySnapshot,
  ROLE_PERMISSION_POLICY,
  type ExecutionContext,
  type MembershipRoleReader,
} from '../../packages/authz/src';
import {
  internalId,
  localeTag,
  operationalStatus,
  utcTimestamp,
  type CustomerId,
  type Membership,
  type MerchantWorkspaceId,
  type OrganizationId,
} from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const merchantA: OrganizationId = internalId('cctx-route-org-a', 'Organization');
const workspaceA: MerchantWorkspaceId = internalId('cctx-route-ws-a', 'MerchantWorkspace');
const userId = internalId('cctx-route-user-1', 'User');
const membershipId = internalId('cctx-route-membership-1', 'Membership');
const customerId: CustomerId = internalId('cctx-route-customer-1', 'Customer');

const grantedRoleKey = 'CLIENT_SUPPORT_AGENT';
const currentPermissionAuthority = resolvePermissionAuthoritySnapshot(
  membershipId,
  workspaceA,
  [grantedRoleKey],
  ROLE_PERMISSION_POLICY,
);
if (currentPermissionAuthority.outcome !== 'RESOLVED') {
  throw new Error('fixture misconfigured: expected a resolvable permission authority snapshot');
}
const currentPermissionSnapshotRef = currentPermissionAuthority.snapshot.authorityVersion;

function roleReader(roleKeys: readonly string[] = [grantedRoleKey]): MembershipRoleReader {
  return { read: () => Promise.resolve({ outcome: 'READ_SUCCESS', roleKeys }) };
}

function membership(): readonly Membership[] {
  return [{ membershipId, userId, organizationId: merchantA, roleRefs: [], status: operationalStatus('ACTIVE') }];
}

function baseExecutionContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    actorUserId: userId,
    actorOrganizationId: merchantA,
    actorOrganizationType: 'STANDALONE_MERCHANT',
    membershipId,
    membershipStatus: operationalStatus('ACTIVE'),
    activeMerchantWorkspaceId: workspaceA,
    permissionSnapshotRef: currentPermissionSnapshotRef,
    permissionGrants: [
      {
        permission: permission('customer:read'),
        scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspaceA },
        sourceRef: 'claimed-cache-only',
      },
    ],
    assuranceLevel: 'STANDARD',
    channel: 'web',
    requestId: internalId('cctx-route-request-1', 'Request'),
    runId: internalId('cctx-route-run-1', 'Run'),
    locale: localeTag('tr-TR'),
    occurredAt: utcTimestamp('2026-10-16T12:00:00Z'),
    ...overrides,
  };
}

function fakeExecutor(
  customerRows: readonly Record<string, unknown>[],
  identityRows: readonly Record<string, unknown>[] = [],
): CustomerContextQueryExecutor {
  return {
    query: (sql) => {
      if (sql.startsWith('SELECT customer_id')) return Promise.resolve({ rows: customerRows });
      return Promise.resolve({ rows: identityRows });
    },
  };
}

function fakeOrdersExecutor(rows: readonly Record<string, unknown>[]): CustomerOrdersQueryExecutor {
  return { query: () => Promise.resolve({ rows }) };
}

function baseRequest(overrides: Partial<CustomerContextHttpRequest> = {}): CustomerContextHttpRequest {
  return {
    customerId,
    executionContext: baseExecutionContext(),
    membershipCandidates: membership(),
    agencyAssignmentCandidates: [],
    roleReader: roleReader(),
    store: createCustomerContextStore(fakeExecutor([{ customer_id: customerId, safe_display_name: 'A Customer', status: 'ACTIVE' }])),
    ordersStore: createCustomerOrdersStore(fakeOrdersExecutor([])),
    ...overrides,
  };
}

const cases: ReadonlyArray<{ readonly id: string; readonly run: () => Promise<void> }> = [
  {
    id: 'CCTXROUTE-01-AUTHORIZED-READ-RETURNS-200-WITH-REAL-CUSTOMER-DATA',
    run: async () => {
      const result = await handleCustomerContextRequest(baseRequest());
      assert(result.httpStatus === 200, 'an authorized caller with customer:read must get a 200');
      assert(
        result.httpStatus === 200 &&
          result.body.customerId === customerId &&
          result.body.safeDisplayName === 'A Customer' &&
          Array.isArray(result.body.orders) &&
          result.body.orders.length === 0,
        'the response must carry the real customer id/display name, and orders present (empty) since CLIENT_SUPPORT_AGENT also holds commerce.order:read',
      );
    },
  },
  {
    id: 'CCTXROUTE-02-NO-ACTIVE-WORKSPACE-DENIES-403-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store = createCustomerContextStore({
        query: () => {
          storeCalled = true;
          return Promise.resolve({ rows: [] });
        },
      });
      const result = await handleCustomerContextRequest(
        baseRequest({ executionContext: baseExecutionContext({ activeMerchantWorkspaceId: null }), store }),
      );
      assert(result.httpStatus === 403, 'a caller with no bound active workspace must be denied');
      assert(!storeCalled, 'the customer context store must never be queried before tenancy/authorization is established');
    },
  },
  {
    id: 'CCTXROUTE-03-MISSING-CUSTOMER-READ-PERMISSION-DENIES-403-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store = createCustomerContextStore({
        query: () => {
          storeCalled = true;
          return Promise.resolve({ rows: [] });
        },
      });
      // CLIENT_ANALYST has no customer:read grant in ROLE_PERMISSION_POLICY.
      const result = await handleCustomerContextRequest(baseRequest({ roleReader: roleReader(['CLIENT_ANALYST']), store }));
      assert(result.httpStatus === 403, 'a role lacking customer:read must be denied');
      assert(!storeCalled, 'authorization must fail closed before the customer context store is ever queried');
    },
  },
  {
    id: 'CCTXROUTE-04-NOT-FOUND-RETURNS-404',
    run: async () => {
      const store = createCustomerContextStore(fakeExecutor([]));
      const result = await handleCustomerContextRequest(baseRequest({ store }));
      assert(result.httpStatus === 404, 'a customer absent from this workspace must return 404, not 500 or an empty 200');
    },
  },
  {
    id: 'CCTXROUTE-05-STORE-ERROR-RETURNS-RETRYABLE-500',
    run: async () => {
      const store = createCustomerContextStore({ query: () => Promise.reject(new Error('connection lost')) });
      const result = await handleCustomerContextRequest(baseRequest({ store }));
      assert(
        result.httpStatus === 500 && 'retryable' in result.body && result.body.retryable === true,
        'a real read failure must surface as a retryable 500, never a false 404/200',
      );
    },
  },
  {
    id: 'CCTXROUTE-06-ORDERS-PRESENT-WITH-REAL-SERIALIZED-DATA-WHEN-GRANTED',
    run: async () => {
      const ordersStore = createCustomerOrdersStore(
        fakeOrdersExecutor([
          {
            order_id: 'ord-ctx-1',
            display_order_ref: 'ORD-9001',
            order_status: 'FULFILLED',
            payment_status: 'CAPTURED',
            currency: 'USD',
            total_amount_minor: '12345',
            completeness_scope: 'FULL_HISTORY',
            provider_created_at: '2026-09-10T10:00:00.000Z',
          },
        ]),
      );
      const result = await handleCustomerContextRequest(baseRequest({ ordersStore }));
      assert(result.httpStatus === 200, 'sanity: the read must succeed');
      const order = result.httpStatus === 200 ? result.body.orders?.[0] : undefined;
      assert(
        result.httpStatus === 200 &&
          result.body.orders?.length === 1 &&
          order !== undefined &&
          order.orderId === 'ord-ctx-1' &&
          order.totalAmount?.amountMinor === '12345' &&
          typeof order.totalAmount?.amountMinor === 'string',
        'a real order must appear with its amountMinor serialized as a JSON-safe string, never a raw bigint',
      );
    },
  },
  {
    id: 'CCTXROUTE-07-ORDERS-STORE-ERROR-FAILS-THE-WHOLE-REQUEST-RETRYABLE-500',
    run: async () => {
      const ordersStore = createCustomerOrdersStore({ query: () => Promise.reject(new Error('orders connection lost')) });
      const result = await handleCustomerContextRequest(baseRequest({ ordersStore }));
      assert(
        result.httpStatus === 500 && 'retryable' in result.body && result.body.retryable === true,
        'an orders-store read failure must fail the whole request closed as a retryable 500, never silently omit orders from a 200',
      );
    },
  },
  // Note: a "customer:read granted but commerce.order:read denied" scenario cannot currently be
  // exercised against the real deployed ROLE_PERMISSION_POLICY — CLIENT_SUPPORT_AGENT is the only
  // role holding customer:read, and it holds commerce.order:read too. The DENY branch in
  // readOrdersIfAuthorized exists as defense-in-depth for a future role bundle where that stops
  // being true (see the module doc comment); it is not fabricated RBAC, and is not re-verified here
  // against a policy entry this unit does not own.
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} customer context HTTP route scenarios`);
}

void main();
