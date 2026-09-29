import {
  internalId,
  idempotencyKey,
  localeTag,
  operationalStatus,
  utcTimestamp,
  type Membership,
} from '../../packages/domain/src';
import {
  getActionDefinition,
  resolvePermissionAuthoritySnapshot,
  ROLE_PERMISSION_POLICY,
  type ExecutionContext,
  type MembershipRoleReadResult,
  type MembershipRoleReader,
} from '../../packages/authz/src';
import { stagedActionPlan, prepareActionExecution } from '../../apps/api/src/action-engine';
import type { SafetySwitchSnapshot } from '../../apps/api/src/runtime-config';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function expectThrow(fn: () => unknown, message: string): void {
  let threw = false; try { fn(); } catch { threw = true; } assert(threw, message);
}

const workspace = internalId('mw_engine_001', 'MerchantWorkspace');
const organization = internalId('org_engine_001', 'Organization');
const integration = internalId('integration_engine_001', 'Integration');
const now = utcTimestamp('2026-08-07T20:00:00Z');
const planId = internalId('plan_engine_001', 'ActionPlan');
const target = { owningOrganizationId: organization, merchantWorkspaceId: workspace, resourceType: 'conversation', resourceId: 'conv_001' };

const actorUserId = internalId('user_engine_001', 'User');
const membershipId = internalId('membership_engine_001', 'Membership');
/** Directly-evidenced V1 role covering conversation:respond. */
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
    assuranceLevel: 'STANDARD', channel: 'web',
    requestId: internalId('request_engine_001', 'Request'),
    runId: internalId('run_engine_001', 'Run'),
    locale: localeTag('tr-TR'), occurredAt: now,
  };
}

/** roleRefs is no longer the permission-authority source; an authoritative MembershipRoleReader is. */
const membershipCandidates: readonly Membership[] = [
  { membershipId, userId: actorUserId, organizationId: organization, roleRefs: [], status: operationalStatus('ACTIVE') },
];

function allowSwitch(key: SafetySwitchSnapshot['key'], operation: string): SafetySwitchSnapshot {
  return {
    key,
    scope: { environment: 'STAGING', merchantWorkspaceId: workspace, operation },
    state: 'ALLOW', configVersion: 'cfg-1', verifiedAt: now, sourceRef: `switch:${key}`,
  };
}
function sendPlan(hash = 'sha256:payload-v1') {
  return stagedActionPlan({
    actionPlanId: planId,
    merchantWorkspaceId: workspace,
    actionName: 'conversation.reply.send',
    requestedMaturity: 'APPLY_GOVERNED',
    inputSchemaVersion: '1',
    payloadHash: hash,
    exactPayloadRef: 'payload:safe-ref-001',
    evidenceRefs: ['factset:001'],
    idempotencyKey: idempotencyKey('mw:conversation.reply.send:001'),
    createdAt: now,
  });
}
const sendCapability = { merchantWorkspaceId: workspace, integrationId: integration, capabilityKey: 'whatsapp.send_message', supportState: 'AVAILABLE' as const, evidenceRef: 'meta-test-evidence' };
const validApproval = {
  approvalRequestId: internalId('approval_engine_001', 'ApprovalRequest'),
  actionPlanId: planId,
  merchantWorkspaceId: workspace,
  payloadHash: 'sha256:payload-v1',
  status: 'APPROVED' as const,
  expiresAt: utcTimestamp('2026-08-07T21:00:00Z'),
};

