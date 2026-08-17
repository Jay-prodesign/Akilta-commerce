import {
  classifyTrainingEligibility,
  internalId,
  planCustomerDeletion,
  planCustomerExport,
  verifyDeletionCompletion,
  type DataRecordRef,
  type RetentionPolicy,
} from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const wsA = internalId('ws-a', 'MerchantWorkspace');
const wsB = internalId('ws-b', 'MerchantWorkspace');
const customerA = internalId('customer-a', 'Customer');
const customerB = internalId('customer-b', 'Customer');

const policies: RetentionPolicy[] = [
  {
    policyId: 'p-pii', dataClass: 'D2_CUSTOMER_PII', scope: 'PLATFORM_DEFAULT', retentionRuleRef: 'standard-support',
    legalHoldBehavior: 'RETAIN', deleteMode: 'HARD_DELETE', effectiveVersion: 'v1', sourceApprovalRef: 'policy:privacy:1',
  },
  {
    policyId: 'p-eval', dataClass: 'D6_EVALUATION_DATA', scope: 'PLATFORM_DEFAULT', retentionRuleRef: 'minimized-evaluation',
    legalHoldBehavior: 'RETAIN', deleteMode: 'ANONYMIZE', effectiveVersion: 'v1', sourceApprovalRef: 'policy:privacy:1',
  },
  {
    policyId: 'p-security', dataClass: 'D3_SENSITIVE_OPERATIONAL', scope: 'PLATFORM_DEFAULT', retentionRuleRef: 'extended-security',
    legalHoldBehavior: 'RETAIN', deleteMode: 'ANONYMIZE', effectiveVersion: 'v1', sourceApprovalRef: 'policy:privacy:1',
  },
];

function record(overrides: Partial<DataRecordRef> = {}): DataRecordRef {
  return {
    recordRef: 'message:1', merchantWorkspaceId: wsA, dataClass: 'D2_CUSTOMER_PII', subjectCustomerId: customerA,
    retentionPolicyRef: 'p-pii', legalHold: false, containsSubjectPii: true,
    derivedIndexRefs: ['search:message:1','vector:message:1'], exportableToCustomer: true,
    ...overrides,
  };
}

const cases: Array<{ id: string; run: () => void }> = [
  {
    id: 'DP-02-CROSS-TENANT-DELETION-DENY',
    run: () => {
      const result = planCustomerDeletion({ merchantWorkspaceId: wsA, customerId: customerA, customerVerified: true, records: [record(), record({ merchantWorkspaceId: wsB })], policies });
      assert(result.status === 'DENY' && result.reason === 'CROSS_TENANT_SCOPE_CONTAMINATION', 'cross-tenant deletion input must fail');
    },
  },
  {
    id: 'DP-03-DERIVED-INDEX-INVALIDATION-PLANNED',
    run: () => {
      const result = planCustomerDeletion({ merchantWorkspaceId: wsA, customerId: customerA, customerVerified: true, records: [record()], policies });
      assert(result.status === 'PLAN', 'expected plan');
      assert(result.steps.filter((step) => step.kind === 'INVALIDATE_DERIVED_INDEX').length === 2, 'all derived indexes must invalidate');
      assert(result.providerMutationIncluded === false, 'local deletion must not imply provider mutation');
    },
  },
  {
    id: 'DP-DELETE-LEGAL-HOLD-RETAINS',
    run: () => {
      const result = planCustomerDeletion({ merchantWorkspaceId: wsA, customerId: customerA, customerVerified: true, records: [record({ legalHold: true })], policies });
      assert(result.status === 'PLAN' && result.steps[0]?.kind === 'RETAIN_RECORD', 'legal hold should retain');
    },
  },
  {
    id: 'DP-DELETE-NON-SUBJECT-SECURITY-AUDIT-RETAINS',
    run: () => {
      const result = planCustomerDeletion({ merchantWorkspaceId: wsA, customerId: customerA, customerVerified: true, records: [record({ dataClass:'D3_SENSITIVE_OPERATIONAL', retentionPolicyRef:'p-security', containsSubjectPii:false, exportableToCustomer:false })], policies });
      assert(result.status === 'PLAN' && result.steps[0]?.kind === 'RETAIN_RECORD', 'merchant-wide security data must not be deleted as customer PII');
    },
  },
  {
    id: 'DP-DELETE-COMPLETION-REQUIRES-POSTREAD',
    run: () => {
      const plan = planCustomerDeletion({ merchantWorkspaceId: wsA, customerId: customerA, customerVerified: true, records: [record()], policies });
      assert(plan.status === 'PLAN', 'expected plan');
      const incomplete = verifyDeletionCompletion(plan, { 'record:message:1':'VERIFIED', 'index:search:message:1':'VERIFIED' });
      assert(incomplete.status === 'INCOMPLETE', 'missing vector invalidation verification must prevent complete claim');
      const complete = verifyDeletionCompletion(plan, { 'record:message:1':'VERIFIED', 'index:search:message:1':'VERIFIED', 'index:vector:message:1':'VERIFIED' });
      assert(complete.status === 'COMPLETE', 'all mutation/index postreads verified should complete');
    },
  },
  {
    id: 'DP-04-NORMAL-SUPPORT-NOT-AUTOMATIC-TRAINING',
    run: () => {
      const result = classifyTrainingEligibility({ consentOrBasisSatisfied:true, piiMinimized:true, purposeCompatible:true, sourceRightsVerified:true, retentionPolicyRef:'p-eval', explicitTrainingReview:false });
      assert(result === 'NOT_CLASSIFIED', 'support completion must not auto-promote training');
    },
  },
  {
    id: 'DP-TRAINING-REVIEW-FAILS-INELIGIBLE',
    run: () => {
      const result = classifyTrainingEligibility({ consentOrBasisSatisfied:false, piiMinimized:true, purposeCompatible:true, sourceRightsVerified:true, retentionPolicyRef:'p-eval', explicitTrainingReview:true });
      assert(result === 'INELIGIBLE', 'failed consent/basis should be ineligible');
    },
  },
  {
    id: 'DP-06-CUSTOMER-EXPORT-CROSS-TENANT-DENY',
    run: () => {
      const result = planCustomerExport({ merchantWorkspaceId:wsA, customerId:customerA, customerVerified:true, records:[record(), record({merchantWorkspaceId:wsB})] });
      assert(result.status === 'DENY', 'cross-tenant export input must fail');
    },
  },
  {
    id: 'DP-07-CUSTOMER-EXPORT-EXCLUDES-SECURITY-AND-OTHER-CUSTOMER',
    run: () => {
      const result = planCustomerExport({ merchantWorkspaceId:wsA, customerId:customerA, customerVerified:true, records:[
        record(),
        record({recordRef:'security:1',dataClass:'D3_SENSITIVE_OPERATIONAL',retentionPolicyRef:'p-security',exportableToCustomer:false}),
        record({recordRef:'message:b',subjectCustomerId:customerB}),
      ] });
      assert(result.status === 'PLAN', 'expected export plan');
      assert(result.recordRefs.length === 1 && result.recordRefs[0] === 'message:1', 'customer export must be subject-scoped and exclude internal security');
    },
  },
];

for (const testCase of cases) { testCase.run(); console.log(`PASS ${testCase.id}`); }
console.log(`PASS ${cases.length}/${cases.length} data lifecycle scenarios`);
