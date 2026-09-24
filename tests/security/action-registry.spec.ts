import {
  resolveActionAuthority,
  type CapabilityAuthoritySnapshot,
  type ExecutionContext,
  type PermissionGrant,
} from '../../packages/authz/src';
import {
  internalId,
  localeTag,
  operationalStatus,
  utcTimestamp,
} from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspace = internalId('mw_action_001', 'MerchantWorkspace');
const organization = internalId('org_action_001', 'Organization');
const integration = internalId('integration_action_001', 'Integration');
const now = utcTimestamp('2026-08-07T19:00:00Z');

function context(grants: readonly PermissionGrant[]): ExecutionContext {
  return {
    actorUserId: internalId('user_action_001', 'User'),
    actorOrganizationId: organization,
    actorOrganizationType: 'STANDALONE_MERCHANT',
    membershipId: internalId('membership_action_001', 'Membership'),
    membershipStatus: operationalStatus('ACTIVE'),
    activeMerchantWorkspaceId: workspace,
    permissionSnapshotRef: 'perm-snapshot-001',
    permissionGrants: grants,
    assuranceLevel: 'STANDARD',
    channel: 'web',
    requestId: internalId('request_action_001', 'Request'),
    runId: internalId('run_action_001', 'Run'),
    locale: localeTag('tr-TR'),
    occurredAt: now,
  };
}

function grant(permission: PermissionGrant['permission']): PermissionGrant {
  return {
    permission,
    scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspace },
    sourceRef: `grant:${permission}`,
  };
}

const target = {
  owningOrganizationId: organization,
  merchantWorkspaceId: workspace,
  resourceType: 'merchant_workspace',
  resourceId: workspace as string,
};

const productAvailable: CapabilityAuthoritySnapshot = {
  merchantWorkspaceId: workspace,
  integrationId: integration,
  capabilityKey: 'commerce.get_product',
  supportState: 'AVAILABLE',
  evidenceRef: 'provider-evidence-product-read',
};
const sendAvailable: CapabilityAuthoritySnapshot = {
  merchantWorkspaceId: workspace,
  integrationId: integration,
  capabilityKey: 'whatsapp.send_message',
  supportState: 'AVAILABLE',
  evidenceRef: 'provider-evidence-whatsapp-send',
};

