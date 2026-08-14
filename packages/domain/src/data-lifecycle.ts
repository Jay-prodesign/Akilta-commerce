import type { CustomerId, MerchantWorkspaceId } from './ids';

export const DATA_CLASSES = [
  'D0_PUBLIC_NON_SENSITIVE',
  'D1_OPERATIONAL_NON_PII',
  'D2_CUSTOMER_PII',
  'D3_SENSITIVE_OPERATIONAL',
  'D4_COMMERCE_CONFIDENTIAL',
  'D5_CREDENTIAL_SECRET',
  'D6_EVALUATION_DATA',
  'D7_TRAINING_ELIGIBLE',
] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export type DeleteMode =
  | 'HARD_DELETE'
  | 'ANONYMIZE'
  | 'PSEUDONYMIZE'
  | 'TOMBSTONE'
  | 'DETACH_FROM_TRAINING_SET'
  | 'PROVIDER_SOURCE_ONLY'
  | 'RETAIN';

export interface RetentionPolicy {
  readonly policyId: string;
  readonly dataClass: DataClass;
  readonly scope: 'PLATFORM_DEFAULT' | 'MERCHANT_WORKSPACE';
  readonly merchantWorkspaceId?: MerchantWorkspaceId;
  readonly retentionRuleRef: string;
  readonly legalHoldBehavior: 'RETAIN' | 'REVIEW_REQUIRED';
  readonly deleteMode: DeleteMode;
  readonly effectiveVersion: string;
  readonly sourceApprovalRef: string;
}

export interface DataRecordRef {
  readonly recordRef: string;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly dataClass: DataClass;
  readonly subjectCustomerId?: CustomerId;
  readonly retentionPolicyRef: string;
  readonly legalHold: boolean;
  readonly containsSubjectPii: boolean;
  readonly derivedIndexRefs: readonly string[];
  readonly exportableToCustomer: boolean;
}

export type DeletionStep =
  | {
      readonly kind: 'MUTATE_RECORD';
      readonly recordRef: string;
      readonly mode: Exclude<DeleteMode, 'RETAIN'>;
      readonly retentionPolicyRef: string;
    }
  | { readonly kind: 'INVALIDATE_DERIVED_INDEX'; readonly indexRef: string; readonly sourceRecordRef: string }
  | { readonly kind: 'RETAIN_RECORD'; readonly recordRef: string; readonly reason: 'LEGAL_HOLD' | 'NON_SUBJECT_SECURITY_DATA' | 'POLICY_RETAIN' };

export type CustomerDeletionPlanResult =
  | { readonly status: 'DENY'; readonly reason: 'CUSTOMER_NOT_VERIFIED' | 'CROSS_TENANT_SCOPE_CONTAMINATION' | 'POLICY_NOT_FOUND' }
  | { readonly status: 'PLAN'; readonly steps: readonly DeletionStep[]; readonly providerMutationIncluded: false };

function policyFor(record: DataRecordRef, policies: readonly RetentionPolicy[]): RetentionPolicy | undefined {
  return policies.find(
    (policy) =>
      policy.policyId === record.retentionPolicyRef &&
      policy.dataClass === record.dataClass &&
      (policy.scope === 'PLATFORM_DEFAULT' || policy.merchantWorkspaceId === record.merchantWorkspaceId),
  );
}

