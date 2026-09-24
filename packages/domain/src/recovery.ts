import type { MerchantWorkspaceId } from './ids';

export interface RestoredIntegrationState {
  readonly integrationRef: string;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly restoredStatus: 'VERIFIED' | 'DEGRADED' | 'REVOKED' | 'ERROR';
}

export interface RestoredActionState {
  readonly actionRef: string;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly restoredState: 'PLANNED' | 'AUTHORIZED' | 'EXECUTED' | 'FAILED';
}

export interface RestoredApprovalState {
  readonly approvalRef: string;
  readonly actionRef: string;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly restoredState: 'PENDING' | 'APPROVED' | 'EXECUTED' | 'INVALIDATED';
}

export interface RestoredRuleState {
  readonly merchantRuleRef: string;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly restoredActiveVersionRef: string | null;
  readonly availableVersionRefs: readonly string[];
}

export interface RestoredDeletionState {
  readonly subjectRef: string;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly backupContainsDeletedPii: boolean;
}

export interface RestoredAuditLineageState {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly chainStatus: 'CONSISTENT' | 'GAP_DETECTED' | 'UNKNOWN';
  readonly chainRef: string;
}

export interface RestoredCommerceProjection {
  readonly projectionRef: string;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly providerSourceRef: string;
  readonly restoredObservedAt: string;
}

export interface RestoreSnapshot {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly integrations: readonly RestoredIntegrationState[];
  readonly actions: readonly RestoredActionState[];
  readonly approvals: readonly RestoredApprovalState[];
  readonly rules: readonly RestoredRuleState[];
  readonly deletions: readonly RestoredDeletionState[];
  readonly auditLineage: readonly RestoredAuditLineageState[];
  readonly commerceProjections: readonly RestoredCommerceProjection[];
}

export interface CurrentRecoveryAuthority {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly revokedIntegrationRefs: readonly string[];
  readonly executedActionRefs: readonly string[];
  readonly executedApprovalRefs: readonly string[];
  readonly currentRuleVersionByRule: Readonly<Record<string, string | null>>;
  readonly deletedSubjectRefs: readonly string[];
}

export type RecoveryStep =
  | { readonly kind: 'FORCE_INTEGRATION_REVALIDATION'; readonly integrationRef: string }
  | { readonly kind: 'SUPPRESS_ACTION_REPLAY'; readonly actionRef: string }
  | { readonly kind: 'FORCE_APPROVAL_EXECUTED_OR_INVALID'; readonly approvalRef: string }
  | { readonly kind: 'RECONCILE_RULE_ACTIVE_VERSION'; readonly merchantRuleRef: string; readonly requiredVersionRef: string | null }
  | { readonly kind: 'MARK_AUDIT_RECOVERY_GAP'; readonly chainRef: string }
  | { readonly kind: 'REHYDRATE_COMMERCE_PROJECTION'; readonly projectionRef: string; readonly providerSourceRef: string }
  | { readonly kind: 'REDELETE_RESTORED_PII'; readonly subjectRef: string };

export type RestoreReconciliationResult =
  | { readonly status: 'DENY'; readonly reason: 'CROSS_TENANT_RESTORE_CONTAMINATION' }
  | { readonly status: 'PLAN'; readonly steps: readonly RecoveryStep[]; readonly replayAllowedByDefault: false };

function allWorkspaceRefs(snapshot: RestoreSnapshot): MerchantWorkspaceId[] {
  return [
    ...snapshot.integrations.map((x) => x.merchantWorkspaceId),
    ...snapshot.actions.map((x) => x.merchantWorkspaceId),
    ...snapshot.approvals.map((x) => x.merchantWorkspaceId),
    ...snapshot.rules.map((x) => x.merchantWorkspaceId),
    ...snapshot.deletions.map((x) => x.merchantWorkspaceId),
    ...snapshot.auditLineage.map((x) => x.merchantWorkspaceId),
    ...snapshot.commerceProjections.map((x) => x.merchantWorkspaceId),
  ];
}

export function buildPostRestoreReconciliation(
  snapshot: RestoreSnapshot,
  current: CurrentRecoveryAuthority,
): RestoreReconciliationResult {
  if (
    snapshot.merchantWorkspaceId !== current.merchantWorkspaceId ||
    allWorkspaceRefs(snapshot).some((workspaceId) => workspaceId !== snapshot.merchantWorkspaceId)
  ) {
    return { status: 'DENY', reason: 'CROSS_TENANT_RESTORE_CONTAMINATION' };
  }

  const steps: RecoveryStep[] = [];
  for (const integration of snapshot.integrations) {
    if (current.revokedIntegrationRefs.includes(integration.integrationRef) && integration.restoredStatus !== 'REVOKED') {
      steps.push({ kind: 'FORCE_INTEGRATION_REVALIDATION', integrationRef: integration.integrationRef });
    }
  }
  for (const action of snapshot.actions) {
    if (current.executedActionRefs.includes(action.actionRef) || action.restoredState === 'EXECUTED') {
      steps.push({ kind: 'SUPPRESS_ACTION_REPLAY', actionRef: action.actionRef });
    }
  }
  for (const approval of snapshot.approvals) {
    if (
      current.executedApprovalRefs.includes(approval.approvalRef) ||
      current.executedActionRefs.includes(approval.actionRef) ||
      approval.restoredState === 'EXECUTED'
    ) {
      steps.push({ kind: 'FORCE_APPROVAL_EXECUTED_OR_INVALID', approvalRef: approval.approvalRef });
    }
  }
  for (const rule of snapshot.rules) {
    const requiredVersionRef = current.currentRuleVersionByRule[rule.merchantRuleRef];
    if (requiredVersionRef !== undefined && rule.restoredActiveVersionRef !== requiredVersionRef) {
      steps.push({ kind: 'RECONCILE_RULE_ACTIVE_VERSION', merchantRuleRef: rule.merchantRuleRef, requiredVersionRef });
    }
  }
  for (const lineage of snapshot.auditLineage) {
    if (lineage.chainStatus !== 'CONSISTENT') {
      steps.push({ kind: 'MARK_AUDIT_RECOVERY_GAP', chainRef: lineage.chainRef });
    }
  }
  for (const projection of snapshot.commerceProjections) {
    steps.push({ kind: 'REHYDRATE_COMMERCE_PROJECTION', projectionRef: projection.projectionRef, providerSourceRef: projection.providerSourceRef });
  }
  for (const deletion of snapshot.deletions) {
    if (deletion.backupContainsDeletedPii && current.deletedSubjectRefs.includes(deletion.subjectRef)) {
      steps.push({ kind: 'REDELETE_RESTORED_PII', subjectRef: deletion.subjectRef });
    }
  }
  return { status: 'PLAN', steps, replayAllowedByDefault: false };
}
