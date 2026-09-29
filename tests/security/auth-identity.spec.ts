import {
  authProviderKey,
  evaluateAuthorization,
  externalAuthOrganizationRef,
  externalAuthSubjectRef,
  externalSessionRef,
  permission,
  resolveAuthenticatedPrincipal,
  resolveAuthOrganizationBinding,
  resolvePermissionAuthoritySnapshot,
  ROLE_PERMISSION_POLICY,
  type AuthOrganizationBinding,
  type ExecutionContext,
  type MembershipRoleReadResult,
  type MembershipRoleReader,
  type UserIdentity,
} from '../../packages/authz/src';
import {
  agencyClientAssignmentId,
  internalId,
  localeTag,
  moduleKey,
  operationalStatus,
  resolveCurrentAgencyAssignment,
  resolveCurrentMembership,
  utcTimestamp,
  type AgencyClientAssignment,
  type Membership,
  type MerchantWorkspaceId,
  type OrganizationId,
} from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const provider = authProviderKey('auth-test');
const merchantOrg = internalId('org-a', 'Organization');
const otherOrg = internalId('org-b', 'Organization');
const agencyOrg = internalId('org-agency', 'Organization');
const workspaceA = internalId('ws-a', 'MerchantWorkspace');
const workspaceB = internalId('ws-b', 'MerchantWorkspace');
const userId = internalId('user-1', 'User');
const identityId = internalId('uid-1', 'UserIdentity');
const subject = externalAuthSubjectRef('subject-1');
const now = utcTimestamp('2026-08-07T18:00:00Z');

const identity: UserIdentity = {
  userIdentityId: identityId,
  userId,
  authProvider: provider,
  externalSubjectRef: subject,
  status: operationalStatus('ACTIVE'),
  verifiedAt: now,
  createdAt: now,
};

/** Directly-evidenced V1 role covering conversation:respond, used as the default granted role. */
const grantedRoleKey = 'CLIENT_SUPPORT_AGENT';
const grantedPermission = permission('conversation:respond');
const membership1Id = internalId('membership-1', 'Membership');
const currentPermissionAuthority = resolvePermissionAuthoritySnapshot(
  membership1Id,
  workspaceA,
  [grantedRoleKey],
  ROLE_PERMISSION_POLICY,
);
if (currentPermissionAuthority.outcome !== 'RESOLVED') {
  throw new Error('fixture misconfigured: expected a resolvable permission authority snapshot');
}
/** The current permissionSnapshotRef matching membership-1's authoritative role read at workspaceA. */
const currentPermissionSnapshotRef = currentPermissionAuthority.snapshot.authorityVersion;

/** The current permissionSnapshotRef matching a successful authoritative read of zero roles. */
const zeroRolesPermissionSnapshotRef = (() => {
  const resolution = resolvePermissionAuthoritySnapshot(membership1Id, workspaceA, [], ROLE_PERMISSION_POLICY);
  if (resolution.outcome !== 'RESOLVED') {
    throw new Error('fixture misconfigured: expected zero roles to resolve');
  }
  return resolution.snapshot.authorityVersion;
})();

function fakeReader(result: MembershipRoleReadResult): MembershipRoleReader {
  return { read: () => Promise.resolve(result) };
}

/** The default authoritative role reader: membership-1 currently holds CLIENT_SUPPORT_AGENT. */
function defaultRoleReader(): MembershipRoleReader {
  return fakeReader({ outcome: 'READ_SUCCESS', roleKeys: [grantedRoleKey] });
}

function verifiedAttempt(overrides: Record<string, unknown> = {}) {
  return {
    outcome: 'VERIFIED' as const,
    proof: {
      authProvider: provider,
      externalSubjectRef: subject,
      externalSessionRef: externalSessionRef('session-1'),
      assuranceLevel: 'STANDARD' as const,
      status: 'ACTIVE' as const,
      issuedAt: utcTimestamp('2026-08-07T17:00:00Z'),
      verifiedAt: now,
      expiresAt: utcTimestamp('2026-08-07T19:00:00Z'),
      ...overrides,
    },
  };
}

function baseContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    actorUserId: userId,
    actorOrganizationId: merchantOrg,
    actorOrganizationType: 'STANDALONE_MERCHANT',
    membershipId: internalId('membership-1', 'Membership'),
    membershipStatus: operationalStatus('ACTIVE'),
    activeMerchantWorkspaceId: workspaceA,
    permissionSnapshotRef: currentPermissionSnapshotRef,
    // Claim/cache correlation only — never trusted for the grant decision. Deliberately not kept
    // in sync with the authoritative role reader below, to prove it cannot widen or substitute.
    permissionGrants: [
      {
        permission: grantedPermission,
        scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspaceA },
        sourceRef: 'claimed-cache-only',
      },
    ],
    assuranceLevel: 'STANDARD',
    channel: 'web',
    requestId: internalId('req-1', 'Request'),
    runId: internalId('run-1', 'Run'),
    locale: localeTag('tr-TR'),
    occurredAt: now,
    ...overrides,
  };
}

const orgBinding: AuthOrganizationBinding = {
  authProvider: provider,
  externalOrganizationRef: externalAuthOrganizationRef('external-org-a'),
  internalOrganizationId: merchantOrg,
  status: operationalStatus('ACTIVE'),
  verifiedAt: now,
  sourceRef: 'auth-binding:1',
};

const agencyAssignment: AgencyClientAssignment = {
  assignmentId: agencyClientAssignmentId('assignment-1'),
  agencyOrganizationId: agencyOrg,
  merchantWorkspaceId: workspaceA,
  allowedModules: [moduleKey('commerce')],
  permissionOverrideRefs: [],
  approvalAuthorityRefs: [],
  status: operationalStatus('ACTIVE'),
};

/**
 * roleRefs is no longer the permission-authority source (an authoritative MembershipRoleReader is)
 * so it is always empty here — legacy permission-literal roleRefs must not be preserved as product
 * semantics.
 */
function membershipCandidate(id: string, overrides: Partial<Membership> = {}): Membership {
  return {
    membershipId: internalId(id, 'Membership'),
    userId,
    organizationId: merchantOrg,
    roleRefs: [],
    status: operationalStatus('ACTIVE'),
    ...overrides,
  };
}

function assignmentCandidate(id: string, overrides: Partial<AgencyClientAssignment> = {}): AgencyClientAssignment {
  return {
    assignmentId: agencyClientAssignmentId(id),
    agencyOrganizationId: agencyOrg,
    merchantWorkspaceId: workspaceA,
    allowedModules: [],
    permissionOverrideRefs: [],
    approvalAuthorityRefs: [],
    status: operationalStatus('ACTIVE'),
    ...overrides,
  };
}

