import {
  handleCustomerIdentityLinkRequest,
  type CustomerIdentityLinkHttpRequest,
} from '../../apps/api/src/customer-identity-link-route';
import {
  createCustomerIdentityLinkStore,
  type CustomerIdentityLinkQueryExecutor,
} from '../../apps/api/src/customer-identity-link-store';
import {
  permission,
  resolvePermissionAuthoritySnapshot,
  ROLE_PERMISSION_POLICY,
  type ExecutionContext,
  type MembershipRoleReader,
} from '../../packages/authz/src';
import {
  customerIdentityLinkIdempotencyKey,
  type CustomerIdentityLinkIdempotencyKey,
  type CustomerIdentityLinkRecord,
} from '../../packages/authz/src/customer-identity-link-transition';
import {
  agencyClientAssignmentId,
  internalId,
  localeTag,
  moduleKey,
  operationalStatus,
  utcTimestamp,
  type AgencyClientAssignment,
  type CustomerIdentityId,
  type Membership,
  type MerchantWorkspaceId,
  type OrganizationId,
} from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const merchantA: OrganizationId = internalId('xcid-route-org-a', 'Organization');
const workspaceA: MerchantWorkspaceId = internalId('xcid-route-ws-a', 'MerchantWorkspace');
const userId = internalId('xcid-route-user-1', 'User');
const membershipId = internalId('xcid-route-membership-1', 'Membership');
const customerIdentityId: CustomerIdentityId = internalId('xcid-route-identity-1', 'CustomerIdentity');
const key: CustomerIdentityLinkIdempotencyKey = customerIdentityLinkIdempotencyKey('xcid-route-idem-1');

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

const agencyOrgId: OrganizationId = internalId('xcid-route-agency-a', 'Organization');
const agencyAssignmentId = agencyClientAssignmentId('xcid-route-assignment-1');

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
        permission: permission('conversation:respond'),
        scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspaceA },
        sourceRef: 'claimed-cache-only',
      },
    ],
    assuranceLevel: 'STANDARD',
    channel: 'web',
    requestId: internalId('xcid-route-request-1', 'Request'),
    runId: internalId('xcid-route-run-1', 'Run'),
    locale: localeTag('tr-TR'),
    occurredAt: utcTimestamp('2026-10-21T12:00:00Z'),
    ...overrides,
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

function unlinkedExecutor(): CustomerIdentityLinkQueryExecutor {
  return {
    query: (sql) => {
      if (sql.startsWith('SELECT')) return Promise.resolve({ rows: [{ customer_id: null, link_generation: 0 }] });
      if (sql.includes('INSERT INTO customer_identity_link_events')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [{ customer_id: 'cust-1', link_generation: 1 }] });
    },
  };
}

function emptyAppliedKeys(): ReadonlyMap<CustomerIdentityLinkIdempotencyKey, CustomerIdentityLinkRecord> {
  return new Map();
}

function baseRequest(overrides: Partial<CustomerIdentityLinkHttpRequest> = {}): CustomerIdentityLinkHttpRequest {
  return {
    customerIdentityId,
    operation: 'LINK',
    targetCustomerId: 'cust-1',
    expectedGeneration: 0,
    idempotencyKey: key,
    actorRef: 'system:test-actor',
    executionContext: baseExecutionContext(),
    membershipCandidates: membership(),
    agencyAssignmentCandidates: [],
    roleReader: roleReader(),
    store: createCustomerIdentityLinkStore(unlinkedExecutor()),
    appliedIdempotencyKeys: emptyAppliedKeys(),
    ...overrides,
  };
}

