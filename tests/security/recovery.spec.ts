import { buildPostRestoreReconciliation, internalId, type RestoreSnapshot } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const wsA = internalId('ws-a', 'MerchantWorkspace');
const wsB = internalId('ws-b', 'MerchantWorkspace');

function snapshot(overrides: Partial<RestoreSnapshot> = {}): RestoreSnapshot {
  return {
    merchantWorkspaceId: wsA,
    integrations: [{ integrationRef:'int-1', merchantWorkspaceId:wsA, restoredStatus:'VERIFIED' }],
    actions: [{ actionRef:'action-1', merchantWorkspaceId:wsA, restoredState:'AUTHORIZED' }],
    approvals: [{ approvalRef:'approval-1', actionRef:'action-1', merchantWorkspaceId:wsA, restoredState:'APPROVED' }],
    rules: [{ merchantRuleRef:'rule-1', merchantWorkspaceId:wsA, restoredActiveVersionRef:'rule-v1', availableVersionRefs:['rule-v1','rule-v2'] }],
    deletions: [{ subjectRef:'customer-1', merchantWorkspaceId:wsA, backupContainsDeletedPii:true }],
    auditLineage: [{ merchantWorkspaceId:wsA, chainStatus:'CONSISTENT', chainRef:'audit-chain-1' }],
    commerceProjections: [{ projectionRef:'order-proj-1', merchantWorkspaceId:wsA, providerSourceRef:'provider-order-1', restoredObservedAt:'2026-08-01T00:00:00Z' }],
    ...overrides,
  };
}

const current = {
  merchantWorkspaceId: wsA,
  revokedIntegrationRefs: ['int-1'],
  executedActionRefs: ['action-1'],
  executedApprovalRefs: ['approval-1'],
  currentRuleVersionByRule: { 'rule-1':'rule-v2' },
  deletedSubjectRefs: ['customer-1'],
} as const;

const cases: Array<{ id:string; run:()=>void }> = [
  {
    id:'DR-01-CROSS-TENANT-RESTORE-DENY',
    run:()=>{
      const result=buildPostRestoreReconciliation(snapshot({actions:[{actionRef:'x',merchantWorkspaceId:wsB,restoredState:'AUTHORIZED'}]}),current);
      assert(result.status==='DENY','cross-tenant restore contamination must deny');
    }
  },
  {
    id:'DR-02-REVOKED-INTEGRATION-REVALIDATE',
    run:()=>{
      const result=buildPostRestoreReconciliation(snapshot(),current); assert(result.status==='PLAN','plan expected');
      assert(result.steps.some((s)=>s.kind==='FORCE_INTEGRATION_REVALIDATION'),'revoked integration cannot revive');
    }
  },
  {
    id:'DR-03-EXECUTED-ACTION-NO-REPLAY',
    run:()=>{
      const result=buildPostRestoreReconciliation(snapshot(),current); assert(result.status==='PLAN','plan expected');
      assert(result.replayAllowedByDefault===false && result.steps.some((s)=>s.kind==='SUPPRESS_ACTION_REPLAY'),'executed action replay must suppress');
    }
  },
  {
    id:'DR-04-EXECUTED-APPROVAL-NOT-REUSABLE',
    run:()=>{
      const result=buildPostRestoreReconciliation(snapshot(),current); assert(result.status==='PLAN','plan expected');
      assert(result.steps.some((s)=>s.kind==='FORCE_APPROVAL_EXECUTED_OR_INVALID'),'approval cannot reopen');
    }
  },
  {
    id:'DR-05-RULE-ACTIVE-VERSION-RECONCILE',
    run:()=>{
      const result=buildPostRestoreReconciliation(snapshot(),current); assert(result.status==='PLAN','plan expected');
      const step=result.steps.find((s)=>s.kind==='RECONCILE_RULE_ACTIVE_VERSION');
      assert(step?.kind==='RECONCILE_RULE_ACTIVE_VERSION' && step.requiredVersionRef==='rule-v2','rule pointer must reconcile');
    }
  },
  {
    id:'DR-06-AUDIT-GAP-EXPLICIT',
    run:()=>{
      const result=buildPostRestoreReconciliation(snapshot({auditLineage:[{merchantWorkspaceId:wsA,chainStatus:'GAP_DETECTED',chainRef:'audit-gap'}]}),current);
      assert(result.status==='PLAN' && result.steps.some((s)=>s.kind==='MARK_AUDIT_RECOVERY_GAP'),'audit recovery gap must be marked');
    }
  },
  {
    id:'DR-07-COMMERCE-PROJECTION-REHYDRATE',
    run:()=>{
      const result=buildPostRestoreReconciliation(snapshot(),current); assert(result.status==='PLAN','plan expected');
      assert(result.steps.some((s)=>s.kind==='REHYDRATE_COMMERCE_PROJECTION'),'provider projection should rehydrate/reconcile');
    }
  },
  {
    id:'DR-08-DELETED-PII-REDELETE',
    run:()=>{
      const result=buildPostRestoreReconciliation(snapshot(),current); assert(result.status==='PLAN','plan expected');
      assert(result.steps.some((s)=>s.kind==='REDELETE_RESTORED_PII'),'restored deleted PII must enter re-deletion workflow');
    }
  },
];
for(const c of cases){c.run(); console.log(`PASS ${c.id}`)}
console.log(`PASS ${cases.length}/${cases.length} recovery scenarios`);
