import {
  handleUsageSummaryRequest,
  type UsageSummaryHttpRequest,
} from '../../apps/api/src/usage-summary-route';
import { createUsageSummaryStore, type UsageSummaryQueryExecutor } from '../../apps/api/src/usage-summary-store';
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
  type Membership,
  type MerchantWorkspaceId,
  type OrganizationId,
} from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const merchantA: OrganizationId = internalId('usage-route-org-a', 'Organization');
const workspaceA: MerchantWorkspaceId = internalId('usage-route-ws-a', 'MerchantWorkspace');
const userId = internalId('usage-route-user-1', 'User');
const membershipId = internalId('usage-route-membership-1', 'Membership');

const grantedRoleKey = 'CLIENT_ANALYST';
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

const agencyOrgId: OrganizationId = internalId('usage-route-agency-a', 'Organization');
const agencyAssignmentId = agencyClientAssignmentId('usage-route-assignment-1');
const agencyPermissionAuthority = resolvePermissionAuthoritySnapshot(
  membershipId,
  workspaceA,
  ['AGENCY_ANALYST'],
  ROLE_PERMISSION_POLICY,
);
if (agencyPermissionAuthority.outcome !== 'RESOLVED') {
  throw new Error('fixture misconfigured: expected a resolvable AGENCY_ANALYST permission authority snapshot');
}
const agencyPermissionSnapshotRef = agencyPermissionAuthority.snapshot.authorityVersion;

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
        permission: permission('analytics:read'),
        scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspaceA },
        sourceRef: 'claimed-cache-only',
      },
    ],
    assuranceLevel: 'STANDARD',
    channel: 'web',
    requestId: internalId('usage-route-request-1', 'Request'),
    runId: internalId('usage-route-run-1', 'Run'),
    locale: localeTag('tr-TR'),
    occurredAt: utcTimestamp('2026-10-16T12:00:00Z'),
    ...overrides,
  };
}

function emptyExecutor(): UsageSummaryQueryExecutor {
  return { query: () => Promise.resolve({ rows: [] }) };
}

function baseRequest(overrides: Partial<UsageSummaryHttpRequest> = {}): UsageSummaryHttpRequest {
  return {
    executionContext: baseExecutionContext(),
    membershipCandidates: membership(),
    agencyAssignmentCandidates: [],
    roleReader: roleReader(),
    store: createUsageSummaryStore(emptyExecutor()),
    now: new Date('2026-10-16T12:00:00Z'),
    ...overrides,
  };
}

const cases: ReadonlyArray<{ readonly id: string; readonly run: () => Promise<void> }> = [
  {
    id: 'USAGEROUTE-01-AUTHORIZED-READ-RETURNS-200-WITH-A-REAL-SUMMARY',
    run: async () => {
      const result = await handleUsageSummaryRequest(baseRequest());
      assert(result.httpStatus === 200, 'an authorized caller with analytics:read must get a 200');
      assert(
        result.httpStatus === 200 && result.body.merchantWorkspaceId === workspaceA,
        "the summary must be scoped to the caller's own active workspace",
      );
      assert(
        result.httpStatus === 200 && result.body.totalEventCount === 0,
        'an empty store must report a real zero, not an absent field',
      );
    },
  },
  {
    id: 'USAGEROUTE-02-NO-ACTIVE-WORKSPACE-DENIES-403-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store = createUsageSummaryStore({
        query: () => {
          storeCalled = true;
          return Promise.resolve({ rows: [] });
        },
      });
      const result = await handleUsageSummaryRequest(
        baseRequest({ executionContext: baseExecutionContext({ activeMerchantWorkspaceId: null }), store }),
      );
      assert(result.httpStatus === 403, 'a caller with no bound active workspace must be denied');
      assert(!storeCalled, 'the usage store must never be queried before tenancy/authorization is established');
    },
  },
  {
    id: 'USAGEROUTE-03-MISSING-ANALYTICS-READ-PERMISSION-DENIES-403-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store = createUsageSummaryStore({
        query: () => {
          storeCalled = true;
          return Promise.resolve({ rows: [] });
        },
      });
      // CLIENT_SUPPORT_AGENT has no analytics:read grant in ROLE_PERMISSION_POLICY.
      const result = await handleUsageSummaryRequest(baseRequest({ roleReader: roleReader(['CLIENT_SUPPORT_AGENT']), store }));
      assert(result.httpStatus === 403, 'a role lacking analytics:read must be denied');
      assert(!storeCalled, 'authorization must fail closed before the usage store is ever queried');
    },
  },
  {
    id: 'USAGEROUTE-04-STORE-ERROR-RETURNS-A-RETRYABLE-500',
    run: async () => {
      const store = createUsageSummaryStore({ query: () => Promise.reject(new Error('connection lost')) });
      const result = await handleUsageSummaryRequest(baseRequest({ store }));
      assert(
        result.httpStatus === 500 && 'retryable' in result.body && result.body.retryable === true,
        'a real read failure must surface as a retryable 500, never a false empty 200',
      );
    },
  },
  {
    id: 'USAGEROUTE-05-RANGE-IS-SERVER-COMPUTED-AS-THE-TRAILING-30-DAYS-FROM-NOW',
    run: async () => {
      let capturedParams: readonly unknown[] | undefined;
      const store = createUsageSummaryStore({
        query: (_sql, params) => {
          capturedParams = params;
          return Promise.resolve({ rows: [] });
        },
      });
      const now = new Date('2026-10-16T12:00:00Z');
      await handleUsageSummaryRequest(baseRequest({ store, now }));
      assert(capturedParams !== undefined, 'the store must have been queried');
      const [, rangeStart, rangeEnd] = capturedParams;
      assert(rangeEnd === now.toISOString(), 'rangeEnd must be exactly the server-computed "now", never client-influenced');
      const expectedStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      assert(rangeStart === expectedStart, 'rangeStart must be exactly 30 days before "now"');
    },
  },
  {
    id: 'USAGEROUTE-06-AGENCY-WITH-MODULE-RESTRICTION-EXCLUDING-ANALYTICS-DENIES-403-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store = createUsageSummaryStore({
        query: () => {
          storeCalled = true;
          return Promise.resolve({ rows: [] });
        },
      });
      const assignment = agencyAssignment(['campaign']);
      const result = await handleUsageSummaryRequest(
        baseRequest({
          executionContext: baseExecutionContext({
            actorOrganizationId: agencyOrgId,
            actorOrganizationType: 'AGENCY',
            agencyClientAssignmentId: agencyAssignmentId,
            permissionSnapshotRef: agencyPermissionSnapshotRef,
          }),
          membershipCandidates: [
            { membershipId, userId, organizationId: agencyOrgId, roleRefs: [], status: operationalStatus('ACTIVE') },
          ],
          agencyAssignmentCandidates: [assignment],
          roleReader: roleReader(['AGENCY_ANALYST']),
          store,
        }),
      );
      assert(
        result.httpStatus === 403,
        "an agency whose current AgencyClientAssignment does not include the 'analytics' module must be denied even though AGENCY_ANALYST grants analytics:read",
      );
      assert(!storeCalled, 'the usage store must never be queried when the agency module allowlist excludes this operation');
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} usage summary HTTP route scenarios`);
}

void main();
