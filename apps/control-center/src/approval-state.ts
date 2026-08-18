import type { ActionRiskClass, AuthAssuranceLevel } from '../../../packages/authz/src';

export type ApprovalSurface = 'WEB_CONTROL_CENTER' | 'MERCHANT_WHATSAPP';
export type ApprovalSurfaceDecision =
  | { readonly decision: 'ALLOW_SURFACE'; readonly surface: ApprovalSurface; readonly requiresStepUp: boolean }
  | { readonly decision: 'DENY_SURFACE'; readonly reason: 'WEB_STEP_UP_REQUIRED' | 'ASSURANCE_INSUFFICIENT' | 'APPROVAL_NOT_APPLICABLE' };

const assuranceRank: Record<AuthAssuranceLevel, number> = {
  LOW: 0,
  STANDARD: 1,
  STEP_UP: 2,
  STRONG: 3,
};

export function selectApprovalSurface(input: {
  readonly riskClass: ActionRiskClass;
  readonly requestedSurface: ApprovalSurface;
  readonly assuranceLevel: AuthAssuranceLevel;
}): ApprovalSurfaceDecision {
  if (input.riskClass === 'R0' || input.riskClass === 'R1' || input.riskClass === 'R2') {
    return { decision: 'DENY_SURFACE', reason: 'APPROVAL_NOT_APPLICABLE' };
  }

  if (input.riskClass === 'R4' || input.riskClass === 'R5') {
    if (input.requestedSurface !== 'WEB_CONTROL_CENTER' || assuranceRank[input.assuranceLevel] < assuranceRank.STEP_UP) {
      return { decision: 'DENY_SURFACE', reason: 'WEB_STEP_UP_REQUIRED' };
    }
    return { decision: 'ALLOW_SURFACE', surface: 'WEB_CONTROL_CENTER', requiresStepUp: true };
  }

  if (input.requestedSurface === 'WEB_CONTROL_CENTER') {
    if (assuranceRank[input.assuranceLevel] >= assuranceRank.STANDARD) {
      return { decision: 'ALLOW_SURFACE', surface: 'WEB_CONTROL_CENTER', requiresStepUp: false };
    }
    return { decision: 'DENY_SURFACE', reason: 'ASSURANCE_INSUFFICIENT' };
  }

  if (assuranceRank[input.assuranceLevel] < assuranceRank.STEP_UP) {
    return { decision: 'DENY_SURFACE', reason: 'ASSURANCE_INSUFFICIENT' };
  }
  return { decision: 'ALLOW_SURFACE', surface: 'MERCHANT_WHATSAPP', requiresStepUp: true };
}

export interface ApprovalPresentation {
  readonly approvalRequestId: string;
  readonly opaqueActionRef: string;
  readonly riskClass: ActionRiskClass;
  readonly actionName: string;
  readonly humanReadableSummary: string;
  readonly exactImpactSummary: readonly string[];
  readonly expiresAt: string;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'EXECUTED' | 'INVALIDATED';
}

export interface ApprovalClientCommand {
  readonly approvalRequestId: string;
  readonly opaqueActionRef: string;
  readonly decision: 'APPROVE' | 'REJECT';
}

export function approvalClientCommand(input: ApprovalClientCommand): ApprovalClientCommand {
  if (!input.approvalRequestId.trim()) throw new Error('APPROVAL_REQUEST_ID_REQUIRED');
  if (!input.opaqueActionRef.trim()) throw new Error('OPAQUE_ACTION_REF_REQUIRED');
  // Deliberately no payload/action body fields: server re-reads immutable ActionPlan snapshot.
  return Object.freeze({ ...input });
}
