import { deriveWorkspaceReadiness, internalId, recomputeWorkspaceReadiness, utcTimestamp, type WorkspaceReadinessInputs } from '../../packages/domain/src';
const verifiedBase: WorkspaceReadinessInputs = { workspaceCreated:true, identityAdminState:'VERIFIED', whatsappIntegrationState:'VERIFIED', commerceIntegrationState:'VERIFIED', knowledgePolicyState:'VERIFIED', merchantRulesState:'VERIFIED', testConversationState:'NOT_STARTED', securityBaselineState:'VERIFIED', usageVisibilityState:'VERIFIED' };
const scenarios = [
 {id:'P0-020-NOT-STARTED',actual:deriveWorkspaceReadiness({...verifiedBase,workspaceCreated:false}).overallState,expected:'NOT_STARTED'},
 {id:'P0-020-READY-FOR-TEST',actual:deriveWorkspaceReadiness(verifiedBase).overallState,expected:'READY_FOR_TEST'},
 {id:'P0-020-PILOT-READY-DERIVED',actual:deriveWorkspaceReadiness({...verifiedBase,testConversationState:'VERIFIED'}).overallState,expected:'PILOT_READY'},
 {id:'P0-020-PROVIDER-ACCESS-BLOCK',actual:deriveWorkspaceReadiness({...verifiedBase,whatsappIntegrationState:'BLOCKED_BY_ACCESS'}).overallState,expected:'BLOCKED_BY_ACCESS'},
 {id:'P0-020-REVOKE-DEGRADES',actual:deriveWorkspaceReadiness({...verifiedBase,whatsappIntegrationState:'DEGRADED',testConversationState:'VERIFIED'}).overallState,expected:'DEGRADED'},
 {id:'P0-020-PARTIAL-RESUME-IN-PROGRESS',actual:deriveWorkspaceReadiness({...verifiedBase,commerceIntegrationState:'IN_PROGRESS'}).overallState,expected:'IN_PROGRESS'},
] as const;
const p1=recomputeWorkspaceReadiness({merchantWorkspaceId:internalId('ws-ready','MerchantWorkspace'),gates:{...verifiedBase,testConversationState:'VERIFIED'},evidenceRefs:['a','a','b'],computedAt:utcTimestamp('2026-08-07T19:10:00Z')});
const p2=recomputeWorkspaceReadiness({merchantWorkspaceId:internalId('ws-ready','MerchantWorkspace'),gates:{...verifiedBase,testConversationState:'VERIFIED'},evidenceRefs:['a','a','b'],computedAt:utcTimestamp('2026-08-07T19:10:00Z')});
const extended=[...scenarios,{id:'P0-020-IDEMPOTENT-RECOMPUTE',actual:JSON.stringify(p1),expected:JSON.stringify(p2)},{id:'P0-020-EVIDENCE-DEDUPE',actual:p1.evidenceRefs.join(','),expected:'a,b'}] as const;
const failed=extended.filter((s)=>s.actual!==s.expected);if(failed.length){for(const f of failed)console.error('FAIL',f);throw new Error(`${failed.length}/${extended.length} readiness checks failed`)}
console.log(`PASS ${extended.length}/${extended.length}`);for(const s of extended)console.log(`PASS ${s.id}`);
