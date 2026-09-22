import { internalId, idempotencyKey, localeTag, operationalStatus, utcTimestamp } from '../../packages/domain/src';
import type { ExecutionContext, PermissionGrant } from '../../packages/authz/src';
import { stagedActionPlan, prepareActionExecution } from '../../apps/api/src/action-engine';
import { revalidateBeforeDispatch } from '../../apps/api/src/dispatch-safety';
import type { SafetySwitchSnapshot } from '../../apps/api/src/runtime-config';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspace = internalId('mw_dispatch_001', 'MerchantWorkspace');
const organization = internalId('org_dispatch_001', 'Organization');
const integration = internalId('integration_dispatch_001', 'Integration');
const prepareTime = utcTimestamp('2026-08-19T09:00:00Z');
const dispatchTime = utcTimestamp('2026-08-19T09:05:00Z');
const planId = internalId('plan_dispatch_001', 'ActionPlan');
const target = { owningOrganizationId: organization, merchantWorkspaceId: workspace, resourceType: 'conversation', resourceId: 'conv_dispatch_001' };

function grant(permission: PermissionGrant['permission']): PermissionGrant {
  return { permission, scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspace }, sourceRef: `grant:${permission}` };
}
function context(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    actorUserId: internalId('user_dispatch_001', 'User'),
    actorOrganizationId: organization,
    actorOrganizationType: 'STANDALONE_MERCHANT',
    membershipId: internalId('membership_dispatch_001', 'Membership'),
    membershipStatus: operationalStatus('ACTIVE'),
    activeMerchantWorkspaceId: workspace,
    permissionSnapshotRef: 'perm-snapshot-dispatch',
    permissionGrants: [grant('conversation:respond')],
    assuranceLevel: 'STANDARD',
    channel: 'web',
    requestId: internalId('request_dispatch_001', 'Request'),
    runId: internalId('run_dispatch_001', 'Run'),
    locale: localeTag('tr-TR'),
    occurredAt: prepareTime,
    ...overrides,
  };
}
function switchSnapshot(state: SafetySwitchSnapshot['state'], verifiedAt = dispatchTime): SafetySwitchSnapshot {
  return {
    key: 'KS-OUTBOUND-MESSAGE',
    scope: { environment: 'STAGING', merchantWorkspaceId: workspace, operation: 'conversation.reply.send' },
    state,
    configVersion: 'cfg-1',
    verifiedAt,
    sourceRef: 'switch:KS-OUTBOUND-MESSAGE',
  };
}
const sendCapability = {
  merchantWorkspaceId: workspace,
  integrationId: integration,
  capabilityKey: 'whatsapp.send_message',
  supportState: 'AVAILABLE' as const,
  evidenceRef: 'meta-test-evidence-dispatch',
};
function plan(hash = 'sha256:dispatch-payload-v1') {
  return stagedActionPlan({
    actionPlanId: planId,
    merchantWorkspaceId: workspace,
    actionName: 'conversation.reply.send',
    requestedMaturity: 'APPLY_GOVERNED',
    inputSchemaVersion: '1',
    payloadHash: hash,
    exactPayloadRef: 'payload:safe-ref-dispatch-001',
    evidenceRefs: ['factset:dispatch-001'],
    idempotencyKey: idempotencyKey('mw:conversation.reply.send:dispatch-001'),
    createdAt: prepareTime,
  });
}
function approval(status: 'APPROVED' | 'EXPIRED' | 'REJECTED' = 'APPROVED', hash = 'sha256:dispatch-payload-v1') {
  return {
    approvalRequestId: internalId('approval_dispatch_001', 'ApprovalRequest'),
    actionPlanId: planId,
    merchantWorkspaceId: workspace,
    payloadHash: hash,
    status,
    expiresAt: utcTimestamp('2026-08-19T10:00:00Z'),
  };
}

function baseSafetyInput(overrides: Record<string, unknown> = {}) {
  return {
    actionName: 'conversation.reply.send',
    requestedMaturity: 'APPLY_GOVERNED' as const,
    executionContext: context(),
    target,
    capability: sendCapability,
    integrationId: integration,
    policyApprovalRequired: true,
    approval: approval(),
    actionPlanId: planId,
    payloadHash: 'sha256:dispatch-payload-v1',
    merchantWorkspaceId: workspace,
    now: dispatchTime,
    environment: 'STAGING' as const,
    configVersion: 'cfg-1',
    releaseFlagEnabled: true,
    switches: [switchSnapshot('ALLOW')],
    ...overrides,
  };
}

