import {
  prepareIntegrationContextChange,
  resolveIntegrationContextChangeAuthority,
  settleIntegrationContextChange,
  type IntegrationContextChangePlan,
} from '../../packages/authz/src/integration-context-change';
import { resolvePermissionAuthoritySnapshot, ROLE_PERMISSION_POLICY } from '../../packages/authz/src';
import type { ExecutionContext, PermissionGrant, ServerResolvedResourceContext } from '../../packages/authz/src/types';
import { internalId, localeTag, operationalStatus, utcTimestamp, type Membership } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspace = internalId('mw_context_change_001', 'MerchantWorkspace');
const otherWorkspace = internalId('mw_context_change_002', 'MerchantWorkspace');
const organization = internalId('org_context_change_001', 'Organization');
const now = utcTimestamp('2026-08-10T08:00:00Z');
const actorUserId = internalId('user_context_change_001', 'User');
const membershipId = internalId('membership_context_change_001', 'Membership');

function grant(permission: PermissionGrant['permission']): PermissionGrant {
  return {
    permission,
    scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspace },
    sourceRef: `grant:${permission}`,
  };
}

/** Current permissionSnapshotRef for a membership whose current roles are exactly these grants' permissions. */
function currentSnapshotRefFor(grants: readonly PermissionGrant[]): string {
  const resolution = resolvePermissionAuthoritySnapshot(
    membershipId,
    workspace,
    grants.map((g) => g.permission),
    ROLE_PERMISSION_POLICY,
  );
  return resolution.outcome === 'RESOLVED' ? resolution.snapshot.authorityVersion : 'unresolvable-permission-authority';
}

function context(grants: readonly PermissionGrant[]): ExecutionContext {
  return {
    actorUserId,
    actorOrganizationId: organization,
    actorOrganizationType: 'STANDALONE_MERCHANT',
    membershipId,
    membershipStatus: operationalStatus('ACTIVE'),
    activeMerchantWorkspaceId: workspace,
    permissionSnapshotRef: currentSnapshotRefFor(grants),
    permissionGrants: grants,
    assuranceLevel: 'STRONG',
    channel: 'web',
    requestId: internalId('request_context_change_001', 'Request'),
    runId: internalId('run_context_change_001', 'Run'),
    locale: localeTag('tr-TR'),
    occurredAt: now,
  };
}

/** The one currently-effective membership candidate whose current roles are exactly these grants' permissions. */
function membershipCandidatesFor(grants: readonly PermissionGrant[]): readonly Membership[] {
  return [
    { membershipId, userId: actorUserId, organizationId: organization, roleRefs: grants.map((g) => g.permission), status: operationalStatus('ACTIVE') },
  ];
}

/** Used only by tests that deny before reaching permission-authority (membership NONE/CONFLICT/mismatch, no current assignment); roleRefs content is irrelevant to those outcomes. */
const membershipCandidates: readonly Membership[] = [
  { membershipId, userId: actorUserId, organizationId: organization, roleRefs: [], status: operationalStatus('ACTIVE') },
];

const target: ServerResolvedResourceContext = {
  owningOrganizationId: organization,
  merchantWorkspaceId: workspace,
  resourceType: 'merchant_workspace',
  resourceId: workspace,
};

function basePlan(
  overrides: Partial<Omit<IntegrationContextChangePlan, 'ownerApprovalRef'>> & {
    ownerApprovalRef?: string | undefined;
  } = {},
): IntegrationContextChangePlan {
  const { ownerApprovalRef, ...rest } = overrides;
  const resolvedOwnerApprovalRef = 'ownerApprovalRef' in overrides ? ownerApprovalRef : 'owner-approval:bpc-readonly';
  return {
    merchantWorkspaceId: workspace,
    provider: 'shopify',
    kind: 'SWITCH_STORE',
    currentContextRef: 'shopify:akilta',
    targetContextRef: 'shopify:bpc',
    authorizationSource: 'EXPLICIT_OWNER',
    ...(resolvedOwnerApprovalRef !== undefined ? { ownerApprovalRef: resolvedOwnerApprovalRef } : {}),
    approvedTargetContextRef: 'shopify:bpc',
    downstreamIntent: 'READ_ONLY',
    requestedAt: now,
    ...rest,
  };
}

const bothIntegrationPermissions = [grant('integration:disconnect'), grant('integration:connect')];