const cases: ReadonlyArray<{ readonly id: string; readonly run: () => Promise<void> }> = [
  {
    id: 'XCIDROUTE-01-AUTHORIZED-LINK-APPLIES-AND-RETURNS-200',
    run: async () => {
      const result = await handleCustomerIdentityLinkRequest(baseRequest());
      assert(result.httpStatus === 200, 'an authorized caller with conversation:respond must get a 200');
      assert(
        result.httpStatus === 200 && result.body.customerId === 'cust-1' && result.body.generation === 1 && !result.body.replay,
        'a successful LINK must report the real resulting customer id/generation and replay:false',
      );
    },
  },
  {
    id: 'XCIDROUTE-02-NO-ACTIVE-WORKSPACE-DENIES-403-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store = createCustomerIdentityLinkStore({
        query: () => {
          storeCalled = true;
          return Promise.resolve({ rows: [] });
        },
      });
      const result = await handleCustomerIdentityLinkRequest(
        baseRequest({ executionContext: baseExecutionContext({ activeMerchantWorkspaceId: null }), store }),
      );
      assert(result.httpStatus === 403, 'a caller with no bound active workspace must be denied');
      assert(!storeCalled, 'the store must never be queried before tenancy/authorization is established');
    },
  },
  {
    id: 'XCIDROUTE-03-MISSING-PERMISSION-DENIES-403-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store = createCustomerIdentityLinkStore({
        query: () => {
          storeCalled = true;
          return Promise.resolve({ rows: [] });
        },
      });
      const result = await handleCustomerIdentityLinkRequest(baseRequest({ roleReader: roleReader(['CLIENT_ANALYST']), store }));
      assert(result.httpStatus === 403, 'a role lacking conversation:respond must be denied');
      assert(!storeCalled, 'authorization must fail closed before the link store is ever queried');
    },
  },
  {
    id: 'XCIDROUTE-04-NO-EXISTING-IDENTITY-RETURNS-404',
    run: async () => {
      const store = createCustomerIdentityLinkStore({ query: () => Promise.resolve({ rows: [] }) });
      const result = await handleCustomerIdentityLinkRequest(baseRequest({ store }));
      assert(result.httpStatus === 404, 'linking an identity that does not exist in this workspace must be a 404, never a fabricated success');
    },
  },
  {
    id: 'XCIDROUTE-05-STALE-EXPECTED-GENERATION-RETURNS-409-LINK-CONFLICT',
    run: async () => {
      const store = createCustomerIdentityLinkStore({
        query: (sql) => (sql.startsWith('SELECT') ? Promise.resolve({ rows: [{ customer_id: null, link_generation: 5 }] }) : Promise.resolve({ rows: [] })),
      });
      const result = await handleCustomerIdentityLinkRequest(baseRequest({ store, expectedGeneration: 0 }));
      assert(
        result.httpStatus === 409 && 'code' in result.body && result.body.code === 'LINK_CONFLICT',
        'a stale expected generation must surface as a 409 LINK_CONFLICT, never a silent overwrite',
      );
    },
  },
  {
    id: 'XCIDROUTE-06-ALREADY-LINKED-RETURNS-409-INVALID-OPERATION',
    run: async () => {
      const store = createCustomerIdentityLinkStore({
        query: (sql) =>
          sql.startsWith('SELECT') ? Promise.resolve({ rows: [{ customer_id: 'cust-existing', link_generation: 0 }] }) : Promise.resolve({ rows: [] }),
      });
      const result = await handleCustomerIdentityLinkRequest(baseRequest({ store }));
      assert(
        result.httpStatus === 409 && 'code' in result.body && result.body.code === 'INVALID_OPERATION' && result.body.reason === 'ALREADY_LINKED',
        'LINK against an already-linked identity must surface the exact ALREADY_LINKED reason, directing the caller to RELINK',
      );
    },
  },
  {
    id: 'XCIDROUTE-07-STORE-ERROR-RETURNS-RETRYABLE-500',
    run: async () => {
      const store = createCustomerIdentityLinkStore({ query: () => Promise.reject(new Error('connection lost')) });
      const result = await handleCustomerIdentityLinkRequest(baseRequest({ store }));
      assert(
        result.httpStatus === 500 && 'retryable' in result.body && result.body.retryable === true,
        'a real failure must surface as a retryable 500, never a false 200/404',
      );
    },
  },
  {
    id: 'XCIDROUTE-08-REPLAYED-IDEMPOTENCY-KEY-RETURNS-200-WITH-REPLAY-TRUE-NEVER-REACHES-WRITE',
    run: async () => {
      let writeAttempted = false;
      const store = createCustomerIdentityLinkStore({
        query: (sql) => {
          if (sql.startsWith('SELECT')) return Promise.resolve({ rows: [{ customer_id: 'cust-drifted', link_generation: 9 }] });
          writeAttempted = true;
          return Promise.resolve({ rows: [] });
        },
      });
      const priorRecord: CustomerIdentityLinkRecord = {
        ownerCustomerIdentityId: customerIdentityId,
        ownerMerchantWorkspaceId: workspaceA,
        customerId: internalId('cust-prior', 'Customer'),
        generation: 1,
      };
      const result = await handleCustomerIdentityLinkRequest(
        baseRequest({ store, appliedIdempotencyKeys: new Map([[key, priorRecord]]) }),
      );
      assert(result.httpStatus === 200, 'a replayed idempotency key must still return 200');
      assert(
        result.httpStatus === 200 && result.body.replay === true && result.body.customerId === 'cust-prior',
        'a replay must surface the prior real outcome, flagged as a replay',
      );
      assert(!writeAttempted, 'a replayed idempotency key must never reach a database write');
    },
  },
  {
    id: 'XCIDROUTE-09-AGENCY-WITH-MODULE-RESTRICTION-EXCLUDING-CONVERSATION-DENIES-403-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store = createCustomerIdentityLinkStore({
        query: () => {
          storeCalled = true;
          return Promise.resolve({ rows: [] });
        },
      });
      const result = await handleCustomerIdentityLinkRequest(
        baseRequest({
          executionContext: agencyExecutionContext(),
          membershipCandidates: agencyMembership(),
          agencyAssignmentCandidates: [agencyAssignment(['commerce'])],
          store,
        }),
      );
      assert(
        result.httpStatus === 403,
        "an agency whose current AgencyClientAssignment does not include the 'conversation' module must be denied, even with a role that grants conversation:respond",
      );
      assert(!storeCalled, 'the link store must never be queried when the agency module allowlist excludes this operation');
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} customer identity link HTTP route scenarios`);
}

void main();
