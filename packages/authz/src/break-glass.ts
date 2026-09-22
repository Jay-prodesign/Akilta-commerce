import type { ExecutionContext, ServerResolvedResourceContext } from './types';

type Permission = ExecutionContext['permissionGrants'][number]['permission'];
type UtcTimestamp = ExecutionContext['occurredAt'];
type UserId = ExecutionContext['actorUserId'];
type MerchantWorkspaceId = NonNullable<ExecutionContext['activeMerchantWorkspaceId']>;

export type BreakGlassGrantState = 'ACTIVE' | 'REVOKED';

export interface BreakGlassPolicy {
  readonly enabled: boolean;
  readonly policyRef: string;
  readonly maxDurationMinutes: number;
  readonly allowedPermissions: readonly Permission[];
}

export interface BreakGlassGrant {
  readonly grantId: string;
  readonly state: BreakGlassGrantState;
  readonly incidentRef: string;
  readonly reasonRef: string;
  readonly approvalRef: string;
  readonly policyRef: string;
  readonly actorUserId: UserId;
  readonly approvedByUserId: UserId;
  readonly targetMerchantWorkspaceId: MerchantWorkspaceId;
  readonly permissions: readonly Permission[];
  readonly activatedAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
  readonly revokedAt?: UtcTimestamp;
  readonly revokedByUserId?: UserId;
  readonly revocationReasonRef?: string;
}

export type BreakGlassEventType =
  | 'ACTIVATION_ALLOWED'
  | 'ACTIVATION_DENIED'
  | 'USE_ALLOWED'
  | 'USE_DENIED'
  | 'REVOKED'
  | 'REVOCATION_DENIED';

export interface BreakGlassEvent {
  readonly eventId: string;
  readonly eventType: BreakGlassEventType;
  readonly grantId: string;
  readonly incidentRef: string;
  readonly actorUserId: UserId;
  readonly targetMerchantWorkspaceId: MerchantWorkspaceId;
  readonly occurredAt: UtcTimestamp;
  readonly permission?: Permission;
  readonly decisionReason?: BreakGlassDenyReason;
  readonly approvalRef?: string;
  readonly policyRef?: string;
}

export type BreakGlassDenyReason =
  | 'BREAK_GLASS_DISABLED'
  | 'PLATFORM_INTERNAL_REQUIRED'
  | 'INTERNAL_CHANNEL_REQUIRED'
  | 'STRONG_ASSURANCE_REQUIRED'
  | 'ACTIVE_MEMBERSHIP_REQUIRED'
  | 'IDENTIFIER_OR_EVIDENCE_REFERENCE_REQUIRED'
  | 'PERMISSION_REQUIRED'
  | 'PERMISSION_OUTSIDE_POLICY'
  | 'INVALID_POLICY_DURATION'
  | 'INVALID_TIME_WINDOW'
  | 'DURATION_EXCEEDS_POLICY'
  | 'GRANT_NOT_ACTIVE'
  | 'GRANT_EXPIRED'
  | 'ACTOR_MISMATCH'
  | 'WORKSPACE_SCOPE_MISMATCH'
  | 'PERMISSION_NOT_GRANTED';

export interface BreakGlassActivationRequest {
  readonly eventId: string;
  readonly grantId: string;
  readonly executionContext: ExecutionContext;
  readonly target: ServerResolvedResourceContext;
  readonly requestedPermissions: readonly Permission[];
  readonly incidentRef: string;
  readonly reasonRef: string;
  readonly approvalRef: string;
  readonly approvedByUserId: UserId;
  readonly now: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
  readonly policy: BreakGlassPolicy;
}

export type BreakGlassActivationDecision =
  | { readonly decision: 'ALLOW'; readonly grant: BreakGlassGrant; readonly event: BreakGlassEvent }
  | { readonly decision: 'DENY'; readonly reason: BreakGlassDenyReason; readonly event: BreakGlassEvent };

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function timestampMs(value: UtcTimestamp): number {
  return Date.parse(value as string);
}

