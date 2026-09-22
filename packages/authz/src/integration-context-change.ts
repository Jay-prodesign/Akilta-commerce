import type { AgencyClientAssignment, MerchantWorkspaceId, UtcTimestamp } from '../../domain/src';
import { evaluateAuthorization } from './evaluator';
import type { Permission } from './permissions';
import type { ExecutionContext, ServerResolvedResourceContext } from './types';

export const INTEGRATION_CONTEXT_CHANGE_KINDS = [
  'CONNECT',
  'DISCONNECT',
  'RELINK',
  'SWITCH_ACCOUNT',
  'SWITCH_STORE',
  'REVOKE_ACCESS',
] as const;
export type IntegrationContextChangeKind = (typeof INTEGRATION_CONTEXT_CHANGE_KINDS)[number];

export type IntegrationContextAuthorizationSource =
  | 'EXPLICIT_OWNER'
  | 'GENERIC_CONTINUATION'
  | 'PROJECT_POLICY';

export interface SourceProjectInterferenceContext {
  readonly projectKey: string;
  readonly activity: 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
  readonly wouldBeDisrupted: boolean;
}

export interface IntegrationContextChangePlan {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly provider: string;
  readonly kind: IntegrationContextChangeKind;
  readonly currentContextRef: string;
  readonly targetContextRef: string;
  readonly authorizationSource: IntegrationContextAuthorizationSource;
  readonly ownerApprovalRef?: string;
  readonly approvedTargetContextRef?: string;
  readonly downstreamIntent: 'READ_ONLY' | 'WRITE';
  readonly sourceProject?: SourceProjectInterferenceContext;
  readonly requestedAt: UtcTimestamp;
}

export type IntegrationContextChangePreparation =
  | {
      readonly decision: 'READY';
      readonly plan: IntegrationContextChangePlan;
      readonly invalidatePriorCapabilityAuthority: true;
      readonly verifyTargetAfterChange: true;
      readonly downstreamAuthorityGranted: false;
    }
  | {
      readonly decision: 'DENY';
      readonly reason:
        | 'OWNER_APPROVAL_REQUIRED'
        | 'OWNER_APPROVAL_REF_REQUIRED'
        | 'APPROVED_TARGET_REQUIRED'
        | 'APPROVED_TARGET_MISMATCH'
        | 'INVALID_CONTEXT_BINDING'
        | 'SOURCE_PROJECT_NON_INTERFERENCE';
    };

export function prepareIntegrationContextChange(
  plan: IntegrationContextChangePlan,
): IntegrationContextChangePreparation {
  if (
    !plan.provider.trim() ||
    !plan.currentContextRef.trim() ||
    !plan.targetContextRef.trim()
  ) {
    return { decision: 'DENY', reason: 'INVALID_CONTEXT_BINDING' };
  }

  // A read-only downstream goal does not make connect/disconnect/relink/switch/revoke read-only.
  // Integration/account context changes always require explicit owner authorization.
  if (plan.authorizationSource !== 'EXPLICIT_OWNER') {
    return { decision: 'DENY', reason: 'OWNER_APPROVAL_REQUIRED' };
  }
  if (!plan.ownerApprovalRef?.trim()) {
    return { decision: 'DENY', reason: 'OWNER_APPROVAL_REF_REQUIRED' };
  }
  if (!plan.approvedTargetContextRef?.trim()) {
    return { decision: 'DENY', reason: 'APPROVED_TARGET_REQUIRED' };
  }
  if (plan.approvedTargetContextRef !== plan.targetContextRef) {
    return { decision: 'DENY', reason: 'APPROVED_TARGET_MISMATCH' };
  }

  const source = plan.sourceProject;
  if (
    source?.wouldBeDisrupted &&
    (source.activity === 'ACTIVE' || source.activity === 'UNKNOWN')
  ) {
    return { decision: 'DENY', reason: 'SOURCE_PROJECT_NON_INTERFERENCE' };
  }

  return {
    decision: 'READY',
    plan,
    invalidatePriorCapabilityAuthority: true,
    verifyTargetAfterChange: true,
    downstreamAuthorityGranted: false,
  };
}

