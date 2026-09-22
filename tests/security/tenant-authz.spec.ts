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
  type MerchantWorkspaceId,
  type OrganizationId,
} from '../../packages/domain/src';
import { evaluateAuthorization, permission, type ExecutionContext } from '../../packages/authz/src';

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

function baseContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    actorUserId: internalId('user-1', 'User'),
    actorOrganizationId: merchantA,
    actorOrganizationType: 'STANDALONE_MERCHANT',
    membershipId: internalId('membership-1', 'Membership'),
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

const assignment: AgencyClientAssignment = {
  assignmentId: agencyClientAssignmentId('assignment-1'),
  agencyOrganizationId: agency,
  merchantWorkspaceId: workspaceA,
  allowedModules: [moduleKey('commerce')],
  permissionOverrideRefs: [],
  approvalAuthorityRefs: [],
  status: operationalStatus('ACTIVE'),
};

// Scenario table, asserted below. RB-09 final runtime transfer is complete (Brain VERIFIED/PASS);
// the deferred-activation condition this comment originally named has already occurred.
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
      }),
      requiredPermission: permission('commerce.product:read'),
      target: {
        owningOrganizationId: merchantA,
        merchantWorkspaceId: workspaceA,
        resourceType: 'Product',
        resourceId: 'product-a',
      },
      module: 'commerce',
      agencyAssignment: assignment,
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
    }),
    expected: { decision: 'DENY', code: 'AUTH_PERMISSION_DENIED' },
  },
  {
    id: 'TM-MEMBERSHIP-REVOKED-DENY',
    actual: evaluateAuthorization({
      executionContext: baseContext({ membershipStatus: operationalStatus('REVOKED') }),
      requiredPermission: permission('commerce.product:read'),
      target: {
        owningOrganizationId: merchantA,
        merchantWorkspaceId: workspaceA,
        resourceType: 'Product',
        resourceId: 'product-a',
      },
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
      }),
      requiredPermission: permission('commerce.product:read'),
      target: {
        owningOrganizationId: merchantA,
        merchantWorkspaceId: workspaceA,
        resourceType: 'Product',
        resourceId: 'product-a',
      },
      module: 'campaign',
      agencyAssignment: assignment,
    }),
    expected: { decision: 'DENY', code: 'AUTH_PERMISSION_DENIED' },
  },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** expected is a partial-field match against actual (actual may carry extra fields, e.g. DENY.reason / ALLOW.matchedGrantSourceRef) -- never a guessed full-shape equality. */
function matchesExpectedFields(actual: unknown, expected: Readonly<Record<string, unknown>>): boolean {
  if (!isRecord(actual)) return false;
  return Object.entries(expected).every(([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value));
}

let authzSecurityPass = 0;
for (const scenario of AUTHZ_SECURITY_SCENARIOS) {
  if (matchesExpectedFields(scenario.actual, scenario.expected)) authzSecurityPass += 1;
  else throw new Error(`${scenario.id}: expected fields ${JSON.stringify(scenario.expected)} not found in actual ${JSON.stringify(scenario.actual)}`);
}
console.log(`AUTHZ_SECURITY_SCENARIOS ${authzSecurityPass}/${AUTHZ_SECURITY_SCENARIOS.length} PASS`);

// Keep otherwise-unused primitive constructors referenced so staging compile validates their exports.
export const TENANCY_PRIMITIVE_SMOKE = {
  timezone: timezoneId('Europe/Istanbul'),
  onboarding: workspaceOnboardingState('IN_PROGRESS'),
};
