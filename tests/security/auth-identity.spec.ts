import {
  authProviderKey,
  evaluateAuthorization,
  externalAuthOrganizationRef,
  externalAuthSubjectRef,
  externalSessionRef,
  permission,
  resolveAuthenticatedPrincipal,
  resolveAuthOrganizationBinding,
  type AuthOrganizationBinding,
  type ExecutionContext,
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
    permissionSnapshotRef: 'perm-1',
    permissionGrants: [
      {
        permission: permission('commerce.product:read'),
        scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspaceA },
        sourceRef: 'role:owner',
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

const cases: Array<{ id: string; run: () => void }> = [
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
    run: () => {
      const auth = resolveAuthenticatedPrincipal(verifiedAttempt(), [identity], now);
      assert(auth.status === 'AUTHENTICATED', 'session should authenticate first');
      const decision = evaluateAuthorization({
        executionContext: baseContext({ membershipStatus: operationalStatus('REVOKED') }),
        requiredPermission: permission('commerce.product:read'),
        target: {
          owningOrganizationId: merchantOrg,
          merchantWorkspaceId: workspaceA,
          resourceType: 'Product',
          resourceId: 'p1',
        },
      });
      assert(decision.decision === 'DENY', 'revoked membership must deny despite valid vendor session');
    },
  },
  {
    id: 'AUTHZ-A03-AGENCY-SESSION-WITHOUT-ASSIGNMENT-DENY',
    run: () => {
      const decision = evaluateAuthorization({
        executionContext: baseContext({
          actorOrganizationId: agencyOrg,
          actorOrganizationType: 'AGENCY',
          activeMerchantWorkspaceId: workspaceA,
        }),
        requiredPermission: permission('commerce.product:read'),
        target: {
          owningOrganizationId: merchantOrg,
          merchantWorkspaceId: workspaceA,
          resourceType: 'Product',
          resourceId: 'p1',
        },
        module: 'commerce',
      });
      assert(decision.decision === 'DENY', 'agency membership alone must not grant client access');
    },
  },
  {
    id: 'AUTH-AGENCY-ASSIGNMENT-STILL-REQUIRED-AFTER-AUTH',
    run: () => {
      const decision = evaluateAuthorization({
        executionContext: baseContext({
          actorOrganizationId: agencyOrg,
          actorOrganizationType: 'AGENCY',
          activeMerchantWorkspaceId: workspaceA,
        }),
        requiredPermission: permission('commerce.product:read'),
        target: {
          owningOrganizationId: merchantOrg,
          merchantWorkspaceId: workspaceA,
          resourceType: 'Product',
          resourceId: 'p1',
        },
        module: 'commerce',
        agencyAssignment,
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
    run: () => {
      const decision = evaluateAuthorization({
        executionContext: baseContext(),
        requiredPermission: permission('commerce.product:read'),
        target: {
          owningOrganizationId: otherOrg,
          merchantWorkspaceId: workspaceB,
          resourceType: 'Product',
          resourceId: 'p-b',
        },
      });
      assert(decision.decision === 'DENY', 'client-selected workspace must not bypass server context');
    },
  },
  {
    id: 'IDTEN-WIN-01-IN-RANGE-OPEN-MEMBERSHIP-ALLOW',
    run: () => {
      const decision = evaluateAuthorization({
        executionContext: baseContext({ membershipValidFrom: utcTimestamp('2026-08-01T00:00:00Z') }),
        requiredPermission: permission('commerce.product:read'),
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
      });
      assert(decision.decision === 'ALLOW', 'in-range membership with an open upper bound should allow');
    },
  },
  {
    id: 'IDTEN-WIN-02-FUTURE-MEMBERSHIP-DENY',
    run: () => {
      const decision = evaluateAuthorization({
        executionContext: baseContext({ membershipValidFrom: utcTimestamp('2026-08-08T00:00:00Z') }),
        requiredPermission: permission('commerce.product:read'),
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
      });
      assert(decision.decision === 'DENY' && decision.reason === 'MEMBERSHIP_NOT_YET_VALID', 'future membership must deny');
    },
  },
  {
    id: 'IDTEN-WIN-03-EXPIRED-MEMBERSHIP-DENY',
    run: () => {
      const decision = evaluateAuthorization({
        executionContext: baseContext({ membershipValidTo: utcTimestamp('2026-08-07T12:00:00Z') }),
        requiredPermission: permission('commerce.product:read'),
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
      });
      assert(decision.decision === 'DENY' && decision.reason === 'MEMBERSHIP_EXPIRED', 'expired membership must deny');
    },
  },
  {
    id: 'IDTEN-WIN-04-IN-RANGE-OPEN-AGENCY-ASSIGNMENT-ALLOW',
    run: () => {
      const decision = evaluateAuthorization({
        executionContext: baseContext({
          actorOrganizationId: agencyOrg,
          actorOrganizationType: 'AGENCY',
          activeMerchantWorkspaceId: workspaceA,
        }),
        requiredPermission: permission('commerce.product:read'),
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        module: 'commerce',
        agencyAssignment: { ...agencyAssignment, validFrom: utcTimestamp('2026-08-01T00:00:00Z') },
      });
      assert(decision.decision === 'ALLOW', 'in-range agency assignment with an open upper bound should allow');
    },
  },
  {
    id: 'IDTEN-WIN-05-FUTURE-AGENCY-ASSIGNMENT-DENY',
    run: () => {
      const decision = evaluateAuthorization({
        executionContext: baseContext({
          actorOrganizationId: agencyOrg,
          actorOrganizationType: 'AGENCY',
          activeMerchantWorkspaceId: workspaceA,
        }),
        requiredPermission: permission('commerce.product:read'),
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        module: 'commerce',
        agencyAssignment: { ...agencyAssignment, validFrom: utcTimestamp('2026-08-08T00:00:00Z') },
      });
      assert(
        decision.decision === 'DENY' && decision.reason === 'AGENCY_ASSIGNMENT_NOT_YET_VALID',
        'future agency assignment must deny',
      );
    },
  },
  {
    id: 'IDTEN-WIN-06-EXPIRED-AGENCY-ASSIGNMENT-DENY',
    run: () => {
      const decision = evaluateAuthorization({
        executionContext: baseContext({
          actorOrganizationId: agencyOrg,
          actorOrganizationType: 'AGENCY',
          activeMerchantWorkspaceId: workspaceA,
        }),
        requiredPermission: permission('commerce.product:read'),
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
        module: 'commerce',
        agencyAssignment: { ...agencyAssignment, validTo: utcTimestamp('2026-08-07T12:00:00Z') },
      });
      assert(
        decision.decision === 'DENY' && decision.reason === 'AGENCY_ASSIGNMENT_EXPIRED',
        'expired agency assignment must deny',
      );
    },
  },
  {
    id: 'IDTEN-WIN-07-NOW-EQUALS-VALID-FROM-ACTIVE',
    run: () => {
      const decision = evaluateAuthorization({
        executionContext: baseContext({ membershipValidFrom: now }),
        requiredPermission: permission('commerce.product:read'),
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
      });
      assert(decision.decision === 'ALLOW', 'validFrom boundary is inclusive');
    },
  },
  {
    id: 'IDTEN-WIN-08-NOW-EQUALS-VALID-TO-EXPIRED',
    run: () => {
      const decision = evaluateAuthorization({
        executionContext: baseContext({ membershipValidTo: now }),
        requiredPermission: permission('commerce.product:read'),
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
      });
      assert(decision.decision === 'DENY' && decision.reason === 'MEMBERSHIP_EXPIRED', 'validTo boundary is exclusive');
    },
  },
  {
    id: 'IDTEN-WIN-09-STALE-ACTIVE-CONTEXT-AFTER-WINDOW-CLOSE-DENY',
    run: () => {
      const decision = evaluateAuthorization({
        executionContext: baseContext({
          membershipStatus: operationalStatus('ACTIVE'),
          membershipValidFrom: utcTimestamp('2026-08-01T00:00:00Z'),
          membershipValidTo: utcTimestamp('2026-08-07T17:00:00Z'),
        }),
        requiredPermission: permission('commerce.product:read'),
        target: { owningOrganizationId: merchantOrg, merchantWorkspaceId: workspaceA, resourceType: 'Product', resourceId: 'p1' },
      });
      assert(
        decision.decision === 'DENY' && decision.reason === 'MEMBERSHIP_EXPIRED',
        'an ACTIVE status field alone must not override an already-closed validity window',
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
      const forward = resolveCurrentMembership([a, b], userId, merchantOrg, now);
      const reversed = resolveCurrentMembership([b, a], userId, merchantOrg, now);
      assert(
        forward.outcome === 'CONFLICT' &&
          reversed.outcome === 'CONFLICT' &&
          forward.candidates.length === reversed.candidates.length &&
          new Set(forward.candidates.map((c) => c.membershipId)).size ===
            new Set(reversed.candidates.map((c) => c.membershipId)).size,
        'candidate order must never change the resolution outcome or the effective set',
      );
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
      const forward = resolveCurrentAgencyAssignment([a, b], agencyOrg, workspaceA, now);
      const reversed = resolveCurrentAgencyAssignment([b, a], agencyOrg, workspaceA, now);
      assert(
        forward.outcome === 'CONFLICT' &&
          reversed.outcome === 'CONFLICT' &&
          forward.candidates.length === reversed.candidates.length &&
          new Set(forward.candidates.map((c) => c.assignmentId)).size ===
            new Set(reversed.candidates.map((c) => c.assignmentId)).size,
        'candidate order must never change the resolution outcome or the effective set',
      );
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

for (const testCase of cases) {
  testCase.run();
  console.log(`PASS ${testCase.id}`);
}

console.log(`PASS ${cases.length}/${cases.length} auth identity scenarios`);

// Keep type aliases exercised under strict compilation.
export type AuthBoundarySmoke = [OrganizationId, MerchantWorkspaceId];