export function planCustomerDeletion(input: {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly customerId: CustomerId;
  readonly customerVerified: boolean;
  readonly records: readonly DataRecordRef[];
  readonly policies: readonly RetentionPolicy[];
}): CustomerDeletionPlanResult {
  if (!input.customerVerified) return { status: 'DENY', reason: 'CUSTOMER_NOT_VERIFIED' };
  if (input.records.some((record) => record.merchantWorkspaceId !== input.merchantWorkspaceId)) {
    return { status: 'DENY', reason: 'CROSS_TENANT_SCOPE_CONTAMINATION' };
  }

  const steps: DeletionStep[] = [];
  for (const record of input.records) {
    if (record.subjectCustomerId && record.subjectCustomerId !== input.customerId) continue;
    if (!record.containsSubjectPii && record.dataClass === 'D3_SENSITIVE_OPERATIONAL') {
      steps.push({ kind: 'RETAIN_RECORD', recordRef: record.recordRef, reason: 'NON_SUBJECT_SECURITY_DATA' });
      continue;
    }
    const policy = policyFor(record, input.policies);
    if (!policy) return { status: 'DENY', reason: 'POLICY_NOT_FOUND' };
    if (record.legalHold) {
      steps.push({ kind: 'RETAIN_RECORD', recordRef: record.recordRef, reason: 'LEGAL_HOLD' });
      continue;
    }
    if (policy.deleteMode === 'RETAIN') {
      steps.push({ kind: 'RETAIN_RECORD', recordRef: record.recordRef, reason: 'POLICY_RETAIN' });
      continue;
    }
    steps.push({ kind: 'MUTATE_RECORD', recordRef: record.recordRef, mode: policy.deleteMode, retentionPolicyRef: policy.policyId });
    for (const indexRef of record.derivedIndexRefs) {
      steps.push({ kind: 'INVALIDATE_DERIVED_INDEX', indexRef, sourceRecordRef: record.recordRef });
    }
  }
  return { status: 'PLAN', steps, providerMutationIncluded: false };
}

export function verifyDeletionCompletion(
  plan: Extract<CustomerDeletionPlanResult, { status: 'PLAN' }>,
  results: Readonly<Record<string, 'VERIFIED' | 'FAILED' | 'NOT_RUN'>>,
): { readonly status: 'COMPLETE' | 'INCOMPLETE'; readonly unverifiedRefs: readonly string[] } {
  const requiredRefs = plan.steps.flatMap((step) => {
    if (step.kind === 'MUTATE_RECORD') return [`record:${step.recordRef}`];
    if (step.kind === 'INVALIDATE_DERIVED_INDEX') return [`index:${step.indexRef}`];
    return [];
  });
  const unverifiedRefs = requiredRefs.filter((ref) => results[ref] !== 'VERIFIED');
  return { status: unverifiedRefs.length ? 'INCOMPLETE' : 'COMPLETE', unverifiedRefs };
}

export type ExportPlanResult =
  | { readonly status: 'DENY'; readonly reason: 'SUBJECT_NOT_VERIFIED' | 'CROSS_TENANT_SCOPE_CONTAMINATION' }
  | { readonly status: 'PLAN'; readonly recordRefs: readonly string[]; readonly excludesSecrets: true };

export function planCustomerExport(input: {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly customerId: CustomerId;
  readonly customerVerified: boolean;
  readonly records: readonly DataRecordRef[];
}): ExportPlanResult {
  if (!input.customerVerified) return { status: 'DENY', reason: 'SUBJECT_NOT_VERIFIED' };
  if (input.records.some((record) => record.merchantWorkspaceId !== input.merchantWorkspaceId)) {
    return { status: 'DENY', reason: 'CROSS_TENANT_SCOPE_CONTAMINATION' };
  }
  return {
    status: 'PLAN',
    recordRefs: input.records
      .filter(
        (record) =>
          record.subjectCustomerId === input.customerId &&
          record.exportableToCustomer &&
          record.dataClass !== 'D5_CREDENTIAL_SECRET' &&
          record.dataClass !== 'D3_SENSITIVE_OPERATIONAL',
      )
      .map((record) => record.recordRef),
    excludesSecrets: true,
  };
}

export type TrainingEligibility = 'NOT_CLASSIFIED' | 'INELIGIBLE' | 'ELIGIBLE';

export function classifyTrainingEligibility(input: {
  readonly consentOrBasisSatisfied: boolean;
  readonly piiMinimized: boolean;
  readonly purposeCompatible: boolean;
  readonly sourceRightsVerified: boolean;
  readonly retentionPolicyRef?: string;
  readonly explicitTrainingReview: boolean;
}): TrainingEligibility {
  if (!input.explicitTrainingReview) return 'NOT_CLASSIFIED';
  return input.consentOrBasisSatisfied &&
    input.piiMinimized &&
    input.purposeCompatible &&
    input.sourceRightsVerified &&
    Boolean(input.retentionPolicyRef)
    ? 'ELIGIBLE'
    : 'INELIGIBLE';
}