function privilegedContextDenyReason(context: ExecutionContext): BreakGlassDenyReason | null {
  if (context.actorOrganizationType !== 'PLATFORM_INTERNAL') return 'PLATFORM_INTERNAL_REQUIRED';
  if (context.channel !== 'internal') return 'INTERNAL_CHANNEL_REQUIRED';
  if (context.assuranceLevel !== 'STRONG') return 'STRONG_ASSURANCE_REQUIRED';
  if (context.membershipStatus !== 'ACTIVE') return 'ACTIVE_MEMBERSHIP_REQUIRED';
  return null;
}

function activationEvent(
  request: BreakGlassActivationRequest,
  eventType: 'ACTIVATION_ALLOWED' | 'ACTIVATION_DENIED',
  decisionReason?: BreakGlassDenyReason,
): BreakGlassEvent {
  return {
    eventId: request.eventId,
    eventType,
    grantId: request.grantId,
    incidentRef: request.incidentRef,
    actorUserId: request.executionContext.actorUserId,
    targetMerchantWorkspaceId: request.target.merchantWorkspaceId,
    occurredAt: request.now,
    decisionReason,
    approvalRef: request.approvalRef,
    policyRef: request.policy.policyRef,
  };
}

export function evaluateBreakGlassActivation(request: BreakGlassActivationRequest): BreakGlassActivationDecision {
  const deny = (reason: BreakGlassDenyReason): BreakGlassActivationDecision => ({
    decision: 'DENY',
    reason,
    event: activationEvent(request, 'ACTIVATION_DENIED', reason),
  });

  if (!request.policy.enabled) return deny('BREAK_GLASS_DISABLED');
  const privilegedDeny = privilegedContextDenyReason(request.executionContext);
  if (privilegedDeny) return deny(privilegedDeny);

  if (
    !nonEmpty(request.eventId) ||
    !nonEmpty(request.grantId) ||
    !nonEmpty(request.incidentRef) ||
    !nonEmpty(request.reasonRef) ||
    !nonEmpty(request.approvalRef) ||
    !nonEmpty(request.policy.policyRef)
  ) {
    return deny('IDENTIFIER_OR_EVIDENCE_REFERENCE_REQUIRED');
  }

  if (request.requestedPermissions.length === 0) return deny('PERMISSION_REQUIRED');
  const allowed = new Set<Permission>(request.policy.allowedPermissions);
  if (request.requestedPermissions.some((permission) => !allowed.has(permission))) {
    return deny('PERMISSION_OUTSIDE_POLICY');
  }

  if (!Number.isFinite(request.policy.maxDurationMinutes) || request.policy.maxDurationMinutes <= 0) {
    return deny('INVALID_POLICY_DURATION');
  }

  const nowMs = timestampMs(request.now);
  const expiresMs = timestampMs(request.expiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresMs) || expiresMs <= nowMs) {
    return deny('INVALID_TIME_WINDOW');
  }
  if (expiresMs - nowMs > request.policy.maxDurationMinutes * 60_000) {
    return deny('DURATION_EXCEEDS_POLICY');
  }

  const grant: BreakGlassGrant = {
    grantId: request.grantId,
    state: 'ACTIVE',
    incidentRef: request.incidentRef,
    reasonRef: request.reasonRef,
    approvalRef: request.approvalRef,
    policyRef: request.policy.policyRef,
    actorUserId: request.executionContext.actorUserId,
    approvedByUserId: request.approvedByUserId,
    targetMerchantWorkspaceId: request.target.merchantWorkspaceId,
    permissions: [...new Set(request.requestedPermissions)],
    activatedAt: request.now,
    expiresAt: request.expiresAt,
  };

  return { decision: 'ALLOW', grant, event: activationEvent(request, 'ACTIVATION_ALLOWED') };
}

export interface BreakGlassUseRequest {
  readonly eventId: string;
  readonly grant: BreakGlassGrant;
  readonly executionContext: ExecutionContext;
  readonly target: ServerResolvedResourceContext;
  readonly requiredPermission: Permission;
  readonly now: UtcTimestamp;
}

export type BreakGlassUseDecision =
  | { readonly decision: 'ALLOW'; readonly event: BreakGlassEvent }
  | { readonly decision: 'DENY'; readonly reason: BreakGlassDenyReason; readonly event: BreakGlassEvent };

