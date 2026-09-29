import {
  permissionsByKind,
  prepareIntegrationContextChange,
  resolveIntegrationContextChangeAuthority,
  settleIntegrationContextChange,
  type IntegrationContextChangePlan,
} from '../../packages/authz/src/integration-context-change';
import { resolvePermissionAuthoritySnapshot, ROLE_PERMISSION_POLICY } from '../../packages/authz/src';
import type {
  ExecutionContext,
  MembershipRoleReadResult,
  MembershipRoleReader,
  PermissionGrant,
  ServerResolvedResourceContext,
} from '../../packages/authz/src/types';
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

/**
 * integration:connect/integration:disconnect are outside the conservative V1 role catalog — no
 * directly-evidenced D-12 role grants them yet. `resolveIntegrationContextChangeAuthority` can
 * therefore never reach READY through the production role reader today; that is the conservative
 * catalog working as intended ("acceptable — and preferred — for currently registered actions to
 * remain unreachable... when their role bundle is not yet canonically evidenced"), not a defect.
 * The "which permissions are required per kind" invariant these tests used to prove through a full
 * authz ALLOW is instead proven directly against the exported permissionsByKind mapping below.
 */

/** Directly-evidenced V1 role covering conversation:respond; deliberately no integration:* grant. */
const grantedRoleKey = 'CLIENT_SUPPORT_AGENT';

function snapshotRefFor(...roleKeys: string[]): string {
  const resolution = resolvePermissionAuthoritySnapshot(membershipId, workspace, roleKeys, ROLE_PERMISSION_POLICY);
  return resolution.outcome === 'RESOLVED' ? resolution.snapshot.authorityVersion : 'unresolvable-permission-authority';
}

function fakeReader(result: MembershipRoleReadResult): MembershipRoleReader {
  return { read: () => Promise.resolve(result) };
}

function roleReaderFor(...roleKeys: string[]): MembershipRoleReader {
  return fakeReader({ outcome: 'READ_SUCCESS', roleKeys });
}

function context(grants: readonly PermissionGrant[] = []): ExecutionContext {
  return {
    actorUserId,
    actorOrganizationId: organization,
    actorOrganizationType: 'STANDALONE_MERCHANT',
    membershipId,
    membershipStatus: operationalStatus('ACTIVE'),
    activeMerchantWorkspaceId: workspace,
    permissionSnapshotRef: snapshotRefFor(grantedRoleKey),
    // Claim/cache correlation only — never trusted for the grant decision.
    permissionGrants: grants,
    assuranceLevel: 'STRONG',
    channel: 'web',
    requestId: internalId('request_context_change_001', 'Request'),
    runId: internalId('run_context_change_001', 'Run'),
    locale: localeTag('tr-TR'),
    occurredAt: now,
  };
}

/** roleRefs is no longer the permission-authority source; an authoritative MembershipRoleReader is. */
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

