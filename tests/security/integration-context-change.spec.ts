import {
  prepareIntegrationContextChange,
  resolveIntegrationContextChangeAuthority,
  settleIntegrationContextChange,
  type IntegrationContextChangePlan,
} from '../../packages/authz/src/integration-context-change';
import type { ExecutionContext, PermissionGrant, ServerResolvedResourceContext } from '../../packages/authz/src/types';
import { internalId, localeTag, operationalStatus, utcTimestamp } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspace = internalId('mw_context_change_001', 'MerchantWorkspace');
const otherWorkspace = internalId('mw_context_change_002', 'MerchantWorkspace');
const organization = internalId('org_context_change_001', 'Organization');
const now = utcTimestamp('2026-08-10T08:00:00Z');

function grant(permission: PermissionGrant['permission']): PermissionGrant {
  return {
    permission,
    scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspace },
    sourceRef: `grant:${permission}`,
  };
}

function context(grants: readonly PermissionGrant[]): ExecutionContext {
  return {
    actorUserId: internalId('user_context_change_001', 'User'),
    actorOrganizationId: organization,
    actorOrganizationType: 'STANDALONE_MERCHANT',
    membershipId: internalId('membership_context_change_001', 'Membership'),
    membershipStatus: operationalStatus('ACTIVE'),
    activeMerchantWorkspaceId: workspace,
    permissionSnapshotRef: 'perm-snapshot-context-change',
    permissionGrants: grants,
    assuranceLevel: 'STRONG',
    channel: 'web',
    requestId: internalId('request_context_change_001', 'Request'),
    runId: internalId('run_context_change_001', 'Run'),
    locale: localeTag('tr-TR'),
    occurredAt: now,
  };
}

const target: ServerResolvedResourceContext = {
  owningOrganizationId: organization,
  merchantWorkspaceId: workspace,
  resourceType: 'merchant_workspace',
  resourceId: workspace as string,
};

function basePlan(overrides: Partial<IntegrationContextChangePlan> = {}): IntegrationContextChangePlan {
  return {
    merchantWorkspaceId: workspace,
    provider: 'shopify',
    kind: 'SWITCH_STORE',
    currentContextRef: 'shopify:akilta',
    targetContextRef: 'shopify:bpc',
    authorizationSource: 'EXPLICIT_OWNER',
    ownerApprovalRef: 'owner-approval:bpc-readonly',
    approvedTargetContextRef: 'shopify:bpc',
    downstreamIntent: 'READ_ONLY',
    requestedAt: now,
    ...overrides,
  };
}

const bothIntegrationPermissions = [grant('integration:disconnect'), grant('integration:connect')];

const cases: Array<[string, () => void]> = [
  ['GENERIC-CONTINUE-CANNOT-AUTHORIZE-CONTEXT-CHANGE', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ authorizationSource: 'GENERIC_CONTINUATION', ownerApprovalRef: undefined }),
      executionContext: context(bothIntegrationPermissions),
      target,
    });
    assert(result.decision === 'DENY' && result.reason === 'OWNER_APPROVAL_REQUIRED', 'generic continuation authorized switch');
  }],
  ['READ-ONLY-DOWNSTREAM-INTENT-DOES-NOT-DOWNGRADE-SWITCH-RISK', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ authorizationSource: 'PROJECT_POLICY', downstreamIntent: 'READ_ONLY' }),
      executionContext: context(bothIntegrationPermissions),
      target,
    });
    assert(result.decision === 'DENY' && result.reason === 'OWNER_APPROVAL_REQUIRED', 'read-only intent bypassed explicit owner gate');
  }],
  ['EXPLICIT-OWNER-TARGET-MUST-MATCH', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ approvedTargetContextRef: 'shopify:other-store' }),
      executionContext: context(bothIntegrationPermissions),
      target,
    });
    assert(result.decision === 'DENY' && result.reason === 'APPROVED_TARGET_MISMATCH', 'different approved target accepted');
  }],
  ['ACTIVE-SOURCE-PROJECT-NON-INTERFERENCE-DENY', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ sourceProject: { projectKey: 'BPC', activity: 'ACTIVE', wouldBeDisrupted: true } }),
      executionContext: context(bothIntegrationPermissions),
      target,
    });
    assert(result.decision === 'DENY' && result.reason === 'SOURCE_PROJECT_NON_INTERFERENCE', 'active source project disruption allowed');
  }],
  ['UNKNOWN-SOURCE-PROJECT-STATE-FAILS-CLOSED', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ sourceProject: { projectKey: 'BPC', activity: 'UNKNOWN', wouldBeDisrupted: true } }),
      executionContext: context(bothIntegrationPermissions),
      target,
    });
    assert(result.decision === 'DENY' && result.reason === 'SOURCE_PROJECT_NON_INTERFERENCE', 'unknown source project state allowed disruption');
  }],
  ['SWITCH-REQUIRES-CONNECT-AND-DISCONNECT-PERMISSIONS', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan(),
      executionContext: context([grant('integration:connect')]),
      target,
    });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORIZATION_DENIED', 'switch allowed without disconnect permission');
  }],
  ['CONNECT-REQUIRES-CONNECT-PERMISSION-ONLY', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ kind: 'CONNECT', currentContextRef: 'shopify:none' }),
      executionContext: context([grant('integration:connect')]),
      target,
    });
    assert(result.decision === 'READY', 'connect not authorized with connect permission');
    assert(result.matchedPermissions.length === 1 && result.matchedPermissions[0] === 'integration:connect', 'connect permission mapping wrong');
  }],
  ['DISCONNECT-REQUIRES-DISCONNECT-PERMISSION-ONLY', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ kind: 'DISCONNECT', targetContextRef: 'shopify:none', approvedTargetContextRef: 'shopify:none' }),
      executionContext: context([grant('integration:disconnect')]),
      target,
    });
    assert(result.decision === 'READY', 'disconnect not authorized with disconnect permission');
  }],
  ['RELINK-REQUIRES-BOTH-PERMISSIONS', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ kind: 'RELINK' }),
      executionContext: context([grant('integration:disconnect')]),
      target,
    });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORIZATION_DENIED', 'relink allowed without connect permission');
  }],
  ['PLAN-WORKSPACE-MUST-MATCH-SERVER-TARGET', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan(),
      executionContext: context(bothIntegrationPermissions),
      target: { ...target, merchantWorkspaceId: otherWorkspace },
    });
    assert(result.decision === 'DENY' && result.reason === 'PLAN_WORKSPACE_MISMATCH', 'cross-workspace plan accepted');
  }],
  ['INACTIVE-NONDISRUPTIVE-EXPLICIT-SWITCH-CAN-BE-PREPARED', () => {
    const result = resolveIntegrationContextChangeAuthority({
      plan: basePlan({ sourceProject: { projectKey: 'BPC', activity: 'INACTIVE', wouldBeDisrupted: false } }),
      executionContext: context(bothIntegrationPermissions),
      target,
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
    });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORIZATION_DENIED', 'owner approval bypassed RBAC');
  }],
];

for (const [name, fn] of cases) {
  fn();
  console.log(`PASS ${name}`);
}
console.log(`PASS ${cases.length}/${cases.length} integration context-change authority scenarios`);
