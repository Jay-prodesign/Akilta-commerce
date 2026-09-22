import {
  internalId,
  idempotencyKey,
  localeTag,
  operationalStatus,
  utcTimestamp,
} from '../../packages/domain/src';
import type { ExecutionContext, PermissionGrant } from '../../packages/authz/src';
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

function grant(permission: PermissionGrant['permission']): PermissionGrant {
  return { permission, scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspace }, sourceRef: `grant:${permission}` };
}
function context(grants: readonly PermissionGrant[]): ExecutionContext {
  return {
    actorUserId: internalId('user_engine_001', 'User'),
    actorOrganizationId: organization,
    actorOrganizationType: 'STANDALONE_MERCHANT',
    membershipId: internalId('membership_engine_001', 'Membership'),
    membershipStatus: operationalStatus('ACTIVE'),
    activeMerchantWorkspaceId: workspace,
    permissionSnapshotRef: 'perm-snapshot-engine',
    permissionGrants: grants,
    assuranceLevel: 'STANDARD', channel: 'web',
    requestId: internalId('request_engine_001', 'Request'),
    runId: internalId('run_engine_001', 'Run'),
    locale: localeTag('tr-TR'), occurredAt: now,
  };
}
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

const cases: Array<[string, () => void]> = [
  ['PLAN-UNREGISTERED-THROWS', () => expectThrow(() => stagedActionPlan({
    actionPlanId: planId, merchantWorkspaceId: workspace, actionName: 'arbitrary.http', requestedMaturity: 'READ', inputSchemaVersion: '1', payloadHash: 'x', exactPayloadRef: 'x', evidenceRefs: [], idempotencyKey: idempotencyKey('x'), createdAt: now,
  }), 'unregistered plan accepted')],
  ['PLAN-SCHEMA-VERSION-MISMATCH-THROWS', () => expectThrow(() => stagedActionPlan({
    actionPlanId: planId, merchantWorkspaceId: workspace, actionName: 'conversation.reply.send', requestedMaturity: 'APPLY_GOVERNED', inputSchemaVersion: '999', payloadHash: 'sha256:x', exactPayloadRef: 'payload:x', evidenceRefs: [], idempotencyKey: idempotencyKey('schema-mismatch'), createdAt: now,
  }), 'stale input schema version accepted')],
  ['EXECUTION-STALE-SCHEMA-VERSION-DENY', () => {
    const stalePlan = { ...sendPlan(), inputSchemaVersion: '999' };
    const result = prepareActionExecution({ plan: stalePlan, executionContext: context([grant('conversation:respond')]), target, capability: sendCapability, integrationId: integration, policyApprovalRequired: false, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send')] });
    assert(result.decision === 'DENY' && result.reason === 'ACTION_INPUT_SCHEMA_VERSION_STALE', 'stale planned schema reached execution');
  }],
  ['R3-WITHOUT-APPROVAL-RETURNS-APPROVAL-REQUIRED', () => {
    const result = prepareActionExecution({ plan: sendPlan(), executionContext: context([grant('conversation:respond')]), target, capability: sendCapability, integrationId: integration, policyApprovalRequired: true, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send')] });
    assert(result.decision === 'APPROVAL_REQUIRED', 'approval requirement bypassed');
  }],
  ['APPROVAL-MUTATED-PAYLOAD-DENY', () => {
    const result = prepareActionExecution({ plan: sendPlan('sha256:mutated'), executionContext: context([grant('conversation:respond')]), target, capability: sendCapability, integrationId: integration, policyApprovalRequired: true, approval: validApproval, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send')] });
    assert(result.decision === 'DENY' && result.reason.includes('PAYLOAD_HASH_MISMATCH'), 'mutated approval payload accepted');
  }],
  ['VALID-APPROVAL-AND-SAFETY-GATE-EXECUTION-READY', () => {
    const result = prepareActionExecution({ plan: sendPlan(), executionContext: context([grant('conversation:respond')]), target, capability: sendCapability, integrationId: integration, policyApprovalRequired: true, approval: validApproval, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send')] });
    assert(result.decision === 'EXECUTION_READY' && result.postReadRequired, 'valid governed action not ready');
  }],
  ['KILL-SWITCH-STOP-DENY', () => {
    const stopped = { ...allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send'), state: 'STOP' as const };
    const result = prepareActionExecution({ plan: sendPlan(), executionContext: context([grant('conversation:respond')]), target, capability: sendCapability, integrationId: integration, policyApprovalRequired: false, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [stopped] });
    assert(result.decision === 'DENY' && result.reason.includes('KILL_SWITCH_ACTIVE'), 'kill switch ignored');
  }],
  ['MISSING-KILL-SWITCH-DENY', () => {
    const result = prepareActionExecution({ plan: sendPlan(), executionContext: context([grant('conversation:respond')]), target, capability: sendCapability, integrationId: integration, policyApprovalRequired: false, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [] });
    assert(result.decision === 'DENY' && result.reason.includes('KILL_SWITCH_UNVERIFIED'), 'missing kill switch default-allowed');
  }],
  ['UNKNOWN-CAPABILITY-DENY-BEFORE-READY', () => {
    const result = prepareActionExecution({ plan: sendPlan(), executionContext: context([grant('conversation:respond')]), target, capability: { merchantWorkspaceId: workspace, integrationId: integration, capabilityKey: 'whatsapp.send_message', supportState: 'UNKNOWN' }, integrationId: integration, policyApprovalRequired: false, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send')] });
    assert(result.decision === 'DENY' && result.reason.includes('CAPABILITY_NOT_AVAILABLE'), 'unknown capability reached ready state');
  }],
  ['CAPABILITY-WRONG-WORKSPACE-DENY', () => {
    const result = prepareActionExecution({ plan: sendPlan(), executionContext: context([grant('conversation:respond')]), target, capability: { ...sendCapability, merchantWorkspaceId: internalId('mw_cap_other', 'MerchantWorkspace') }, integrationId: integration, policyApprovalRequired: false, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send')] });
    assert(result.decision === 'DENY' && result.reason.includes('CAPABILITY_WORKSPACE_MISMATCH'), 'cross-workspace capability reached execution');
  }],
  ['CAPABILITY-WRONG-INTEGRATION-DENY', () => {
    const result = prepareActionExecution({ plan: sendPlan(), executionContext: context([grant('conversation:respond')]), target, capability: { ...sendCapability, integrationId: internalId('integration_cap_other', 'Integration') }, integrationId: integration, policyApprovalRequired: false, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send')] });
    assert(result.decision === 'DENY' && result.reason.includes('CAPABILITY_INTEGRATION_MISMATCH'), 'cross-integration capability reached execution');
  }],
  ['WRONG-WORKSPACE-APPROVAL-DENY', () => {
    const wrong = { ...validApproval, merchantWorkspaceId: internalId('mw_other', 'MerchantWorkspace') };
    const result = prepareActionExecution({ plan: sendPlan(), executionContext: context([grant('conversation:respond')]), target, capability: sendCapability, integrationId: integration, policyApprovalRequired: true, approval: wrong, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [allowSwitch('KS-OUTBOUND-MESSAGE','conversation.reply.send')] });
    assert(result.decision === 'DENY' && result.reason.includes('APPROVAL_WORKSPACE_MISMATCH'), 'wrong-workspace approval accepted');
  }],
  ['R4-EXPORT-UNMAPPED-EXTERNAL-EFFECT-DENY', () => {
    const exportPlanId = internalId('plan_export_001', 'ActionPlan');
    const plan = stagedActionPlan({ actionPlanId: exportPlanId, merchantWorkspaceId: workspace, actionName: 'customer.export', requestedMaturity: 'APPLY_GOVERNED', inputSchemaVersion: '1', payloadHash: 'sha256:export', exactPayloadRef: 'export:scope:customer-001', evidenceRefs: ['verification:cv3'], idempotencyKey: idempotencyKey('mw:customer.export:001'), createdAt: now });
    const approval = { approvalRequestId: internalId('approval_export_001', 'ApprovalRequest'), actionPlanId: exportPlanId, merchantWorkspaceId: workspace, payloadHash: 'sha256:export', status: 'APPROVED' as const, expiresAt: utcTimestamp('2026-08-07T21:00:00Z') };
    const result = prepareActionExecution({ plan, executionContext: context([grant('customer:export')]), target, policyApprovalRequired: false, approval, now, environment: 'STAGING', configVersion: 'cfg-1', releaseFlagEnabled: true, switches: [] });
    assert(result.decision === 'DENY' && result.reason === 'UNMAPPED_EXTERNAL_EFFECT', 'unmapped external effect bypassed safety layer');
  }],
];
for (const [name, fn] of cases) { fn(); console.log(`PASS ${name}`); }
console.log(`PASS ${cases.length}/${cases.length} action engine scenarios`);
