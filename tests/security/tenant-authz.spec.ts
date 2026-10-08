import {
  agencyClientAssignmentId,
  internalId,
  localeTag,
  moduleKey,
  operationalStatus,
  timezoneId,
  utcTimestamp,
  workspaceOnboardingState,
  type AgencyClientAssignment,
  type Membership,
  type MerchantWorkspaceId,
  type OrganizationId,
} from '../../packages/domain/src';
import {
  evaluateAuthorization,
  permission,
  resolvePermissionAuthoritySnapshot,
  ROLE_PERMISSION_POLICY,
  type AuthorizationDecision,
  type ExecutionContext,
  type MembershipRoleReadResult,
  type MembershipRoleReader,
} from '../../packages/authz/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function oid(value: string): OrganizationId {
  return internalId(value, 'Organization');
}

function wid(value: string): MerchantWorkspaceId {
  return internalId(value, 'MerchantWorkspace');
}

const merchantA = oid('org-merchant-a');
const merchantB = oid('org-merchant-b');
const agency = oid('org-agency');
const workspaceA = wid('ws-a');
const workspaceB = wid('ws-b');
const userId = internalId('user-1', 'User');
const membershipId = internalId('membership-1', 'Membership');
/** Directly-evidenced V1 role covering conversation:respond. */
const grantedRoleKey = 'CLIENT_SUPPORT_AGENT';
const grantedPermission = permission('conversation:respond');
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

function fakeReader(result: MembershipRoleReadResult): MembershipRoleReader {
  return { read: () => Promise.resolve(result) };
}

function defaultRoleReader(): MembershipRoleReader {
  return fakeReader({ outcome: 'READ_SUCCESS', roleKeys: [grantedRoleKey] });
}

function baseContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    actorUserId: userId,
    actorOrganizationId: merchantA,
    actorOrganizationType: 'STANDALONE_MERCHANT',
    membershipId,
    membershipStatus: operationalStatus('ACTIVE'),
    activeMerchantWorkspaceId: workspaceA,
    permissionSnapshotRef: currentPermissionSnapshotRef,
    // Claim/cache correlation only — never trusted for the grant decision.
    permissionGrants: [
      {
        permission: grantedPermission,
        scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspaceA },
        sourceRef: 'claimed-cache-only',
      },
    ],
    assuranceLevel: 'STANDARD',
    channel: 'web',
    requestId: internalId('request-1', 'Request'),
    runId: internalId('run-1', 'Run'),
    locale: localeTag('tr-TR'),
    occurredAt: utcTimestamp('2026-08-07T18:00:00Z'),
    ...overrides,
  };
}

/**
 * Current membership candidate for a given organization, matching baseContext's default
 * membershipId. roleRefs is no longer the permission-authority source (an authoritative
 * MembershipRoleReader is), so it stays empty.
 */
function currentMembership(organizationId: OrganizationId): readonly Membership[] {
  return [
    {
      membershipId,
      userId,
      organizationId,
      roleRefs: [],
      status: operationalStatus('ACTIVE'),
    },
  ];
}

const assignment: AgencyClientAssignment = {
  assignmentId: agencyClientAssignmentId('assignment-1'),
  agencyOrganizationId: agency,
  merchantWorkspaceId: workspaceA,
  allowedModules: [moduleKey('commerce')],
  permissionOverrideRefs: [],
  approvalAuthorityRefs: [],
  status: operationalStatus('ACTIVE'),
};