const cases: Array<[string, () => void]> = [
  [
    'DISPATCH-01-PREPARE-READY-THEN-REVALIDATE-STILL-ALLOWS-WHEN-NOTHING-CHANGED',
    () => {
      const prepared = prepareActionExecution({
        plan: plan(),
        executionContext: context(),
        target,
        capability: sendCapability,
        integrationId: integration,
        policyApprovalRequired: true,
        approval: approval(),
        now: prepareTime,
        environment: 'STAGING',
        configVersion: 'cfg-1',
        releaseFlagEnabled: true,
        switches: [switchSnapshot('ALLOW', prepareTime)],
      });
      assert(prepared.decision === 'EXECUTION_READY', 'setup: plan must be execution-ready before dispatch');

      const revalidated = revalidateBeforeDispatch(baseSafetyInput());
      assert(revalidated.decision === 'ALLOW', 'unchanged state must still revalidate ALLOW at dispatch time');
    },
  ],
  [
    'DISPATCH-02-KILL-SWITCH-FLIPPED-AFTER-PREPARE-DENIES-AT-DISPATCH',
    () => {
      const prepared = prepareActionExecution({
        plan: plan(),
        executionContext: context(),
        target,
        capability: sendCapability,
        integrationId: integration,
        policyApprovalRequired: true,
        approval: approval(),
        now: prepareTime,
        environment: 'STAGING',
        configVersion: 'cfg-1',
        releaseFlagEnabled: true,
        switches: [switchSnapshot('ALLOW', prepareTime)],
      });
      assert(prepared.decision === 'EXECUTION_READY', 'setup: prepare-time check must have passed');

      // Between prepare and dispatch an operator flips the kill switch to STOP.
      const revalidated = revalidateBeforeDispatch(baseSafetyInput({ switches: [switchSnapshot('STOP')] }));
      assert(
        revalidated.decision === 'DENY' && revalidated.reason.includes('KILL_SWITCH_ACTIVE'),
        'I3/RG-AUTH-RACE: a kill switch flipped after prepare must be caught immediately before dispatch',
      );
    },
  ],
  [
    'DISPATCH-03-APPROVAL-EXPIRED-BEFORE-RETRY-DENIES',
    () => {
      const revalidated = revalidateBeforeDispatch(baseSafetyInput({ approval: approval('EXPIRED') }));
      assert(
        revalidated.decision === 'DENY' && revalidated.reason.includes('APPROVAL'),
        'an approval that expired before a retried dispatch must be caught, not reused from prepare time',
      );
    },
  ],
  [
    'DISPATCH-04-MEMBERSHIP-DEACTIVATED-BEFORE-DISPATCH-DENIES',
    () => {
      const revalidated = revalidateBeforeDispatch(
        baseSafetyInput({ executionContext: context({ membershipStatus: operationalStatus('SUSPENDED') }) }),
      );
      assert(
        revalidated.decision === 'DENY' && revalidated.reason.includes('ACTION_AUTHORITY'),
        'a membership deactivated before dispatch must fail closed, not inherit the earlier ALLOW',
      );
    },
  ],
  [
    'DISPATCH-05-NEWLY-REQUIRED-APPROVAL-FAILS-CLOSED-NOT-PAUSED',
    () => {
      const revalidated = revalidateBeforeDispatch(baseSafetyInput({ approval: undefined }));
      assert(
        revalidated.decision === 'DENY' && revalidated.reason.startsWith('APPROVAL_REQUIRED_AT_DISPATCH:'),
        'dispatch/retry time cannot pause for approval; a missing approval must fail closed',
      );
    },
  ],
  [
    'DISPATCH-06-CAPABILITY-SUPPORT-LOST-BEFORE-DISPATCH-DENIES',
    () => {
      const revalidated = revalidateBeforeDispatch(
        baseSafetyInput({ capability: { ...sendCapability, supportState: 'UNKNOWN' } }),
      );
      assert(
        revalidated.decision === 'DENY' && revalidated.reason.includes('CAPABILITY_NOT_AVAILABLE'),
        'a provider capability that regressed before dispatch must be caught',
      );
    },
  ],
];

for (const [name, fn] of cases) { fn(); console.log(`PASS ${name}`); }
console.log(`PASS ${cases.length}/${cases.length} dispatch safety scenarios`);