const cases: Array<[string, () => void | Promise<void>]> = [
  ['GENERIC-CONTINUE-CANNOT-AUTHORIZE-CONTEXT-CHANGE', async () => {
    const result = await resolveIntegrationContextChangeAuthority({
      plan: basePlan({ authorizationSource: 'GENERIC_CONTINUATION', ownerApprovalRef: undefined }),
      executionContext: context(),
      target,
      membershipCandidates,
      agencyAssignmentCandidates: [],
      roleReader: roleReaderFor(grantedRoleKey),
    });
    assert(result.decision === 'DENY' && result.reason === 'OWNER_APPROVAL_REQUIRED', 'generic continuation authorized switch');
  }],
  ['READ-ONLY-DOWNSTREAM-INTENT-DOES-NOT-DOWNGRADE-SWITCH-RISK', async () => {
    const result = await resolveIntegrationContextChangeAuthority({
      plan: basePlan({ authorizationSource: 'PROJECT_POLICY', downstreamIntent: 'READ_ONLY' }),
      executionContext: context(),
      target,
      membershipCandidates,
      agencyAssignmentCandidates: [],
      roleReader: roleReaderFor(grantedRoleKey),
    });
    assert(result.decision === 'DENY' && result.reason === 'OWNER_APPROVAL_REQUIRED', 'read-only intent bypassed explicit owner gate');
  }],
  ['EXPLICIT-OWNER-TARGET-MUST-MATCH', async () => {
    const result = await resolveIntegrationContextChangeAuthority({
      plan: basePlan({ approvedTargetContextRef: 'shopify:other-store' }),
      executionContext: context(),
      target,
      membershipCandidates,
      agencyAssignmentCandidates: [],
      roleReader: roleReaderFor(grantedRoleKey),
    });
    assert(result.decision === 'DENY' && result.reason === 'APPROVED_TARGET_MISMATCH', 'different approved target accepted');
  }],
  ['ACTIVE-SOURCE-PROJECT-NON-INTERFERENCE-DENY', async () => {
    const result = await resolveIntegrationContextChangeAuthority({
      plan: basePlan({ sourceProject: { projectKey: 'BPC', activity: 'ACTIVE', wouldBeDisrupted: true } }),
      executionContext: context(),
      target,
      membershipCandidates,
      agencyAssignmentCandidates: [],
      roleReader: roleReaderFor(grantedRoleKey),
    });
    assert(result.decision === 'DENY' && result.reason === 'SOURCE_PROJECT_NON_INTERFERENCE', 'active source project disruption allowed');
  }],
  ['UNKNOWN-SOURCE-PROJECT-STATE-FAILS-CLOSED', async () => {
    const result = await resolveIntegrationContextChangeAuthority({
      plan: basePlan({ sourceProject: { projectKey: 'BPC', activity: 'UNKNOWN', wouldBeDisrupted: true } }),
      executionContext: context(),
      target,
      membershipCandidates,
      agencyAssignmentCandidates: [],
      roleReader: roleReaderFor(grantedRoleKey),
    });
    assert(result.decision === 'DENY' && result.reason === 'SOURCE_PROJECT_NON_INTERFERENCE', 'unknown source project state allowed disruption');
  }],
  ['PERMISSIONS-BY-KIND-EXACT-MAPPING', () => {
    assert(permissionsByKind.CONNECT.length === 1 && permissionsByKind.CONNECT[0] === 'integration:connect', 'CONNECT must require exactly integration:connect');
    assert(permissionsByKind.DISCONNECT.length === 1 && permissionsByKind.DISCONNECT[0] === 'integration:disconnect', 'DISCONNECT must require exactly integration:disconnect');
    assert(permissionsByKind.REVOKE_ACCESS.length === 1 && permissionsByKind.REVOKE_ACCESS[0] === 'integration:disconnect', 'REVOKE_ACCESS must require exactly integration:disconnect');
    for (const kind of ['RELINK', 'SWITCH_ACCOUNT', 'SWITCH_STORE'] as const) {
      const required = new Set(permissionsByKind[kind]);
      assert(
        required.size === 2 && required.has('integration:disconnect') && required.has('integration:connect'),
        `${kind} must require exactly integration:disconnect and integration:connect`,
      );
    }
  }],
  ['INTEGRATION-PERMISSIONS-NOT-YET-GRANTABLE-BY-ANY-EVIDENCED-ROLE-DENIES', async () => {
    // Even with every permission granted by every directly-evidenced V1 role combined, integration
    // context-change still denies: no role grants integration:connect/integration:disconnect.
    const everyEvidencedRole = ['CLIENT_SUPPORT_AGENT', 'CLIENT_ANALYST', 'AGENCY_ANALYST', 'CLIENT_MARKETING_MANAGER'];
    const result = await resolveIntegrationContextChangeAuthority({
      plan: basePlan({ kind: 'CONNECT', currentContextRef: 'shopify:none' }),
      executionContext: context(),
      target,
      membershipCandidates,
      agencyAssignmentCandidates: [],
      roleReader: roleReaderFor(...everyEvidencedRole),
    });
    assert(
      result.decision === 'DENY' && result.reason === 'AUTHORIZATION_DENIED',
      'CONNECT reached READY despite no evidenced role granting integration:connect',
    );
  }],
  ['PLAN-WORKSPACE-MUST-MATCH-SERVER-TARGET', async () => {
    const result = await resolveIntegrationContextChangeAuthority({
      plan: basePlan(),
      executionContext: context(),
      target: { ...target, merchantWorkspaceId: otherWorkspace },
      membershipCandidates,
      agencyAssignmentCandidates: [],
      roleReader: roleReaderFor(grantedRoleKey),
    });
    assert(result.decision === 'DENY' && result.reason === 'PLAN_WORKSPACE_MISMATCH', 'cross-workspace plan accepted');
  }],
  ['INACTIVE-NONDISRUPTIVE-EXPLICIT-SWITCH-PREPARES', () => {
    // Prepare-step behavior only — independent of authz/role-catalog coverage, since
    // prepareIntegrationContextChange never consults permission authority.
    const prepared = prepareIntegrationContextChange(
      basePlan({ sourceProject: { projectKey: 'BPC', activity: 'INACTIVE', wouldBeDisrupted: false } }),
    );
    assert(prepared.decision === 'READY', 'explicit non-disruptive switch not prepared');
    assert(prepared.downstreamAuthorityGranted === false, 'context-change approval leaked downstream authority');
    assert(prepared.invalidatePriorCapabilityAuthority === true, 'prior capability authority not invalidated');
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
  ['OWNER-APPROVAL-DOES-NOT-SUBSTITUTE-FOR-RBAC', async () => {
    const result = await resolveIntegrationContextChangeAuthority({
      plan: basePlan(),
      executionContext: context(),
      target,
      membershipCandidates,
      agencyAssignmentCandidates: [],
      roleReader: roleReaderFor(),
    });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORIZATION_DENIED', 'owner approval bypassed RBAC');
  }],
  ['IDTEN-BIND-10-NO-CURRENT-MEMBERSHIP-NEVER-READY', async () => {
    const result = await resolveIntegrationContextChangeAuthority({
      plan: basePlan({ kind: 'CONNECT', currentContextRef: 'shopify:none' }),
      executionContext: context(),
      target,
      membershipCandidates: [],
      agencyAssignmentCandidates: [],
      roleReader: roleReaderFor(grantedRoleKey),
    });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORIZATION_DENIED', 'missing current membership reached READY');
  }],
  ['IDTEN-BIND-10-CONFLICTING-MEMBERSHIP-NEVER-READY', async () => {
    const result = await resolveIntegrationContextChangeAuthority({
      plan: basePlan({ kind: 'CONNECT', currentContextRef: 'shopify:none' }),
      executionContext: context(),
      target,
      membershipCandidates: [
        membershipCandidates[0]!,
        { ...membershipCandidates[0]!, membershipId: internalId('membership_context_change_conflict', 'Membership') },
      ],
      agencyAssignmentCandidates: [],
      roleReader: roleReaderFor(grantedRoleKey),
    });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORIZATION_DENIED', 'conflicting current membership reached READY');
  }],
  ['IDTEN-BIND-10-MISMATCHED-MEMBERSHIP-NEVER-READY', async () => {
    const result = await resolveIntegrationContextChangeAuthority({
      plan: basePlan({ kind: 'CONNECT', currentContextRef: 'shopify:none' }),
      executionContext: context(),
      target,
      membershipCandidates: [
        { ...membershipCandidates[0]!, membershipId: internalId('membership_context_change_other', 'Membership') },
      ],
      agencyAssignmentCandidates: [],
      roleReader: roleReaderFor(grantedRoleKey),
    });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORIZATION_DENIED', 'stale caller-selected membership reached READY');
  }],
  ['IDTEN-BIND-10-NO-CURRENT-AGENCY-ASSIGNMENT-NEVER-READY', async () => {
    const agencyOrg = internalId('org_context_change_agency', 'Organization');
    const result = await resolveIntegrationContextChangeAuthority({
      plan: basePlan({ kind: 'CONNECT', currentContextRef: 'shopify:none' }),
      executionContext: {
        ...context(),
        actorOrganizationId: agencyOrg,
        actorOrganizationType: 'AGENCY',
      },
      target,
      membershipCandidates: [{ membershipId, userId: actorUserId, organizationId: agencyOrg, roleRefs: [], status: operationalStatus('ACTIVE') }],
      agencyAssignmentCandidates: [],
      roleReader: roleReaderFor(grantedRoleKey),
    });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORIZATION_DENIED', 'agency actor without a current assignment reached READY');
  }],
];

async function main() {
  for (const [name, fn] of cases) {
    await fn();
    console.log(`PASS ${name}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} integration context-change authority scenarios`);
}

void main();