function useEvent(
  request: BreakGlassUseRequest,
  eventType: 'USE_ALLOWED' | 'USE_DENIED',
  decisionReason?: BreakGlassDenyReason,
): BreakGlassEvent {
  return {
    eventId: request.eventId,
    eventType,
    grantId: request.grant.grantId,
    incidentRef: request.grant.incidentRef,
    actorUserId: request.executionContext.actorUserId,
    targetMerchantWorkspaceId: request.target.merchantWorkspaceId,
    occurredAt: request.now,
    permission: request.requiredPermission,
    decisionReason,
    approvalRef: request.grant.approvalRef,
    policyRef: request.grant.policyRef,
  };
}

export function evaluateBreakGlassUse(request: BreakGlassUseRequest): BreakGlassUseDecision {
  const deny = (reason: BreakGlassDenyReason): BreakGlassUseDecision => ({
    decision: 'DENY',
    reason,
    event: useEvent(request, 'USE_DENIED', reason),
  });

  const privilegedDeny = privilegedContextDenyReason(request.executionContext);
  if (privilegedDeny) return deny(privilegedDeny);
  if (!nonEmpty(request.eventId)) return deny('IDENTIFIER_OR_EVIDENCE_REFERENCE_REQUIRED');
  if (request.grant.state !== 'ACTIVE') return deny('GRANT_NOT_ACTIVE');
  if (request.executionContext.actorUserId !== request.grant.actorUserId) return deny('ACTOR_MISMATCH');
  if (request.target.merchantWorkspaceId !== request.grant.targetMerchantWorkspaceId) {
    return deny('WORKSPACE_SCOPE_MISMATCH');
  }
  const nowMs = timestampMs(request.now);
  const expiresMs = timestampMs(request.grant.expiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresMs) || nowMs >= expiresMs) return deny('GRANT_EXPIRED');
  if (!request.grant.permissions.includes(request.requiredPermission)) return deny('PERMISSION_NOT_GRANTED');

  return { decision: 'ALLOW', event: useEvent(request, 'USE_ALLOWED') };
}

export interface BreakGlassRevocationRequest {
  readonly eventId: string;
  readonly grant: BreakGlassGrant;
  readonly executionContext: ExecutionContext;
  readonly now: UtcTimestamp;
  readonly reasonRef: string;
}

export type BreakGlassRevocationDecision =
  | { readonly decision: 'ALLOW'; readonly grant: BreakGlassGrant; readonly event: BreakGlassEvent }
  | { readonly decision: 'DENY'; readonly reason: BreakGlassDenyReason; readonly event: BreakGlassEvent };

export function revokeBreakGlass(request: BreakGlassRevocationRequest): BreakGlassRevocationDecision {
  const eventBase = {
    eventId: request.eventId,
    grantId: request.grant.grantId,
    incidentRef: request.grant.incidentRef,
    actorUserId: request.executionContext.actorUserId,
    targetMerchantWorkspaceId: request.grant.targetMerchantWorkspaceId,
    occurredAt: request.now,
    approvalRef: request.grant.approvalRef,
    policyRef: request.grant.policyRef,
  } as const;
  const deny = (reason: BreakGlassDenyReason): BreakGlassRevocationDecision => ({
    decision: 'DENY',
    reason,
    event: { ...eventBase, eventType: 'REVOCATION_DENIED', decisionReason: reason },
  });

  const privilegedDeny = privilegedContextDenyReason(request.executionContext);
  if (privilegedDeny) return deny(privilegedDeny);
  if (!nonEmpty(request.eventId) || !nonEmpty(request.reasonRef)) return deny('IDENTIFIER_OR_EVIDENCE_REFERENCE_REQUIRED');
  if (request.grant.state !== 'ACTIVE') return deny('GRANT_NOT_ACTIVE');

  const grant: BreakGlassGrant = {
    ...request.grant,
    state: 'REVOKED',
    revokedAt: request.now,
    revokedByUserId: request.executionContext.actorUserId,
    revocationReasonRef: request.reasonRef,
  };
  return { decision: 'ALLOW', grant, event: { ...eventBase, eventType: 'REVOKED' } };
}
