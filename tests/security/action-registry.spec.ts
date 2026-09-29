import {
  getActionDefinition,
  resolveActionAuthority,
  resolvePermissionAuthoritySnapshot,
  ROLE_PERMISSION_POLICY,
  type CapabilityAuthoritySnapshot,
  type ExecutionContext,
  type MembershipRoleReadResult,
  type MembershipRoleReader,
} from '../../packages/authz/src';
import {
  internalId,
  localeTag,
  operationalStatus,
  utcTimestamp,
  type Membership,
} from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspace = internalId('mw_action_001', 'MerchantWorkspace');
const organization = internalId('org_action_001', 'Organization');
const integration = internalId('integration_action_001', 'Integration');
const now = utcTimestamp('2026-08-07T19:00:00Z');
const actorUserId = internalId('user_action_001', 'User');
const membershipId = internalId('membership_action_001', 'Membership');

/** Directly-evidenced V1 role covering commerce.order:read and conversation:respond. */
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

/** roleRefs is no longer the permission-authority source; an authoritative MembershipRoleReader is. */
const membershipCandidates: readonly Membership[] = [
  {
    membershipId,
    userId: actorUserId,
    organizationId: organization,
    roleRefs: [],
    status: operationalStatus('ACTIVE'),
  },
];

function context(): ExecutionContext {
  return {
    actorUserId,
    actorOrganizationId: organization,
    actorOrganizationType: 'STANDALONE_MERCHANT',
    membershipId,
    membershipStatus: operationalStatus('ACTIVE'),
    activeMerchantWorkspaceId: workspace,
    permissionSnapshotRef: snapshotRefFor(grantedRoleKey),
    // Claim/cache correlation only — never trusted for the grant decision.
    permissionGrants: [],
    assuranceLevel: 'STANDARD',
    channel: 'web',
    requestId: internalId('request_action_001', 'Request'),
    runId: internalId('run_action_001', 'Run'),
    locale: localeTag('tr-TR'),
    occurredAt: now,
  };
}

const target = {
  owningOrganizationId: organization,
  merchantWorkspaceId: workspace,
  resourceType: 'merchant_workspace',
  resourceId: workspace as string,
};

const orderReadAvailable: CapabilityAuthoritySnapshot = {
  merchantWorkspaceId: workspace,
  integrationId: integration,
  capabilityKey: 'commerce.get_order',
  supportState: 'AVAILABLE',
  evidenceRef: 'provider-evidence-order-read',
};
const sendAvailable: CapabilityAuthoritySnapshot = {
  merchantWorkspaceId: workspace,
  integrationId: integration,
  capabilityKey: 'whatsapp.send_message',
  supportState: 'AVAILABLE',
  evidenceRef: 'provider-evidence-whatsapp-send',
};

