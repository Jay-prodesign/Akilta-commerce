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
  agencyClientAssignmentId,
  internalId,
  localeTag,
  moduleKey,
  operationalStatus,
  utcTimestamp,
  type AgencyClientAssignment,
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

const agencyOrgId: OrganizationId = internalId('cctx-route-agency-a', 'Organization');
const agencyAssignmentId = agencyClientAssignmentId('cctx-route-assignment-1');

function agencyAssignment(allowedModules: readonly string[]): AgencyClientAssignment {
  return {
    assignmentId: agencyAssignmentId,
    agencyOrganizationId: agencyOrgId,
    merchantWorkspaceId: workspaceA,
    allowedModules: allowedModules.map(moduleKey),
    permissionOverrideRefs: [],
    approvalAuthorityRefs: [],
    status: operationalStatus('ACTIVE'),
  };
}

function agencyExecutionContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return baseExecutionContext({
    actorOrganizationId: agencyOrgId,
    actorOrganizationType: 'AGENCY',
    agencyClientAssignmentId: agencyAssignmentId,
    ...overrides,
  });
}

function agencyMembership(): readonly Membership[] {
  return [{ membershipId, userId, organizationId: agencyOrgId, roleRefs: [], status: operationalStatus('ACTIVE') }];
}

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
  {
    id: 'CCTXROUTE-08-AGENCY-WITH-MODULE-RESTRICTION-EXCLUDING-CUSTOMER-DENIES-403-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store = createCustomerContextStore({
        query: () => {
          storeCalled = true;
          return Promise.resolve({ rows: [] });
        },
      });
      const result = await handleCustomerContextRequest(
        baseRequest({
          executionContext: agencyExecutionContext(),
          membershipCandidates: agencyMembership(),
          agencyAssignmentCandidates: [agencyAssignment(['commerce'])],
          store,
        }),
      );
      assert(
        result.httpStatus === 403,
        "an agency whose current AgencyClientAssignment does not include the 'customer' module must be denied, even with a role that grants customer:read",
      );
      assert(!storeCalled, 'the customer context store must never be queried when the agency module allowlist excludes this operation');
    },
  },
  {
    id: 'CCTXROUTE-09-AGENCY-WITH-MODULE-RESTRICTION-EXCLUDING-COMMERCE-OMITS-ORDERS-BUT-STILL-RETURNS-200',
    run: async () => {
      // This is the real, now-exercisable counterpart to what was previously an untestable claim:
      // the *same* CLIENT_SUPPORT_AGENT role grants both customer:read and commerce.order:read, but
      // an agency's module allowlist can independently restrict each operation — here 'customer' is
      // allowed (so the base context read succeeds) while 'commerce' is not (so order history must
      // be omitted), proving the two authorization gates are genuinely independent in practice, not
      // just in the pure decision function.
      const result = await handleCustomerContextRequest(
        baseRequest({
          executionContext: agencyExecutionContext(),
          membershipCandidates: agencyMembership(),
          agencyAssignmentCandidates: [agencyAssignment(['customer'])],
        }),
      );
      assert(result.httpStatus === 200, 'the customer:read-gated base context must still succeed');
      assert(
        result.httpStatus === 200 && !('orders' in result.body),
        "order history must be omitted when the agency's module allowlist excludes 'commerce', even though the role itself grants commerce.order:read",
      );
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} customer context HTTP route scenarios`);
}

void main();