const permissionsByKind: Readonly<Record<IntegrationContextChangeKind, readonly Permission[]>> = {
  CONNECT: ['integration:connect'],
  DISCONNECT: ['integration:disconnect'],
  RELINK: ['integration:disconnect', 'integration:connect'],
  SWITCH_ACCOUNT: ['integration:disconnect', 'integration:connect'],
  SWITCH_STORE: ['integration:disconnect', 'integration:connect'],
  REVOKE_ACCESS: ['integration:disconnect'],
};

export type IntegrationContextChangeAuthorityDecision =
  | {
      readonly decision: 'READY';
      readonly prepared: Extract<IntegrationContextChangePreparation, { decision: 'READY' }>;
      readonly matchedPermissions: readonly Permission[];
    }
  | {
      readonly decision: 'DENY';
      readonly reason:
        | Extract<IntegrationContextChangePreparation, { decision: 'DENY' }>['reason']
        | 'PLAN_WORKSPACE_MISMATCH'
        | 'AUTHORIZATION_DENIED';
      readonly detail?: string;
    };

/**
 * Integration context changes have two independent authority layers:
 * 1) deterministic tenant/permission authorization; and
 * 2) the D-057 explicit-owner/exact-target/non-interference context-change contract.
 * Neither layer can substitute for the other, and a READY result still grants no downstream store mutation authority.
 */
export function resolveIntegrationContextChangeAuthority(input: {
  readonly plan: IntegrationContextChangePlan;
  readonly executionContext: ExecutionContext;
  readonly target: ServerResolvedResourceContext;
  readonly agencyAssignment?: AgencyClientAssignment;
}): IntegrationContextChangeAuthorityDecision {
  const prepared = prepareIntegrationContextChange(input.plan);
  if (prepared.decision === 'DENY') return prepared;

  if (input.target.merchantWorkspaceId !== input.plan.merchantWorkspaceId) {
    return { decision: 'DENY', reason: 'PLAN_WORKSPACE_MISMATCH' };
  }

  const matchedPermissions: Permission[] = [];
  for (const requiredPermission of permissionsByKind[input.plan.kind]) {
    const authz = evaluateAuthorization({
      executionContext: input.executionContext,
      requiredPermission,
      target: input.target,
      ...(input.agencyAssignment ? { agencyAssignment: input.agencyAssignment } : {}),
    });
    if (authz.decision === 'DENY') {
      return {
        decision: 'DENY',
        reason: 'AUTHORIZATION_DENIED',
        detail: `${requiredPermission}:${authz.reason}`,
      };
    }
    matchedPermissions.push(authz.matchedPermission);
  }

  return { decision: 'READY', prepared, matchedPermissions };
}

export type IntegrationContextChangeSettlement =
  | {
      readonly decision: 'VERIFIED';
      readonly invalidatePriorCapabilitySnapshots: true;
      readonly downstreamAuthorityGranted: false;
    }
  | {
      readonly decision: 'DENY';
      readonly reason:
        | 'TARGET_CONTEXT_READBACK_MISMATCH'
        | 'PREVIOUS_CONTEXT_INVALIDATION_REQUIRED';
    };

export function settleIntegrationContextChange(input: {
  readonly prepared: Extract<IntegrationContextChangePreparation, { decision: 'READY' }>;
  readonly observedTargetContextRef: string;
  readonly previousContextStillAssumedAvailable: boolean;
}): IntegrationContextChangeSettlement {
  if (input.observedTargetContextRef !== input.prepared.plan.targetContextRef) {
    return { decision: 'DENY', reason: 'TARGET_CONTEXT_READBACK_MISMATCH' };
  }
  if (input.previousContextStillAssumedAvailable) {
    return { decision: 'DENY', reason: 'PREVIOUS_CONTEXT_INVALIDATION_REQUIRED' };
  }
  return {
    decision: 'VERIFIED',
    invalidatePriorCapabilitySnapshots: true,
    downstreamAuthorityGranted: false,
  };
}