const cases: Array<[string, () => void | Promise<void>]> = [
  ['UNREGISTERED-ACTION-DENY', async () => {
    const result = await resolveActionAuthority({
      actionName: 'switch_tenant', requestedMaturity: 'READ', executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey),
    });
    assert(result.decision === 'DENY' && result.reason === 'UNREGISTERED_ACTION', 'unregistered action not denied');
  }],
  // commerce.order.read (R1, requires commerce.order:read) stands in for the read-path witness:
  // CLIENT_SUPPORT_AGENT is the only directly-evidenced V1 role with any commerce.* read grant.
  ['R1-READ-ALLOW-WITH-AUTHZ-AND-CAPABILITY', async () => {
    const result = await resolveActionAuthority({
      actionName: 'commerce.order.read', requestedMaturity: 'READ', executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), capability: orderReadAvailable, integrationId: integration,
    });
    assert(result.decision === 'ALLOW' && result.definition.riskClass === 'R1', 'R1 read not allowed');
  }],
  ['R1-CANNOT-ESCALATE-TO-APPLY', async () => {
    const result = await resolveActionAuthority({
      actionName: 'commerce.order.read', requestedMaturity: 'APPLY_GOVERNED', executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), capability: orderReadAvailable, integrationId: integration,
    });
    assert(result.decision === 'DENY' && result.reason === 'MATURITY_CEILING_EXCEEDED', 'R1 maturity escalation allowed');
  }],
  ['R2-DRAFT-ALLOW', async () => {
    const result = await resolveActionAuthority({
      actionName: 'conversation.reply.prepare', requestedMaturity: 'DRAFT_PREVIEW', executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey),
    });
    assert(result.decision === 'ALLOW' && result.definition.riskClass === 'R2', 'R2 draft not allowed');
  }],
  ['R3-SEND-UNKNOWN-CAPABILITY-DENY', async () => {
    const result = await resolveActionAuthority({
      actionName: 'conversation.reply.send', requestedMaturity: 'APPLY_GOVERNED', executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), integrationId: integration,
      capability: { merchantWorkspaceId: workspace, integrationId: integration, capabilityKey: 'whatsapp.send_message', supportState: 'UNKNOWN' }, policyApprovalRequired: false,
    });
    assert(result.decision === 'DENY' && result.reason === 'CAPABILITY_NOT_AVAILABLE', 'UNKNOWN send capability allowed');
  }],
  ['R3-SEND-POLICY-APPROVAL', async () => {
    const result = await resolveActionAuthority({
      actionName: 'conversation.reply.send', requestedMaturity: 'APPLY_GOVERNED', executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), integrationId: integration,
      capability: sendAvailable, policyApprovalRequired: true,
    });
    assert(result.decision === 'APPROVAL_REQUIRED' && result.definition.riskClass === 'R3', 'R3 policy approval not required');
  }],
  ['R3-SEND-POLICY-AUTO-ALLOW', async () => {
    const result = await resolveActionAuthority({
      actionName: 'conversation.reply.send', requestedMaturity: 'APPLY_GOVERNED', executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), integrationId: integration,
      capability: sendAvailable, policyApprovalRequired: false,
    });
    assert(result.decision === 'ALLOW', 'bounded R3 service send not allowed after all gates');
  }],
  ['CAPABILITY-WRONG-WORKSPACE-DENY', async () => {
    const result = await resolveActionAuthority({
      actionName: 'commerce.order.read', requestedMaturity: 'READ', executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), integrationId: integration,
      capability: { ...orderReadAvailable, merchantWorkspaceId: internalId('mw_capability_other', 'MerchantWorkspace') },
    });
    assert(result.decision === 'DENY' && result.reason === 'CAPABILITY_WORKSPACE_MISMATCH', 'cross-workspace capability evidence accepted');
  }],
  ['CAPABILITY-WRONG-INTEGRATION-DENY', async () => {
    const result = await resolveActionAuthority({
      actionName: 'commerce.order.read', requestedMaturity: 'READ', executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), integrationId: integration,
      capability: { ...orderReadAvailable, integrationId: internalId('integration_other', 'Integration') },
    });
    assert(result.decision === 'DENY' && result.reason === 'CAPABILITY_INTEGRATION_MISMATCH', 'cross-integration capability evidence accepted');
  }],
  ['CAPABILITY-MISSING-INTEGRATION-CONTEXT-DENY', async () => {
    const result = await resolveActionAuthority({
      actionName: 'commerce.order.read', requestedMaturity: 'READ', executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), capability: orderReadAvailable,
    });
    assert(result.decision === 'DENY' && result.reason === 'CAPABILITY_INTEGRATION_MISMATCH', 'capability used without exact integration context');
  }],
  // customer:export is outside the conservative V1 role catalog (no directly-evidenced role grants
  // it), so the R4-always-approval invariant is tested at the registry-data boundary instead of
  // driving it through a full authz ALLOW that the conservative catalog correctly cannot produce.
  ['R4-CUSTOMER-EXPORT-REGISTERED-AS-ALWAYS-APPROVAL', () => {
    const definition = getActionDefinition('customer.export');
    assert(definition !== null, 'customer.export must remain a registered action');
    assert(definition.approvalMode === 'ALWAYS' && definition.riskClass === 'R4', 'R4 export action definition changed');
  }],
  ['AUTHZ-DENY-BEFORE-ACTION-ALLOW', async () => {
    const result = await resolveActionAuthority({
      actionName: 'conversation.reply.prepare', requestedMaturity: 'DRAFT_PREVIEW', executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(),
    });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORIZATION_DENIED', 'missing permission bypassed');
  }],
  ['CAPABILITY-EVIDENCE-REQUIRED', async () => {
    const result = await resolveActionAuthority({
      actionName: 'commerce.order.read', requestedMaturity: 'READ', executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), integrationId: integration,
      capability: { merchantWorkspaceId: workspace, integrationId: integration, capabilityKey: 'commerce.get_order', supportState: 'AVAILABLE' },
    });
    assert(result.decision === 'DENY' && result.reason === 'CAPABILITY_NOT_AVAILABLE', 'AVAILABLE without evidence ref accepted');
  }],
];

async function main() {
  for (const [name, fn] of cases) {
    await fn();
    console.log(`PASS ${name}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} action registry scenarios`);
}

void main();
