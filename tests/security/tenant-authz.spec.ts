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
import { evaluateAuthorization, permission, type ExecutionContext } from '../../packages/authz/src';

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

function baseContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    actorUserId: userId,
    actorOrganizationId: merchantA,
    actorOrganizationType: 'STANDALONE_MERCHANT',
    membershipId,
    membershipStatus: operationalStatus('ACTIVE'),
    activeMerchantWorkspaceId: workspaceA,
    permissionSnapshotRef: 'perm-snapshot-1',
    permissionGrants: [
      {
        permission: permission('commerce.product:read'),
        scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspaceA },
        sourceRef: 'role:client-owner',
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

/** Current membership candidate for a given organization, matching baseContext's default membershipId. */
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

export const AUTHZ_SECURITY_SCENARIOS = [
  {
    id: 'VS-01-VALID-MERCHANT-A-ALLOW',
    actual: evaluateAuthorization({
      executionContext: baseContext(),
      requiredPermission: permission('commerce.product:read'),
      target: {
        owningOrganizationId: merchantA,
        merchantWorkspaceId: workspaceA,
        resourceType: 'Product',
        resourceId: 'product-a',
      },
      membershipCandidates: currentMembership(merchantA),
      agencyAssignmentCandidates: [],
    }),
    expected: { decision: 'ALLOW' },
  },
  {
    id: 'TM-01-STANDALONE-CROSS-TENANT-DENY',
    actual: evaluateAuthorization({
      executionContext: baseContext(),
      requiredPermission: permission('commerce.product:read'),
      target: {
        owningOrganizationId: merchantB,
        merchantWorkspaceId: workspaceB,
        resourceType: 'Product',
        resourceId: 'product-b',
      },
      membershipCandidates: currentMembership(merchantA),
      agencyAssignmentCandidates: [],
    }),
    expected: { decision: 'DENY', code: 'AUTH_TENANT_MISMATCH' },
  },
  {
    id: 'TM-02-AGENCY-WITHOUT-ASSIGNMENT-DENY',
    actual: evaluateAuthorization({
      executionContext: baseContext({
        actorOrganizationId: agency,
        actorOrganizationType: 'AGENCY',
        activeMerchantWorkspaceId: workspaceA,
      }),
      requiredPermission: permission('commerce.product:read'),
      target: {
        owningOrganizationId: merchantA,
        merchantWorkspaceId: workspaceA,
        resourceType: 'Product',
        resourceId: 'product-a',
      },
      module: 'commerce',
      membershipCandidates: currentMembership(agency),
      agencyAssignmentCandidates: [],
    }),
    expected: { decision: 'DENY', code: 'AUTH_TENANT_MISMATCH' },
  },
  {
    id: 'TM-02-AGENCY-ASSIGNMENT-AND-PERMISSION-ALLOW',
    actual: evaluateAuthorization({
      executionContext: baseContext({
        actorOrganizationId: agency,
        actorOrganizationType: 'AGENCY',
        activeMerchantWorkspaceId: workspaceA,
        agencyClientAssignmentId: assignment.assignmentId,
      }),
      requiredPermission: permission('commerce.product:read'),
      target: {
        owningOrganizationId: merchantA,
        merchantWorkspaceId: workspaceA,
        resourceType: 'Product',
        resourceId: 'product-a',
      },
      module: 'commerce',
      membershipCandidates: currentMembership(agency),
      agencyAssignmentCandidates: [assignment],
    }),
    expected: { decision: 'ALLOW' },
  },
  {
    id: 'TM-03-MISSING-PERMISSION-DENY',
    actual: evaluateAuthorization({
      executionContext: baseContext({ permissionGrants: [] }),
      requiredPermission: permission('commerce.order:refund'),
      target: {
        owningOrganizationId: merchantA,
        merchantWorkspaceId: workspaceA,
        resourceType: 'Order',
        resourceId: 'order-a',
      },
      membershipCandidates: currentMembership(merchantA),
      agencyAssignmentCandidates: [],
    }),
    expected: { decision: 'DENY', code: 'AUTH_PERMISSION_DENIED' },
  },
  {
    id: 'TM-07-PLATFORM-INTERNAL-NORMAL-PATH-DENY',
    actual: evaluateAuthorization({
      executionContext: baseContext({
        actorOrganizationType: 'PLATFORM_INTERNAL',
      }),
      requiredPermission: permission('commerce.product:read'),
      target: {
        owningOrganizationId: merchantA,
        merchantWorkspaceId: workspaceA,
        resourceType: 'Product',
        resourceId: 'product-a',
      },
      membershipCandidates: currentMembership(merchantA),
      agencyAssignmentCandidates: [],
    }),
    expected: { decision: 'DENY', code: 'AUTH_PERMISSION_DENIED' },
  },
  {
    id: 'TM-MEMBERSHIP-REVOKED-DENY',
    actual: evaluateAuthorization({
      executionContext: baseContext(),
      requiredPermission: permission('commerce.product:read'),
      target: {
        owningOrganizationId: merchantA,
        merchantWorkspaceId: workspaceA,
        resourceType: 'Product',
        resourceId: 'product-a',
      },
      membershipCandidates: [{ ...currentMembership(merchantA)[0]!, status: operationalStatus('REVOKED') }],
      agencyAssignmentCandidates: [],
    }),
    expected: { decision: 'DENY', code: 'AUTH_PERMISSION_DENIED' },
  },
  {
    id: 'TM-AGENCY-MODULE-RESTRICTION-DENY',
    actual: evaluateAuthorization({
      executionContext: baseContext({
        actorOrganizationId: agency,
        actorOrganizationType: 'AGENCY',
        activeMerchantWorkspaceId: workspaceA,
        agencyClientAssignmentId: assignment.assignmentId,
      }),
      requiredPermission: permission('commerce.product:read'),
      target: {
        owningOrganizationId: merchantA,
        merchantWorkspaceId: workspaceA,
        resourceType: 'Product',
        resourceId: 'product-a',
      },
      module: 'campaign',
      membershipCandidates: currentMembership(agency),
      agencyAssignmentCandidates: [assignment],
    }),
    expected: { decision: 'DENY', code: 'AUTH_PERMISSION_DENIED' },
  },
] as const;

for (const scenario of AUTHZ_SECURITY_SCENARIOS) {
  assert(scenario.actual.decision === scenario.expected.decision, `${scenario.id}: expected decision ${scenario.expected.decision}, got ${scenario.actual.decision}`);
  if (scenario.expected.decision === 'DENY' && scenario.actual.decision === 'DENY') {
    assert(scenario.actual.code === scenario.expected.code, `${scenario.id}: expected code ${scenario.expected.code}, got ${scenario.actual.code}`);
  }
  console.log(`PASS ${scenario.id}`);
}
console.log(`PASS ${AUTHZ_SECURITY_SCENARIOS.length}/${AUTHZ_SECURITY_SCENARIOS.length} tenant authz scenarios`);

// Keep otherwise-unused primitive constructors referenced so staging compile validates their exports.
export const TENANCY_PRIMITIVE_SMOKE = {
  timezone: timezoneId('Europe/Istanbul'),
  onboarding: workspaceOnboardingState('IN_PROGRESS'),
};