const cases: Array<[string, () => Promise<void> | void]> = [
  ['PLAN-UNREGISTERED-THROWS', () => expectThrow(() => stagedActionPlan({
    actionPlanId: planId, merchantWorkspaceId: workspace, actionName: 'arbitrary.http', requestedMaturity: 'READ', inputSchemaVersion: '1', payloadHash: 'x', exactPayloadRef: 'x', evidenceRefs: [], idempotencyKey: idempotencyKey('x'), createdAt: now,
  }), 'unregistered plan accepted')],
  ['PLAN-SCHEMA-VERSION-MISMATCH-THROWS', () => expectThrow(() => stagedActionPlan({
    actionPlanId: planId, merchantWorkspaceId: workspace, actionName: 'conversation.reply.send', requestedMaturity: 'APPLY_GOVERNED', inputSchemaVersion: '999', payloadHash: 'sha256:x', exactPayloadRef: 'payload:x', evidenceRefs: [], idempotencyKey: idempotencyKey('schema-mismatch'), createdAt: now,
  }), 'stale input schema version accepted')],
  ['EXECUTION-STALE-SCHEMA-VERSION-DENY', async () => {
    const stalePlan = { ...sendPlan(), inputSchemaVersion: '999' };
    const result = await prepareActionExecution({ plan: stalePlan, executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), capability: sendCapability, integrationId: integration, policyApprovalRequired: false, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send')] });
    assert(result.decision === 'DENY' && result.reason === 'ACTION_INPUT_SCHEMA_VERSION_STALE', 'stale planned schema reached execution');
  }],
  ['R3-WITHOUT-APPROVAL-RETURNS-APPROVAL-REQUIRED', async () => {
    const result = await prepareActionExecution({ plan: sendPlan(), executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), capability: sendCapability, integrationId: integration, policyApprovalRequired: true, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send')] });
    assert(result.decision === 'APPROVAL_REQUIRED', 'approval requirement bypassed');
  }],
  ['APPROVAL-MUTATED-PAYLOAD-DENY', async () => {
    const result = await prepareActionExecution({ plan: sendPlan('sha256:mutated'), executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), capability: sendCapability, integrationId: integration, policyApprovalRequired: true, approval: validApproval, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send')] });
    assert(result.decision === 'DENY' && result.reason.includes('PAYLOAD_HASH_MISMATCH'), 'mutated approval payload accepted');
  }],
  ['VALID-APPROVAL-AND-SAFETY-GATE-EXECUTION-READY', async () => {
    const result = await prepareActionExecution({ plan: sendPlan(), executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), capability: sendCapability, integrationId: integration, policyApprovalRequired: true, approval: validApproval, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send')] });
    assert(result.decision === 'EXECUTION_READY' && result.postReadRequired, 'valid governed action not ready');
  }],
  ['KILL-SWITCH-STOP-DENY', async () => {
    const stopped = { ...allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send'), state: 'STOP' as const };
    const result = await prepareActionExecution({ plan: sendPlan(), executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), capability: sendCapability, integrationId: integration, policyApprovalRequired: false, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [stopped] });
    assert(result.decision === 'DENY' && result.reason.includes('KILL_SWITCH_ACTIVE'), 'kill switch ignored');
  }],
  ['MISSING-KILL-SWITCH-DENY', async () => {
    const result = await prepareActionExecution({ plan: sendPlan(), executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), capability: sendCapability, integrationId: integration, policyApprovalRequired: false, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [] });
    assert(result.decision === 'DENY' && result.reason.includes('KILL_SWITCH_UNVERIFIED'), 'missing kill switch default-allowed');
  }],
  ['UNKNOWN-CAPABILITY-DENY-BEFORE-READY', async () => {
    const result = await prepareActionExecution({ plan: sendPlan(), executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), capability: { merchantWorkspaceId: workspace, integrationId: integration, capabilityKey: 'whatsapp.send_message', supportState: 'UNKNOWN' }, integrationId: integration, policyApprovalRequired: false, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send')] });
    assert(result.decision === 'DENY' && result.reason.includes('CAPABILITY_NOT_AVAILABLE'), 'unknown capability reached ready state');
  }],
  ['CAPABILITY-WRONG-WORKSPACE-DENY', async () => {
    const result = await prepareActionExecution({ plan: sendPlan(), executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), capability: { ...sendCapability, merchantWorkspaceId: internalId('mw_cap_other', 'MerchantWorkspace') }, integrationId: integration, policyApprovalRequired: false, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send')] });
    assert(result.decision === 'DENY' && result.reason.includes('CAPABILITY_WORKSPACE_MISMATCH'), 'cross-workspace capability reached execution');
  }],
  ['CAPABILITY-WRONG-INTEGRATION-DENY', async () => {
    const result = await prepareActionExecution({ plan: sendPlan(), executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), capability: { ...sendCapability, integrationId: internalId('integration_cap_other', 'Integration') }, integrationId: integration, policyApprovalRequired: false, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send')] });
    assert(result.decision === 'DENY' && result.reason.includes('CAPABILITY_INTEGRATION_MISMATCH'), 'cross-integration capability reached execution');
  }],
  ['WRONG-WORKSPACE-APPROVAL-DENY', async () => {
    const wrong = { ...validApproval, merchantWorkspaceId: internalId('mw_other', 'MerchantWorkspace') };
    const result = await prepareActionExecution({ plan: sendPlan(), executionContext: context(), target, membershipCandidates, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), capability: sendCapability, integrationId: integration, policyApprovalRequired: true, approval: wrong, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send')] });
    assert(result.decision === 'DENY' && result.reason.includes('APPROVAL_WORKSPACE_MISMATCH'), 'wrong-workspace approval accepted');
  }],
  // customer:export is outside the conservative V1 role catalog (no directly-evidenced role grants
  // it), so the UNMAPPED_EXTERNAL_EFFECT branch can no longer be reached end-to-end through a real
  // authz ALLOW. Tested at the registry-data boundary instead: the action is still registered as
  // carrying an external effect with no ACTION_EFFECT mapping is exactly what would trigger that
  // branch once a canonically-evidenced role grants customer:export.
  ['R4-CUSTOMER-EXPORT-REGISTERED-AS-EXTERNAL-EFFECT', () => {
    const definition = getActionDefinition('customer.export');
    assert(definition !== null && definition.externalEffect === true, 'customer.export must remain flagged as an external effect');
  }],
  ['IDTEN-BIND-08-NO-CURRENT-MEMBERSHIP-NEVER-REACHES-APPROVAL-OR-READY', async () => {
    const result = await prepareActionExecution({ plan: sendPlan(), executionContext: context(), target, membershipCandidates: [], agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), capability: sendCapability, integrationId: integration, policyApprovalRequired: true, approval: validApproval, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send')] });
    assert(
      result.decision === 'DENY' && result.reason.includes('AUTHORIZATION_DENIED'),
      'missing current-authority binding reached APPROVAL_REQUIRED or EXECUTION_READY',
    );
  }],
  ['IDTEN-BIND-08-CONFLICTING-MEMBERSHIP-NEVER-REACHES-APPROVAL-OR-READY', async () => {
    const conflicting = [...membershipCandidates, { ...membershipCandidates[0]!, membershipId: internalId('membership_engine_conflict', 'Membership') }];
    const result = await prepareActionExecution({ plan: sendPlan(), executionContext: context(), target, membershipCandidates: conflicting, agencyAssignmentCandidates: [], roleReader: roleReaderFor(grantedRoleKey), capability: sendCapability, integrationId: integration, policyApprovalRequired: true, approval: validApproval, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send')] });
    assert(
      result.decision === 'DENY' && result.reason.includes('AUTHORIZATION_DENIED'),
      'conflicting current-authority candidates reached APPROVAL_REQUIRED or EXECUTION_READY',
    );
  }],
];

async function main() {
  for (const [name, fn] of cases) {
    await fn();
    console.log(`PASS ${name}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} action engine scenarios`);
}

void main();