const cases: Array<[string, () => void]> = [
  ['UNREGISTERED-ACTION-DENY', () => {
    const result = resolveActionAuthority({
      actionName: 'switch_tenant', requestedMaturity: 'READ', executionContext: context([grant('merchant:read')]), target,
    });
    assert(result.decision === 'DENY' && result.reason === 'UNREGISTERED_ACTION', 'unregistered action not denied');
  }],
  ['R1-READ-ALLOW-WITH-AUTHZ-AND-CAPABILITY', () => {
    const result = resolveActionAuthority({
      actionName: 'commerce.product.read', requestedMaturity: 'READ', executionContext: context([grant('commerce.product:read')]), target, capability: productAvailable, integrationId: integration,
    });
    assert(result.decision === 'ALLOW' && result.definition.riskClass === 'R1', 'R1 read not allowed');
  }],
  ['R1-CANNOT-ESCALATE-TO-APPLY', () => {
    const result = resolveActionAuthority({
      actionName: 'commerce.product.read', requestedMaturity: 'APPLY_GOVERNED', executionContext: context([grant('commerce.product:read')]), target, capability: productAvailable, integrationId: integration,
    });
    assert(result.decision === 'DENY' && result.reason === 'MATURITY_CEILING_EXCEEDED', 'R1 maturity escalation allowed');
  }],
  ['R2-DRAFT-ALLOW', () => {
    const result = resolveActionAuthority({
      actionName: 'conversation.reply.prepare', requestedMaturity: 'DRAFT_PREVIEW', executionContext: context([grant('conversation:respond')]), target,
    });
    assert(result.decision === 'ALLOW' && result.definition.riskClass === 'R2', 'R2 draft not allowed');
  }],
  ['R3-SEND-UNKNOWN-CAPABILITY-DENY', () => {
    const result = resolveActionAuthority({
      actionName: 'conversation.reply.send', requestedMaturity: 'APPLY_GOVERNED', executionContext: context([grant('conversation:respond')]), target, integrationId: integration,
      capability: { merchantWorkspaceId: workspace, integrationId: integration, capabilityKey: 'whatsapp.send_message', supportState: 'UNKNOWN' }, policyApprovalRequired: false,
    });
    assert(result.decision === 'DENY' && result.reason === 'CAPABILITY_NOT_AVAILABLE', 'UNKNOWN send capability allowed');
  }],
  ['R3-SEND-POLICY-APPROVAL', () => {
    const result = resolveActionAuthority({
      actionName: 'conversation.reply.send', requestedMaturity: 'APPLY_GOVERNED', executionContext: context([grant('conversation:respond')]), target, integrationId: integration,
      capability: sendAvailable, policyApprovalRequired: true,
    });
    assert(result.decision === 'APPROVAL_REQUIRED' && result.definition.riskClass === 'R3', 'R3 policy approval not required');
  }],
  ['R3-SEND-POLICY-AUTO-ALLOW', () => {
    const result = resolveActionAuthority({
      actionName: 'conversation.reply.send', requestedMaturity: 'APPLY_GOVERNED', executionContext: context([grant('conversation:respond')]), target, integrationId: integration,
      capability: sendAvailable, policyApprovalRequired: false,
    });
    assert(result.decision === 'ALLOW', 'bounded R3 service send not allowed after all gates');
  }],
  ['CAPABILITY-WRONG-WORKSPACE-DENY', () => {
    const result = resolveActionAuthority({
      actionName: 'commerce.product.read', requestedMaturity: 'READ', executionContext: context([grant('commerce.product:read')]), target, integrationId: integration,
      capability: { ...productAvailable, merchantWorkspaceId: internalId('mw_capability_other', 'MerchantWorkspace') },
    });
    assert(result.decision === 'DENY' && result.reason === 'CAPABILITY_WORKSPACE_MISMATCH', 'cross-workspace capability evidence accepted');
  }],
  ['CAPABILITY-WRONG-INTEGRATION-DENY', () => {
    const result = resolveActionAuthority({
      actionName: 'commerce.product.read', requestedMaturity: 'READ', executionContext: context([grant('commerce.product:read')]), target, integrationId: integration,
      capability: { ...productAvailable, integrationId: internalId('integration_other', 'Integration') },
    });
    assert(result.decision === 'DENY' && result.reason === 'CAPABILITY_INTEGRATION_MISMATCH', 'cross-integration capability evidence accepted');
  }],
  ['CAPABILITY-MISSING-INTEGRATION-CONTEXT-DENY', () => {
    const result = resolveActionAuthority({
      actionName: 'commerce.product.read', requestedMaturity: 'READ', executionContext: context([grant('commerce.product:read')]), target, capability: productAvailable,
    });
    assert(result.decision === 'DENY' && result.reason === 'CAPABILITY_INTEGRATION_MISMATCH', 'capability used without exact integration context');
  }],
  ['R4-CUSTOMER-EXPORT-ALWAYS-APPROVAL', () => {
    const result = resolveActionAuthority({
      actionName: 'customer.export', requestedMaturity: 'APPLY_GOVERNED', executionContext: context([grant('customer:export')]), target, policyApprovalRequired: false,
    });
    assert(result.decision === 'APPROVAL_REQUIRED' && result.definition.riskClass === 'R4', 'R4 export bypassed approval');
  }],
  ['AUTHZ-DENY-BEFORE-ACTION-ALLOW', () => {
    const result = resolveActionAuthority({
      actionName: 'conversation.reply.prepare', requestedMaturity: 'DRAFT_PREVIEW', executionContext: context([]), target,
    });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORIZATION_DENIED', 'missing permission bypassed');
  }],
  ['CAPABILITY-EVIDENCE-REQUIRED', () => {
    const result = resolveActionAuthority({
      actionName: 'commerce.product.read', requestedMaturity: 'READ', executionContext: context([grant('commerce.product:read')]), target, integrationId: integration,
      capability: { merchantWorkspaceId: workspace, integrationId: integration, capabilityKey: 'commerce.get_product', supportState: 'AVAILABLE' },
    });
    assert(result.decision === 'DENY' && result.reason === 'CAPABILITY_NOT_AVAILABLE', 'AVAILABLE without evidence ref accepted');
  }],
];

for (const [name, fn] of cases) { fn(); console.log(`PASS ${name}`); }
console.log(`PASS ${cases.length}/${cases.length} action registry scenarios`);