/** Dependency-free exact permutation witness; used to prove resolver outcomes are order-independent. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) {
    return [items.slice()];
  }
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const current = items[i];
    if (current === undefined) continue;
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const rest_permutation of permutations(rest)) {
      result.push([current, ...rest_permutation]);
    }
  }
  return result;
}

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i += 1) {
    result *= i;
  }
  return result;
}

function assertExactIdSet<T>(actual: readonly T[], expected: ReadonlySet<T>, message: string): void {
  assert(actual.length === expected.size, message);
  const actualSet = new Set(actual);
  assert(actualSet.size === expected.size, message);
  for (const id of actualSet) {
    assert(expected.has(id), message);
  }
}

const cases: Array<{ id: string; run: () => void | Promise<void> }> = [
  {
    id: 'AUTH-VERIFIED-PRINCIPAL-HAS-NO-WORKSPACE-AUTHORITY',
    run: () => {
      const result = resolveAuthenticatedPrincipal(verifiedAttempt(), [identity], now);
      assert(result.status === 'AUTHENTICATED', 'expected authenticated principal');
      assert(!('merchantWorkspaceId' in result.principal), 'auth principal must not contain workspace authority');
      assert(!('permissionGrants' in result.principal), 'auth principal must not contain permissions');
    },
  },
  {
    id: 'AUTHZ-A01-FORGED-EXTERNAL-ORG-NOT-BOUND',
    run: () => {
      const resolved = resolveAuthOrganizationBinding(
        provider,
        externalAuthOrganizationRef('forged-org'),
        [orgBinding],
      );
      assert(resolved === null, 'forged external org must not map');
    },
  },
  {
    id: 'AUTH-ORG-BINDING-NEVER-RETURNS-WORKSPACE',
    run: () => {
      const resolved = resolveAuthOrganizationBinding(
        provider,
        externalAuthOrganizationRef('external-org-a'),
        [orgBinding],
      );
      assert(resolved === merchantOrg, 'valid binding should map only to internal organization');
      assert((resolved as unknown) !== workspaceA, 'external org must never become workspace id');
    },
  },
  {
    id: 'AUTHZ-A02-VALID-SESSION-REVOKED-MEMBERSHIP-DENY',
    run: async () => {
      const auth = resolveAuthenticatedPrincipal(verifiedAttempt(), [identity], now);
      assert(auth.status === 'AUTHENTICATED', 'session should authenticate first');
      const decision = await evaluateAuthorization({
        executionContext: baseContext(),
        requiredPermission: grantedPermission,
        target: {
          owningOrganizationId: merchantOrg,
          merchantWorkspaceId: workspaceA,
          resourceType: 'Product',
          resourceId: 'p1',
        },
        membershipCandidates: [membershipCandidate('membership-1', { status: operationalStatus('REVOKED') })],
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      });
      assert(decision.decision === 'DENY', 'revoked membership must deny despite valid vendor session');
    },
  },
  {
    id: 'AUTHZ-A03-AGENCY-SESSION-WITHOUT-ASSIGNMENT-DENY',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext({
          actorOrganizationId: agencyOrg,
          actorOrganizationType: 'AGENCY',
          activeMerchantWorkspaceId: workspaceA,
        }),
        requiredPermission: grantedPermission,
        target: {
          owningOrganizationId: merchantOrg,
          merchantWorkspaceId: workspaceA,
          resourceType: 'Product',
          resourceId: 'p1',
        },
        module: 'commerce',
        membershipCandidates: [membershipCandidate('membership-1', { organizationId: agencyOrg })],
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      });
      assert(decision.decision === 'DENY', 'agency membership alone must not grant client access');
    },
  },
  {
    id: 'AUTH-AGENCY-ASSIGNMENT-STILL-REQUIRED-AFTER-AUTH',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext({
          actorOrganizationId: agencyOrg,
          actorOrganizationType: 'AGENCY',
          activeMerchantWorkspaceId: workspaceA,
          agencyClientAssignmentId: agencyAssignment.assignmentId,
        }),
        requiredPermission: grantedPermission,
        target: {
          owningOrganizationId: merchantOrg,
          merchantWorkspaceId: workspaceA,
          resourceType: 'Product',
          resourceId: 'p1',
        },
        module: 'commerce',
        membershipCandidates: [membershipCandidate('membership-1', { organizationId: agencyOrg })],
        agencyAssignmentCandidates: [agencyAssignment],
        roleReader: defaultRoleReader(),
      });
      assert(decision.decision === 'ALLOW', 'valid assignment + permission should allow');
    },
  },
  {
    id: 'AUTHZ-A05-EXPIRED-SESSION-DENY',
    run: () => {
      const result = resolveAuthenticatedPrincipal(
        verifiedAttempt({ expiresAt: utcTimestamp('2026-08-07T17:59:59Z') }),
        [identity],
        now,
      );
      assert(result.status === 'DENIED' && result.reason === 'SESSION_EXPIRED', 'expired session must deny');
    },
  },
  {
    id: 'AUTH-VENDOR-OUTAGE-NEVER-DEFAULT-ALLOW',
    run: () => {
      const result = resolveAuthenticatedPrincipal({ outcome: 'UNAVAILABLE' }, [identity], now);
      assert(result.status === 'UNAVAILABLE', 'provider outage must remain unavailable');
    },
  },
  {
    id: 'AUTH-CLIENT-CANNOT-SWITCH-WORKSPACE-B',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext(),
        requiredPermission: grantedPermission,
        target: {
          owningOrganizationId: otherOrg,
          merchantWorkspaceId: workspaceB,
          resourceType: 'Product',
          resourceId: 'p-b',
        },
        membershipCandidates: [membershipCandidate('membership-1')],
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      });
      assert(decision.decision === 'DENY', 'client-selected workspace must not bypass server context');
    },
  },
  {
    id: 'IDTEN-WIN-01-IN-RANGE-OPEN-MEMBERSHIP-ALLOW',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext(),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        membershipCandidates: [membershipCandidate('membership-1', { validFrom: utcTimestamp('2026-08-01T00:00:00Z') })],
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      });
      assert(decision.decision === 'ALLOW', 'in-range membership with an open upper bound should allow');
    },
  },
  {
    id: 'IDTEN-WIN-02-FUTURE-MEMBERSHIP-DENY',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext(),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        membershipCandidates: [membershipCandidate('membership-1', { validFrom: utcTimestamp('2026-08-08T00:00:00Z') })],
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      });
      assert(decision.decision === 'DENY' && decision.reason === 'MEMBERSHIP_NOT_CURRENT', 'future membership must deny');
    },
  },
  {
    id: 'IDTEN-WIN-03-EXPIRED-MEMBERSHIP-DENY',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext(),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        membershipCandidates: [membershipCandidate('membership-1', { validTo: utcTimestamp('2026-08-07T12:00:00Z') })],
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      });
      assert(decision.decision === 'DENY' && decision.reason === 'MEMBERSHIP_NOT_CURRENT', 'expired membership must deny');
    },
  },
  {
    id: 'IDTEN-WIN-04-IN-RANGE-OPEN-AGENCY-ASSIGNMENT-ALLOW',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext({
          actorOrganizationId: agencyOrg,
          actorOrganizationType: 'AGENCY',
          activeMerchantWorkspaceId: workspaceA,
          agencyClientAssignmentId: agencyAssignment.assignmentId,
        }),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        module: 'commerce',
        membershipCandidates: [membershipCandidate('membership-1', { organizationId: agencyOrg })],
        agencyAssignmentCandidates: [{ ...agencyAssignment, validFrom: utcTimestamp('2026-08-01T00:00:00Z') }],
        roleReader: defaultRoleReader(),
      });
      assert(decision.decision === 'ALLOW', 'in-range agency assignment with an open upper bound should allow');
    },
  },
  {
    id: 'IDTEN-WIN-05-FUTURE-AGENCY-ASSIGNMENT-DENY',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext({
          actorOrganizationId: agencyOrg,
          actorOrganizationType: 'AGENCY',
          activeMerchantWorkspaceId: workspaceA,
          agencyClientAssignmentId: agencyAssignment.assignmentId,
        }),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        module: 'commerce',
        membershipCandidates: [membershipCandidate('membership-1', { organizationId: agencyOrg })],
        agencyAssignmentCandidates: [{ ...agencyAssignment, validFrom: utcTimestamp('2026-08-08T00:00:00Z') }],
        roleReader: defaultRoleReader(),
      });
      assert(
        decision.decision === 'DENY' && decision.reason === 'AGENCY_ASSIGNMENT_NOT_CURRENT',
        'future agency assignment must deny',
      );
    },
  },
  {
    id: 'IDTEN-WIN-06-EXPIRED-AGENCY-ASSIGNMENT-DENY',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext({
          actorOrganizationId: agencyOrg,
          actorOrganizationType: 'AGENCY',
          activeMerchantWorkspaceId: workspaceA,
          agencyClientAssignmentId: agencyAssignment.assignmentId,
        }),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        module: 'commerce',
        membershipCandidates: [membershipCandidate('membership-1', { organizationId: agencyOrg })],
        agencyAssignmentCandidates: [{ ...agencyAssignment, validTo: utcTimestamp('2026-08-07T12:00:00Z') }],
        roleReader: defaultRoleReader(),
      });
      assert(
        decision.decision === 'DENY' && decision.reason === 'AGENCY_ASSIGNMENT_NOT_CURRENT',
        'expired agency assignment must deny',
      );
    },
  },
  {
    id: 'IDTEN-WIN-07-NOW-EQUALS-VALID-FROM-ACTIVE',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext(),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        membershipCandidates: [membershipCandidate('membership-1', { validFrom: now })],
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      });
      assert(decision.decision === 'ALLOW', 'validFrom boundary is inclusive');
    },
  },
  {
    id: 'IDTEN-WIN-08-NOW-EQUALS-VALID-TO-EXPIRED',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext(),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        membershipCandidates: [membershipCandidate('membership-1', { validTo: now })],
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      });
      assert(decision.decision === 'DENY' && decision.reason === 'MEMBERSHIP_NOT_CURRENT', 'validTo boundary is exclusive');
    },
  },
  {
    id: 'IDTEN-WIN-09-STALE-ACTIVE-CONTEXT-AFTER-WINDOW-CLOSE-DENY',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext({ membershipStatus: operationalStatus('ACTIVE') }),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        membershipCandidates: [
          membershipCandidate('membership-1', {
            validFrom: utcTimestamp('2026-08-01T00:00:00Z'),
            validTo: utcTimestamp('2026-08-07T17:00:00Z'),
          }),
        ],
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      });
      assert(
        decision.decision === 'DENY' && decision.reason === 'MEMBERSHIP_NOT_CURRENT',
        'a copied ACTIVE status field alone must never override a real candidate whose window has already closed',
      );
    },
  },
  {
    id: 'IDTEN-BIND-01-EXACT-CURRENT-MEMBERSHIP-MATCHING-CONTEXT-ALLOWS',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext(),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        membershipCandidates: [membershipCandidate('membership-1')],
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      });
      assert(decision.decision === 'ALLOW', 'exact current membership matching the context binding must permit existing downstream gates');
    },
  },
  {
    id: 'IDTEN-BIND-02-MEMBERSHIP-NONE-DENIES',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext(),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        membershipCandidates: [],
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      });
      assert(decision.decision === 'DENY' && decision.reason === 'MEMBERSHIP_NOT_CURRENT', 'no effective current membership must deny');
    },
  },
  {
    id: 'IDTEN-BIND-03-MEMBERSHIP-CONFLICT-DENIES-WITH-NO-WINNER',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext(),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        membershipCandidates: [membershipCandidate('membership-1'), membershipCandidate('membership-2')],
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      });
      assert(
        decision.decision === 'DENY' && decision.reason === 'MEMBERSHIP_CURRENT_CONFLICT',
        'two effective current memberships must deny, never pick a winner',
      );
    },
  },
  {
    id: 'IDTEN-BIND-04-CONTEXT-MEMBERSHIP-ID-MISMATCH-DENIES-EVEN-IF-COPIED-FIELDS-LOOK-CURRENT',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext({ membershipStatus: operationalStatus('ACTIVE') }),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        // The only effective candidate carries a different membershipId than the context claims to be bound to.
        membershipCandidates: [membershipCandidate('membership-stale-caller-selection')],
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      });
      assert(
        decision.decision === 'DENY' && decision.reason === 'MEMBERSHIP_IDENTITY_MISMATCH',
        'a resolved current membership that does not match the execution context binding must deny even when copied status/window fields look current',
      );
    },
  },
  {
    id: 'IDTEN-BIND-05-AGENCY-ASSIGNMENT-NONE-AND-CONFLICT-DENY',
    run: async () => {
      const noneDecision = await evaluateAuthorization({
        executionContext: baseContext({ actorOrganizationId: agencyOrg, actorOrganizationType: 'AGENCY', activeMerchantWorkspaceId: workspaceA }),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        module: 'commerce',
        membershipCandidates: [membershipCandidate('membership-1', { organizationId: agencyOrg })],
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      });
      assert(
        noneDecision.decision === 'DENY' && noneDecision.reason === 'AGENCY_ASSIGNMENT_NOT_CURRENT',
        'no effective current assignment must deny',
      );

      const conflictDecision = await evaluateAuthorization({
        executionContext: baseContext({ actorOrganizationId: agencyOrg, actorOrganizationType: 'AGENCY', activeMerchantWorkspaceId: workspaceA }),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        module: 'commerce',
        membershipCandidates: [membershipCandidate('membership-1', { organizationId: agencyOrg })],
        agencyAssignmentCandidates: [assignmentCandidate('a-1'), assignmentCandidate('a-2')],
        roleReader: defaultRoleReader(),
      });
      assert(
        conflictDecision.decision === 'DENY' && conflictDecision.reason === 'AGENCY_ASSIGNMENT_CURRENT_CONFLICT',
        'two effective current assignments must deny, never pick a winner',
      );
    },
  },
  {
    id: 'IDTEN-BIND-06-STALE-CALLER-SELECTED-ASSIGNMENT-DENIES',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext({
          actorOrganizationId: agencyOrg,
          actorOrganizationType: 'AGENCY',
          activeMerchantWorkspaceId: workspaceA,
          agencyClientAssignmentId: agencyClientAssignmentId('assignment-not-the-resolved-one'),
        }),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        module: 'commerce',
        membershipCandidates: [membershipCandidate('membership-1', { organizationId: agencyOrg })],
        agencyAssignmentCandidates: [agencyAssignment],
        roleReader: defaultRoleReader(),
      });
      assert(
        decision.decision === 'DENY' && decision.reason === 'AGENCY_ASSIGNMENT_IDENTITY_MISMATCH',
        'a resolved current assignment that does not match the caller-claimed assignment binding must deny',
      );
    },
  },
  {
    id: 'IDTEN-BIND-07-WORKSPACE-SWITCH-CANNOT-REUSE-OLD-WORKSPACE-AUTHORITY',
    run: async () => {
      // agencyAssignment is only effective for workspaceA; switching the active/target workspace to
      // workspaceB must re-resolve current authority scoped to workspaceB, never reuse the old resolution.
      const decision = await evaluateAuthorization({
        executionContext: baseContext({
          actorOrganizationId: agencyOrg,
          actorOrganizationType: 'AGENCY',
          activeMerchantWorkspaceId: workspaceB,
          agencyClientAssignmentId: agencyAssignment.assignmentId,
        }),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceB, resourceType: 'Product', resourceId: 'p1' },
        module: 'commerce',
        membershipCandidates: [membershipCandidate('membership-1', { organizationId: agencyOrg })],
        agencyAssignmentCandidates: [agencyAssignment],
        roleReader: defaultRoleReader(),
      });
      assert(
        decision.decision === 'DENY' && decision.reason === 'AGENCY_ASSIGNMENT_NOT_CURRENT',
        'an assignment scoped to a different workspace must never authorize the switched-to workspace',
      );
    },
  },
  {
    id: 'PERM-GEN-02-STALE-SNAPSHOT-REF-DENIES',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext({ permissionSnapshotRef: 'stale-ref-from-before-a-role-change' }),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        membershipCandidates: [membershipCandidate('membership-1')],
        agencyAssignmentCandidates: [],
        roleReader: defaultRoleReader(),
      });
      assert(
        decision.decision === 'DENY' && decision.reason === 'PERMISSION_AUTHORITY_STALE_REF',
        'a claimed permissionSnapshotRef that does not match the freshly recomputed current authority must deny before any grant match',
      );
    },
  },
  {
    id: 'PERM-GEN-06-ZERO-CURRENT-ROLES-RESOLVES-BUT-DENIES-AS-PERMISSION-NOT-GRANTED',
    run: async () => {
      // Successful authoritative read, zero roles: a valid current state with zero grants, not a
      // resolution failure. It still denies the protected action normally.
      const decision = await evaluateAuthorization({
        executionContext: baseContext({ permissionSnapshotRef: zeroRolesPermissionSnapshotRef }),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        membershipCandidates: [membershipCandidate('membership-1')],
        agencyAssignmentCandidates: [],
        roleReader: fakeReader({ outcome: 'READ_SUCCESS', roleKeys: [] }),
      });
      assert(
        decision.decision === 'DENY' && decision.reason === 'PERMISSION_NOT_GRANTED',
        'a current membership with zero current roles must resolve to an empty-grant snapshot and deny as PERMISSION_NOT_GRANTED, never PERMISSION_AUTHORITY_UNRESOLVED',
      );
    },
  },
  {
    id: 'PERM-GEN-READER-ERROR-DENIES-UNRESOLVED-NEVER-FALLS-BACK',
    run: async () => {
      const decision = await evaluateAuthorization({
        executionContext: baseContext(),
        requiredPermission: grantedPermission,
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        // Current membership resolves fine, but the authoritative role read itself fails; the
        // context's copied permissionGrants (still claiming grantedPermission) must never be used
        // as a fallback.
        membershipCandidates: [membershipCandidate('membership-1')],
        agencyAssignmentCandidates: [],
        roleReader: fakeReader({ outcome: 'READ_ERROR' }),
      });
      assert(
        decision.decision === 'DENY' && decision.reason === 'PERMISSION_AUTHORITY_UNRESOLVED',
        'an authoritative role-read error must deny as unresolved, never fall back to copied context.permissionGrants',
      );
    },
  },
  {
    id: 'PERM-GEN-10-COPIED-GRANTS-CANNOT-WIDEN-CURRENT-GRANTS',
    run: async () => {
      // The context's copied permissionGrants claims a permission the current role set does not
      // actually grant; the fresh server-recomputed snapshot must be the only source of truth.
      const decision = await evaluateAuthorization({
        executionContext: baseContext({
          permissionGrants: [
            {
              permission: permission('commerce.order:refund'),
              scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspaceA },
              sourceRef: 'stale-copied-grant',
            },
          ],
        }),
        requiredPermission: permission('commerce.order:refund'),
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Order', resourceId: 'order-1' },
        membershipCandidates: [membershipCandidate('membership-1')],
        agencyAssignmentCandidates: [],
        // CLIENT_SUPPORT_AGENT does not include commerce.order:refund.
        roleReader: defaultRoleReader(),
      });
      assert(
        decision.decision === 'DENY' && decision.reason === 'PERMISSION_NOT_GRANTED',
        'a permission present only in copied context.permissionGrants, not in the current role-derived snapshot, must never authorize',
      );
    },
  },
  {
    id: 'IDTEN-RES-01-ZERO-CURRENT-MEMBERSHIP-NONE',
    run: () => {
      const result = resolveCurrentMembership([], userId, merchantOrg, now);
      assert(result.outcome === 'NONE', 'no candidates must resolve to NONE');
    },
  },
  {
    id: 'IDTEN-RES-02-ONE-CURRENT-MEMBERSHIP-RESOLVED',
    run: () => {
      const current = membershipCandidate('m-current');
      const result = resolveCurrentMembership([current], userId, merchantOrg, now);
      assert(result.outcome === 'RESOLVED' && result.record === current, 'single effective candidate must resolve exactly');
    },
  },
  {
    id: 'IDTEN-RES-03-OVERLAPPING-CURRENT-MEMBERSHIPS-CONFLICT',
    run: () => {
      const a = membershipCandidate('m-a');
      const b = membershipCandidate('m-b');
      const result = resolveCurrentMembership([a, b], userId, merchantOrg, now);
      assert(result.outcome === 'CONFLICT' && result.candidates.length === 2, 'two effective candidates must conflict, never pick a winner');
    },
  },
  {
    id: 'IDTEN-RES-04-EXPIRED-HISTORY-PLUS-ONE-CURRENT-RESOLVED',
    run: () => {
      const expired = membershipCandidate('m-expired', { validTo: utcTimestamp('2026-08-01T00:00:00Z') });
      const current = membershipCandidate('m-current');
      const result = resolveCurrentMembership([expired, current], userId, merchantOrg, now);
      assert(result.outcome === 'RESOLVED' && result.record === current, 'expired history must not count toward conflict');
    },
  },
  {
    id: 'IDTEN-RES-05-FUTURE-ROW-PLUS-ONE-CURRENT-RESOLVED',
    run: () => {
      const future = membershipCandidate('m-future', { validFrom: utcTimestamp('2026-09-01T00:00:00Z') });
      const current = membershipCandidate('m-current');
      const result = resolveCurrentMembership([future, current], userId, merchantOrg, now);
      assert(result.outcome === 'RESOLVED' && result.record === current, 'a not-yet-valid row must not count toward conflict');
    },
  },
  {
    id: 'IDTEN-RES-06-INACTIVE-ROW-PLUS-ONE-CURRENT-RESOLVED',
    run: () => {
      const revoked = membershipCandidate('m-revoked', { status: operationalStatus('REVOKED') });
      const current = membershipCandidate('m-current');
      const result = resolveCurrentMembership([revoked, current], userId, merchantOrg, now);
      assert(result.outcome === 'RESOLVED' && result.record === current, 'a revoked row must not count toward conflict');
    },
  },
  {
    id: 'IDTEN-RES-07-MEMBERSHIP-CANDIDATE-ORDER-PERMUTATION-INVARIANT',
    run: () => {
      const a = membershipCandidate('m-a');
      const b = membershipCandidate('m-b');
      const wrongOrg = membershipCandidate('m-wrong-org', { organizationId: otherOrg });
      const expired = membershipCandidate('m-expired', { validTo: utcTimestamp('2026-08-01T00:00:00Z') });
      const future = membershipCandidate('m-future', { validFrom: utcTimestamp('2026-09-01T00:00:00Z') });
      const revoked = membershipCandidate('m-revoked', { status: operationalStatus('REVOKED') });
      const expectedIds = new Set([a.membershipId, b.membershipId]);
      const candidates = [a, b, wrongOrg, expired, future, revoked];
      let permutationCount = 0;
      for (const permutation of permutations(candidates)) {
        const result = resolveCurrentMembership(permutation, userId, merchantOrg, now);
        assert(
          result.outcome === 'CONFLICT',
          'candidate order must never change the resolution outcome away from CONFLICT',
        );
        assertExactIdSet(
          result.candidates.map((c) => c.membershipId),
          expectedIds,
          'candidate order must never change the exact effective candidate identity set, and wrong-scope/expired/future/revoked noise must never leak in or produce an authoritative winner',
        );
        permutationCount += 1;
      }
      assert(permutationCount === factorial(candidates.length), 'every candidate-order permutation must be exercised');
    },
  },
  {
    id: 'IDTEN-RES-08-ZERO-CURRENT-ASSIGNMENT-NONE',
    run: () => {
      const result = resolveCurrentAgencyAssignment([], agencyOrg, workspaceA, now);
      assert(result.outcome === 'NONE', 'no candidates must resolve to NONE');
    },
  },
  {
    id: 'IDTEN-RES-09-ONE-CURRENT-ASSIGNMENT-RESOLVED',
    run: () => {
      const current = assignmentCandidate('a-current');
      const result = resolveCurrentAgencyAssignment([current], agencyOrg, workspaceA, now);
      assert(result.outcome === 'RESOLVED' && result.record === current, 'single effective candidate must resolve exactly');
    },
  },
  {
    id: 'IDTEN-RES-10-OVERLAPPING-CURRENT-ASSIGNMENTS-CONFLICT',
    run: () => {
      const a = assignmentCandidate('a-a');
      const b = assignmentCandidate('a-b');
      const result = resolveCurrentAgencyAssignment([a, b], agencyOrg, workspaceA, now);
      assert(result.outcome === 'CONFLICT' && result.candidates.length === 2, 'two effective candidates must conflict, never pick a winner');
    },
  },
  {
    id: 'IDTEN-RES-11-ASSIGNMENT-NOISE-DOES-NOT-CREATE-CONFLICT',
    run: () => {
      const expired = assignmentCandidate('a-expired', { validTo: utcTimestamp('2026-08-01T00:00:00Z') });
      const future = assignmentCandidate('a-future', { validFrom: utcTimestamp('2026-09-01T00:00:00Z') });
      const inactive = assignmentCandidate('a-inactive', { status: operationalStatus('REVOKED') });
      const current = assignmentCandidate('a-current');
      const result = resolveCurrentAgencyAssignment([expired, future, inactive, current], agencyOrg, workspaceA, now);
      assert(result.outcome === 'RESOLVED' && result.record === current, 'expired/future/inactive noise must not create a conflict');
    },
  },
  {
    id: 'IDTEN-RES-12-WRONG-ORGANIZATION-WORKSPACE-NEVER-SATISFIES-SCOPE',
    run: () => {
      const wrongOrgMembership = membershipCandidate('m-wrong-org', { organizationId: otherOrg });
      const membershipResult = resolveCurrentMembership([wrongOrgMembership], userId, merchantOrg, now);
      assert(membershipResult.outcome === 'NONE', 'a membership scoped to a different organization must never satisfy the target scope');

      const wrongWorkspaceAssignment = assignmentCandidate('a-wrong-ws', { merchantWorkspaceId: workspaceB });
      const assignmentResult = resolveCurrentAgencyAssignment([wrongWorkspaceAssignment], agencyOrg, workspaceA, now);
      assert(assignmentResult.outcome === 'NONE', 'an assignment scoped to a different workspace must never satisfy the target scope');
    },
  },
  {
    id: 'IDTEN-RES-13-ASSIGNMENT-CANDIDATE-ORDER-PERMUTATION-INVARIANT',
    run: () => {
      const a = assignmentCandidate('a-a');
      const b = assignmentCandidate('a-b');
      const wrongWorkspace = assignmentCandidate('a-wrong-ws', { merchantWorkspaceId: workspaceB });
      const expired = assignmentCandidate('a-expired', { validTo: utcTimestamp('2026-08-01T00:00:00Z') });
      const future = assignmentCandidate('a-future', { validFrom: utcTimestamp('2026-09-01T00:00:00Z') });
      const revoked = assignmentCandidate('a-revoked', { status: operationalStatus('REVOKED') });
      const expectedIds = new Set([a.assignmentId, b.assignmentId]);
      const candidates = [a, b, wrongWorkspace, expired, future, revoked];
      let permutationCount = 0;
      for (const permutation of permutations(candidates)) {
        const result = resolveCurrentAgencyAssignment(permutation, agencyOrg, workspaceA, now);
        assert(
          result.outcome === 'CONFLICT',
          'candidate order must never change the resolution outcome away from CONFLICT',
        );
        assertExactIdSet(
          result.candidates.map((c) => c.assignmentId),
          expectedIds,
          'candidate order must never change the exact effective candidate identity set, and wrong-scope/expired/future/revoked noise must never leak in or produce an authoritative winner',
        );
        permutationCount += 1;
      }
      assert(permutationCount === factorial(candidates.length), 'every candidate-order permutation must be exercised');
    },
  },
  {
    id: 'IDTEN-RES-14-VALID-FROM-INCLUSIVE-VALID-TO-EXCLUSIVE-BOUNDARY-EXACT',
    run: () => {
      const closingOut = membershipCandidate('m-closing', { validTo: now });
      const openingIn = membershipCandidate('m-opening', { validFrom: now });
      const result = resolveCurrentMembership([closingOut, openingIn], userId, merchantOrg, now);
      assert(
        result.outcome === 'RESOLVED' && result.record === openingIn,
        'at the exact shared boundary instant only the validFrom-inclusive row is effective, never both',
      );
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} auth identity scenarios`);
}

void main();

// Keep type aliases exercised under strict compilation.
export type AuthBoundarySmoke = [OrganizationId, MerchantWorkspaceId];
