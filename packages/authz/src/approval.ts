import type { ActionPlanId, ApprovalRequestId, MerchantWorkspaceId, UtcTimestamp } from '../../domain/src';
import type { ErrorCode } from '../../domain/src/errors';

export interface ApprovalSnapshot {
  readonly approvalRequestId: ApprovalRequestId;
  readonly actionPlanId: ActionPlanId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly payloadHash: string;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'EXECUTED' | 'INVALIDATED';
  readonly expiresAt: UtcTimestamp;
  readonly executedAt?: UtcTimestamp;
}

export type ApprovalExecutionDecision =
  | { readonly decision: 'ALLOW' }
  | { readonly decision: 'DENY'; readonly code: Extract<ErrorCode, 'AUTH_TENANT_MISMATCH' | 'AUTH_APPROVAL_INVALID' | 'AUTH_APPROVAL_EXPIRED'>; readonly reason: string };

export function validateApprovalExecution(input: {
  readonly approval: ApprovalSnapshot;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly actionPlanId: ActionPlanId;
  readonly payloadHash: string;
  readonly now: UtcTimestamp;
}): ApprovalExecutionDecision {
  const { approval } = input;
  if (approval.merchantWorkspaceId !== input.merchantWorkspaceId) {
    return { decision: 'DENY', code: 'AUTH_TENANT_MISMATCH', reason: 'APPROVAL_WORKSPACE_MISMATCH' };
  }
  if (approval.actionPlanId !== input.actionPlanId) {
    return { decision: 'DENY', code: 'AUTH_APPROVAL_INVALID', reason: 'ACTION_PLAN_MISMATCH' };
  }
  if (approval.payloadHash !== input.payloadHash) {
    return { decision: 'DENY', code: 'AUTH_APPROVAL_INVALID', reason: 'PAYLOAD_HASH_MISMATCH' };
  }
  if (approval.status === 'EXECUTED' || approval.executedAt) {
    return { decision: 'DENY', code: 'AUTH_APPROVAL_INVALID', reason: 'APPROVAL_ALREADY_EXECUTED' };
  }
  if (approval.status !== 'APPROVED') {
    return { decision: 'DENY', code: 'AUTH_APPROVAL_INVALID', reason: `APPROVAL_STATE_${approval.status}` };
  }
  if (new Date(input.now).getTime() > new Date(approval.expiresAt).getTime()) {
    return { decision: 'DENY', code: 'AUTH_APPROVAL_EXPIRED', reason: 'APPROVAL_EXPIRED' };
  }
  return { decision: 'ALLOW' };
}