const cases: Array<[string, () => void]> = [
  ['GENERIC-CONTINUE-CANNOT-AUTHORIZE-CONTEXT-CHANGE', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ authorizationSource: 'GENERIC_CONTINUATION', ownerApprovalRef: undefined }),
      executionContext: context(bothIntegrationPermissions),
      target,
      membershipCandidates: membershipCandidatesFor(bothIntegrationPermissions),
      agencyAssignmentCandidates: [],
    });
    assert(result.decision === 'DENY' && result.reason === 'OWNER_APPROVAL_REQUIRED', 'generic continuation authorized switch');
  }],
  ['READ-ONLY-DOWNSTREAM-INTENT-DOES-NOT-DOWNGRADE-SWITCH-RISK', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ authorizationSource: 'PROJECT_POLICY', downstreamIntent: 'READ_ONLY' }),
      executionContext: context(bothIntegrationPermissions),
      target,
      membershipCandidates: membershipCandidatesFor(bothIntegrationPermissions),
      agencyAssignmentCandidates: [],
    });
    assert(result.decision === 'DENY' && result.reason === 'OWNER_APPROVAL_REQUIRED', 'read-only intent bypassed explicit owner gate');
  }],
  ['EXPLICIT-OWNER-TARGET-MUST-MATCH', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ approvedTargetContextRef: 'shopify:other-store' }),
      executionContext: context(bothIntegrationPermissions),
      target,
      membershipCandidates: membershipCandidatesFor(bothIntegrationPermissions),
      agencyAssignmentCandidates: [],
    });
    assert(result.decision === 'DENY' && result.reason === 'APPROVED_TARGET_MISMATCH', 'different approved target accepted');
  }],
  ['ACTIVE-SOURCE-PROJECT-NON-INTERFERENCE-DENY', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ sourceProject: { projectKey: 'BPC', activity: 'ACTIVE', wouldBeDisrupted: true } }),
      executionContext: context(bothIntegrationPermissions),
      target,
      membershipCandidates: membershipCandidatesFor(bothIntegrationPermissions),
      agencyAssignmentCandidates: [],
    });
    assert(result.decision === 'DENY' && result.reason === 'SOURCE_PROJECT_NON_INTERFERENCE', 'active source project disruption allowed');
  }],
  ['UNKNOWN-SOURCE-PROJECT-STATE-FAILS-CLOSED', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ sourceProject: { projectKey: 'BPC', activity: 'UNKNOWN', wouldBeDisrupted: true } }),
      executionContext: context(bothIntegrationPermissions),
      target,
      membershipCandidates: membershipCandidatesFor(bothIntegrationPermissions),
      agencyAssignmentCandidates: [],
    });
    assert(result.decision === 'DENY' && result.reason === 'SOURCE_PROJECT_NON_INTERFERENCE', 'unknown source project state allowed disruption');
  }],
  ['SWITCH-REQUIRES-CONNECT-AND-DISCONNECT-PERMISSIONS', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan(),
      executionContext: context([grant('integration:connect')]),
      target,
      membershipCandidates: membershipCandidatesFor([grant('integration:connect')]),
      agencyAssignmentCandidates: [],
    });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORIZATION_DENIED', 'switch allowed without disconnect permission');
  }],
  ['CONNECT-REQUIRES-CONNECT-PERMISSION-ONLY', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ kind: 'CONNECT', currentContextRef: 'shopify:none' }),
      executionContext: context([grant('integration:connect')]),
      target,
      membershipCandidates: membershipCandidatesFor([grant('integration:connect')]),
      agencyAssignmentCandidates: [],
    });
    assert(result.decision === 'READY', 'connect not authorized with connect permission');
    assert(result.matchedPermissions.length === 1 && result.matchedPermissions[0] === 'integration:connect', 'connect permission mapping wrong');
  }],
  ['DISCONNECT-REQUIRES-DISCONNECT-PERMISSION-ONLY', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ kind: 'DISCONNECT', targetContextRef: 'shopify:none', approvedTargetContextRef: 'shopify:none' }),
      executionContext: context([grant('integration:disconnect')]),
      target,
      membershipCandidates: membershipCandidatesFor([grant('integration:disconnect')]),
      agencyAssignmentCandidates: [],
    });
    assert(result.decision === 'READY', 'disconnect not authorized with disconnect permission');
  }],
  ['RELINK-REQUIRES-BOTH-PERMISSIONS', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ kind: 'RELINK' }),
      executionContext: context([grant('integration:disconnect')]),
      target,
      membershipCandidates: membershipCandidatesFor([grant('integration:disconnect')]),
      agencyAssignmentCandidates: [],
    });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORIZATION_DENIED', 'relink allowed without connect permission');
  }],
  ['PLAN-WORKSPACE-MUST-MATCH-SERVER-TARGET', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan(),
      executionContext: context(bothIntegrationPermissions),
      target: { ...target, merchantWorkspaceId: otherWorkspace },
      membershipCandidates: membershipCandidatesFor(bothIntegrationPermissions),
      agencyAssignmentCandidates: [],
    });
    assert(result.decision === 'DENY' && result.reason === 'PLAN_WORKSPACE_MISMATCH', 'cross-workspace plan accepted');
  }],
  ['INACTIVE-NONDISRUPTIVE-EXPLICIT-SWITCH-CAN-BE-PREPARED', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ sourceProject: { projectKey: 'BPC', activity: 'INACTIVE', wouldBeDisrupted: false } }),
      executionContext: context(bothIntegrationPermissions),
      target,
      membershipCandidates: membershipCandidatesFor(bothIntegrationPermissions),
      agencyAssignmentCandidates: [],
    });
    assert(result.decision === 'READY', 'explicit non-disruptive switch not prepared');
    assert(result.prepared.downstreamAuthorityGranted === false, 'context-change approval leaked downstream authority');
    assert(result.prepared.invalidatePriorCapabilityAuthority === true, 'prior capability authority not invalidated');
  }],
  ['POST-SWITCH-TARGET-MISMATCH-FAILS-CLOSED', () => {
    const prepared = prepareIntegrationContextChange(basePlan());
    assert(prepared.decision === 'READY', 'valid context change did not prepare');
    const settled = settleIntegrationContextChange({
      prepared,
      observedTargetContextRef: 'shopify:unexpected',
      previousContextStillAssumedAvailable: false,
    });
    assert(settled.decision === 'DENY' && settled.reason === 'TARGET_CONTEXT_READBACK_MISMATCH', 'target mismatch accepted');
  }],
  ['OLD-CONTEXT-CANNOT-BE-ASSUMED-AFTER-SWITCH', () => {
    const prepared = prepareIntegrationContextChange(basePlan());
    assert(prepared.decision === 'READY', 'valid context change did not prepare');
    const settled = settleIntegrationContextChange({
      prepared,
      observedTargetContextRef: 'shopify:bpc',
      previousContextStillAssumedAvailable: true,
    });
    assert(settled.decision === 'DENY' && settled.reason === 'PREVIOUS_CONTEXT_INVALIDATION_REQUIRED', 'old context assumption survived switch');
  }],
  ['MATCHED-TARGET-VERIFIES-WITHOUT-DOWNSTREAM-AUTHORITY', () => {
    const prepared = prepareIntegrationContextChange(basePlan());
    assert(prepared.decision === 'READY', 'valid context change did not prepare');
    const settled = settleIntegrationContextChange({
      prepared,
      observedTargetContextRef: 'shopify:bpc',
      previousContextStillAssumedAvailable: false,
    });
    assert(settled.decision === 'VERIFIED', 'matched target failed verification');
    assert(settled.invalidatePriorCapabilitySnapshots === true, 'capability snapshots not invalidated');
    assert(settled.downstreamAuthorityGranted === false, 'context settlement granted downstream mutation authority');
  }],
  ['OWNER-APPROVAL-DOES-NOT-SUBSTITUTE-FOR-RBAC', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan(),
      executionContext: context([]),
      target,
      membershipCandidates: membershipCandidatesFor([]),
      agencyAssignmentCandidates: [],
    });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORIZATION_DENIED', 'owner approval bypassed RBAC');
  }],
  ['IDTEN-BIND-10-NO-CURRENT-MEMBERSHIP-NEVER-READY', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ kind: 'CONNECT', currentContextRef: 'shopify:none' }),
      executionContext: context([grant('integration:connect')]),
      target,
      membershipCandidates: [],
      agencyAssignmentCandidates: [],
    });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORIZATION_DENIED', 'missing current membership reached READY');
  }],
  ['IDTEN-BIND-10-CONFLICTING-MEMBERSHIP-NEVER-READY', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ kind: 'CONNECT', currentContextRef: 'shopify:none' }),
      executionContext: context([grant('integration:connect')]),
      target,
      membershipCandidates: [
        membershipCandidates[0]!,
        { ...membershipCandidates[0]!, membershipId: internalId('membership_context_change_conflict', 'Membership') },
      ],
      agencyAssignmentCandidates: [],
    });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORIZATION_DENIED', 'conflicting current membership reached READY');
  }],
  ['IDTEN-BIND-10-MISMATCHED-MEMBERSHIP-NEVER-READY', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ kind: 'CONNECT', currentContextRef: 'shopify:none' }),
      executionContext: context([grant('integration:connect')]),
      target,
      membershipCandidates: [
        { ...membershipCandidates[0]!, membershipId: internalId('membership_context_change_other', 'Membership') },
      ],
      agencyAssignmentCandidates: [],
    });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORIZATION_DENIED', 'stale caller-selected membership reached READY');
  }],
  ['IDTEN-BIND-10-NO-CURRENT-AGENCY-ASSIGNMENT-NEVER-READY', () => {
    const agencyOrg = internalId('org_context_change_agency', 'Organization');
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ kind: 'CONNECT', currentContextRef: 'shopify:none' }),
      executionContext: {
        ...context([grant('integration:connect')]),
        actorOrganizationId: agencyOrg,
        actorOrganizationType: 'AGENCY',
      },
      target,
      membershipCandidates: [{ membershipId, userId: actorUserId, organizationId: agencyOrg, roleRefs: [], status: operationalStatus('ACTIVE') }],
      agencyAssignmentCandidates: [],
    });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORIZATION_DENIED', 'agency actor without a current assignment reached READY');
  }],
];

for (const [name, fn] of cases) {
  fn();
  console.log(`PASS ${name}`);
}
console.log(`PASS ${cases.length}/${cases.length} integration context-change authority scenarios`);
