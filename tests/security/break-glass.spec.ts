import { internalId, localeTag, operationalStatus, utcTimestamp } from '../../packages/domain/src';
import {
  evaluateBreakGlassActivation,
  evaluateBreakGlassUse,
  revokeBreakGlass,
  type BreakGlassPolicy,
  type ExecutionContext,
} from '../../packages/authz/src';

const now = utcTimestamp('2026-08-09T07:00:00Z');
const in20 = utcTimestamp('2026-08-09T07:20:00Z');
const in90 = utcTimestamp('2026-08-09T08:30:00Z');
const expired = utcTimestamp('2026-08-09T06:59:59Z');
const wsA = internalId('bg-ws-a', 'MerchantWorkspace');
const wsB = internalId('bg-ws-b', 'MerchantWorkspace');
const platformOrg = internalId('bg-platform-org', 'Organization');
const merchantOrg = internalId('bg-merchant-org', 'Organization');
const actor = internalId('bg-support-user', 'User');
const approver = internalId('bg-security-approver', 'User');

const base: ExecutionContext = {
  actorUserId: actor,
  actorOrganizationId: platformOrg,
  actorOrganizationType: 'PLATFORM_INTERNAL',
  membershipId: internalId('bg-membership', 'Membership'),
  membershipStatus: operationalStatus('ACTIVE'),
  activeMerchantWorkspaceId: null,
  permissionSnapshotRef: 'break-glass:ordinary-permissions-not-authority',
  permissionGrants: [],
  assuranceLevel: 'STRONG',
  channel: 'internal',
  requestId: internalId('bg-request', 'Request'),
  runId: internalId('bg-run', 'Run'),
  locale: localeTag('tr-TR'),
  occurredAt: now,
};

const targetA = {
  owningOrganizationId: merchantOrg,
  merchantWorkspaceId: wsA,
  resourceType: 'conversation',
  resourceId: 'conv-a',
} as const;
const targetB = { ...targetA, merchantWorkspaceId: wsB, resourceId: 'conv-b' } as const;

const policy: BreakGlassPolicy = {
  enabled: true,
  policyRef: 'security-policy:break-glass-v1',
  maxDurationMinutes: 30,
  allowedPermissions: ['conversation:read', 'conversation:respond'],
};

const activation = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'bg-event-activate',
  grantId: 'bg-grant-1',
  executionContext: base,
  target: targetA,
  requestedPermissions: ['conversation:read'] as const,
  incidentRef: 'incident:42',
  reasonRef: 'reason:incident-recovery',
  approvalRef: 'approval:bg-1',
  approvedByUserId: approver,
  now,
  expiresAt: in20,
  policy,
  ...overrides,
});

const allowed = evaluateBreakGlassActivation(activation());
if (allowed.decision !== 'ALLOW') throw new Error('baseline break-glass activation must allow');
const grant = allowed.grant;

const scenarios = [
  {
    id: 'TM-14-ORDINARY-MERCHANT-CANNOT-ACTIVATE-BREAK-GLASS',
    actual: evaluateBreakGlassActivation(activation({ executionContext: { ...base, actorOrganizationType: 'STANDALONE_MERCHANT' } as ExecutionContext })).decision,
    expected: 'DENY',
  },
  {
    id: 'TM-14-WEAK-ASSURANCE-CANNOT-ACTIVATE-BREAK-GLASS',
    actual: evaluateBreakGlassActivation(activation({ executionContext: { ...base, assuranceLevel: 'STEP_UP' } as ExecutionContext })).decision,
    expected: 'DENY',
  },
  {
    id: 'TM-14-DISABLED-POLICY-DENIES-ACTIVATION',
    actual: evaluateBreakGlassActivation(activation({ policy: { ...policy, enabled: false } })).decision,
    expected: 'DENY',
  },
  {
    id: 'TM-14-PERMISSION-OUTSIDE-POLICY-DENIED',
    actual: evaluateBreakGlassActivation(activation({ requestedPermissions: ['commerce.order:refund'] })).decision,
    expected: 'DENY',
  },
  {
    id: 'TM-14-DURATION-BEYOND-POLICY-DENIED',
    actual: evaluateBreakGlassActivation(activation({ expiresAt: in90 })).decision,
    expected: 'DENY',
  },
  { id: 'TM-14-BOUNDED-STRONG-INTERNAL-ACTIVATION-ALLOWED', actual: allowed.decision, expected: 'ALLOW' },
  {
    id: 'TM-14-SCOPED-GRANT-USE-ALLOWED',
    actual: evaluateBreakGlassUse({ eventId: 'bg-use-1', grant, executionContext: base, target: targetA, requiredPermission: 'conversation:read', now }).decision,
    expected: 'ALLOW',
  },
  {
    id: 'TM-14-CROSS-WORKSPACE-BREAK-GLASS-DENIED',
    actual: evaluateBreakGlassUse({ eventId: 'bg-use-2', grant, executionContext: base, target: targetB, requiredPermission: 'conversation:read', now }).decision,
    expected: 'DENY',
  },
  {
    id: 'TM-14-EXPIRED-BREAK-GLASS-DENIED',
    actual: evaluateBreakGlassUse({ eventId: 'bg-use-3', grant: { ...grant, expiresAt: expired }, executionContext: base, target: targetA, requiredPermission: 'conversation:read', now }).decision,
    expected: 'DENY',
  },
  {
    id: 'TM-14-UNGRANTED-PERMISSION-DENIED',
    actual: evaluateBreakGlassUse({ eventId: 'bg-use-4', grant, executionContext: base, target: targetA, requiredPermission: 'conversation:respond', now }).decision,
    expected: 'DENY',
  },
] as const;

for (const scenario of scenarios) {
  if (scenario.actual !== scenario.expected) throw new Error(`${scenario.id}: ${scenario.actual} != ${scenario.expected}`);
  console.log(`PASS ${scenario.id}`);
}

const revoked = revokeBreakGlass({
  eventId: 'bg-revoke-1',
  grant,
  executionContext: base,
  now,
  reasonRef: 'reason:incident-resolved',
});
if (revoked.decision !== 'ALLOW') throw new Error('break-glass revoke must allow for strong internal actor');
const afterRevoke = evaluateBreakGlassUse({
  eventId: 'bg-use-5',
  grant: revoked.grant,
  executionContext: base,
  target: targetA,
  requiredPermission: 'conversation:read',
  now,
});
if (afterRevoke.decision !== 'DENY') throw new Error('revoked break-glass grant must deny future use');
console.log('PASS TM-14-REVOCATION-DISABLES-FUTURE-USE');
console.log('PASS 11/11 break-glass security scenarios');