const scenarios: ReadonlyArray<{
  readonly id: string;
  readonly run: () => Promise<AuthorizationDecision>;
  readonly expected: { readonly decision: 'ALLOW' } | { readonly decision: 'DENY'; readonly code: string };
}> = [
  {
    id: 'VS-01-VALID-MERCHANT-A-ALLOW',
    run: () =>
      evaluateAuthorization({
        executionContext: baseContext(),
        requiredPermission: grantedPermission,
        target: {
          owningOrganizationId: merchantA,
          merchantWorkspaceId: workspaceA,
          resourceType: 'Product',
          resourceId: 'product-a',
        },
        membershipCandidates: currentMembership(merchantA),
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      }),
    expected: { decision: 'ALLOW' },
  },
  {
    id: 'TM-01-STANDALONE-CROSS-TENANT-DENY',
    run: () =>
      evaluateAuthorization({
        executionContext: baseContext(),
        requiredPermission: grantedPermission,
        target: {
          owningOrganizationId: merchantB,
          merchantWorkspaceId: workspaceB,
          resourceType: 'Product',
          resourceId: 'product-b',
        },
        membershipCandidates: currentMembership(merchantA),
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      }),
    expected: { decision: 'DENY', code: 'AUTH_TENANT_MISMATCH' },
  },
  {
    id: 'TM-02-AGENCY-WITHOUT-ASSIGNMENT-DENY',
    run: () =>
      evaluateAuthorization({
        executionContext: baseContext({
          actorOrganizationId: agency,
          actorOrganizationType: 'AGENCY',
          activeMerchantWorkspaceId: workspaceA,
        }),
        requiredPermission: grantedPermission,
        target: {
          owningOrganizationId: merchantA,
          merchantWorkspaceId: workspaceA,
          resourceType: 'Product',
          resourceId: 'product-a',
        },
        module: 'commerce',
        membershipCandidates: currentMembership(agency),
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      }),
    expected: { decision: 'DENY', code: 'AUTH_TENANT_MISMATCH' },
  },
  {
    id: 'TM-02-AGENCY-ASSIGNMENT-AND-PERMISSION-ALLOW',
    run: () =>
      evaluateAuthorization({
        executionContext: baseContext({
          actorOrganizationId: agency,
          actorOrganizationType: 'AGENCY',
          activeMerchantWorkspaceId: workspaceA,
          agencyClientAssignmentId: assignment.assignmentId,
        }),
        requiredPermission: grantedPermission,
        target: {
          owningOrganizationId: merchantA,
          merchantWorkspaceId: workspaceA,
          resourceType: 'Product',
          resourceId: 'product-a',
        },
        module: 'commerce',
        membershipCandidates: currentMembership(agency),
        agencyAssignmentCandidates: [assignment],
        roleReader: defaultRoleReader(),
      }),
    expected: { decision: 'ALLOW' },
  },
  {
    id: 'TM-03-MISSING-PERMISSION-DENY',
    run: () =>
      evaluateAuthorization({
        executionContext: baseContext(),
        // commerce.order:refund is outside the conservative V1 role catalog entirely.
        requiredPermission: permission('commerce.order:refund'),
        target: {
          owningOrganizationId: merchantA,
          merchantWorkspaceId: workspaceA,
          resourceType: 'Order',
          resourceId: 'order-a',
        },
        membershipCandidates: currentMembership(merchantA),
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      }),
    expected: { decision: 'DENY', code: 'AUTH_PERMISSION_DENIED' },
  },
  {
    id: 'TM-07-PLATFORM-INTERNAL-NORMAL-PATH-DENY',
    run: () =>
      evaluateAuthorization({
        executionContext: baseContext({
          actorOrganizationType: 'PLATFORM_INTERNAL',
        }),
        requiredPermission: grantedPermission,
        target: {
          owningOrganizationId: merchantA,
          merchantWorkspaceId: workspaceA,
          resourceType: 'Product',
          resourceId: 'product-a',
        },
        membershipCandidates: currentMembership(merchantA),
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      }),
    expected: { decision: 'DENY', code: 'AUTH_PERMISSION_DENIED' },
  },
  {
    id: 'TM-MEMBERSHIP-REVOKED-DENY',
    run: () =>
      evaluateAuthorization({
        executionContext: baseContext(),
        requiredPermission: grantedPermission,
        target: {
          owningOrganizationId: merchantA,
          merchantWorkspaceId: workspaceA,
          resourceType: 'Product',
          resourceId: 'product-a',
        },
        membershipCandidates: [{ ...currentMembership(merchantA)[0]!, status: operationalStatus('REVOKED') }],
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      }),
    expected: { decision: 'DENY', code: 'AUTH_PERMISSION_DENIED' },
  },
  {
    id: 'TM-AGENCY-MODULE-RESTRICTION-DENY',
    run: () =>
      evaluateAuthorization({
        executionContext: baseContext({
          actorOrganizationId: agency,
          actorOrganizationType: 'AGENCY',
          activeMerchantWorkspaceId: workspaceA,
          agencyClientAssignmentId: assignment.assignmentId,
        }),
        requiredPermission: grantedPermission,
        target: {
          owningOrganizationId: merchantA,
          merchantWorkspaceId: workspaceA,
          resourceType: 'Product',
          resourceId: 'product-a',
        },
        module: 'campaign',
        membershipCandidates: currentMembership(agency),
        agencyAssignmentCandidates: [assignment],
        roleReader: defaultRoleReader(),
      }),
    expected: { decision: 'DENY', code: 'AUTH_PERMISSION_DENIED' },
  },
];

async function main() {
  for (const scenario of scenarios) {
    const actual = await scenario.run();
    assert(actual.decision === scenario.expected.decision, `${scenario.id}: expected decision ${scenario.expected.decision}, got ${actual.decision}`);
    if (scenario.expected.decision === 'DENY' && actual.decision === 'DENY') {
      assert(actual.code === scenario.expected.code, `${scenario.id}: expected code ${scenario.expected.code}, got ${actual.code}`);
    }
    console.log(`PASS ${scenario.id}`);
  }
  console.log(`PASS ${scenarios.length}/${scenarios.length} tenant authz scenarios`);
}

void main();

// Keep otherwise-unused primitive constructors referenced so staging compile validates their exports.
export const TENANCY_PRIMITIVE_SMOKE = {
  timezone: timezoneId('Europe/Istanbul'),
  onboarding: workspaceOnboardingState('IN_PROGRESS'),
};
