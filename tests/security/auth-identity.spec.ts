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
  utcTimestamp,
  type AgencyClientAssignment,
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
];

for (const testCase of cases) {
  testCase.run();
  console.log(`PASS ${testCase.id}`);
}

console.log(`PASS ${cases.length}/${cases.length} auth identity scenarios`);

// Keep type aliases exercised under strict compilation.
export type AuthBoundarySmoke = [OrganizationId, MerchantWorkspaceId];
