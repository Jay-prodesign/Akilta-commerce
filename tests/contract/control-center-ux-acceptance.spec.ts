import {
  CLIENT_AUTHORITY_POLICY,
  agentAssistPresentation,
  customerContextDisclosurePresentation,
  integrationHealthPresentation,
  integrationContextActionPresentation,
  inventoryPresentation,
  localizedCriticalWarning,
  merchantRulePresentation,
  onboardingIntegrationPresentation,
  orderHistoryPresentation,
  sendLineagePresentation,
  usageCostPresentation,
} from '../../apps/control-center/src/ux-presentation';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const cases: Array<[string, () => void]> = [
  ['UX-AUTHORITY-CLIENT-NEVER-AUTHORIZES', () => {
    assert(!CLIENT_AUTHORITY_POLICY.routeParamsAuthorize && !CLIENT_AUTHORITY_POLICY.workspaceSelectionAuthorizes, 'client state became authority');
    assert(CLIENT_AUTHORITY_POLICY.serverRecheckRequired, 'server recheck not required');
  }],
  ['UX-02-UNVERIFIED-INTEGRATION-NOT-PILOT-READY', () => {
    const view = onboardingIntegrationPresentation('CONNECTED_UNVERIFIED');
    assert(!view.verified && !view.readyForPilotClaim && view.semantic !== 'READY', 'unverified provider shown ready');
  }],
  ['UX-03-UNKNOWN-STOCK-DISTINCT-FROM-OOS', () => {
    const unknown = inventoryPresentation({ availability: 'UNKNOWN', freshness: 'FRESH' });
    const out = inventoryPresentation({ availability: 'OUT_OF_STOCK', freshness: 'FRESH' });
    assert(unknown.availabilityClaim === 'UNKNOWN' && out.availabilityClaim === 'OUT_OF_STOCK', 'unknown collapsed into out-of-stock');
    assert(unknown.semantic !== out.semantic, 'unknown and out-of-stock presentation indistinguishable');
  }],
  ['UX-03-STALE-INVENTORY-CANNOT-CLAIM-CURRENT', () => {
    const view = inventoryPresentation({ availability: 'IN_STOCK', freshness: 'STALE' });
    assert(view.availabilityClaim === 'UNKNOWN' && !view.verifiedCurrentState, 'stale stock shown current');
  }],
  ['UX-06-CV0-HIDES-ORDER-DETAIL', () => {
    const view = customerContextDisclosurePresentation('CV0');
    assert(!view.showCustomerSpecificOrderDetails && view.showVerificationWarning, 'CV0 order detail exposed');
  }],
  ['UX-07-BOUNDED-HISTORY-LABELS-RECENT', () => {
    const view = orderHistoryPresentation('BOUNDED');
    assert(view.label === 'Recent accessible orders' && !view.mayClaimLifetimeComplete, 'bounded history presented as lifetime');
  }],
  ['UX-08-CRITICAL-UNKNOWN-BLOCKS-ASSIST-DRAFT', () => {
    assert(agentAssistPresentation({ evidenceCount: 1, hasCriticalUnknown: true, hasPolicyConflict: false }) === 'BLOCKED_UNKNOWN', 'critical unknown did not block');
  }],
  ['UX-08-NO-EVIDENCE-SHOWS-WARNING', () => {
    assert(agentAssistPresentation({ evidenceCount: 0, hasCriticalUnknown: false, hasPolicyConflict: false }) === 'DRAFT_WITH_WARNING', 'missing evidence shown clean');
  }],
  ['UX-09-RULE-CONFLICT-BLOCKS-ACTIVATION', () => {
    const view = merchantRulePresentation({ hasConflict: true });
    assert(view.conflictVisible && !view.activationAllowed, 'conflicting rule silently activatable');
  }],
  ['UX-10-ROLLBACK-TARGET-VISIBLE-AND-HISTORY-PRESERVED', () => {
    const view = merchantRulePresentation({ hasConflict: false, rollbackTargetVersion: 'v3' });
    assert(view.rollbackTargetLabel === 'Restore version v3' && view.rollbackPreservesHistory, 'rollback lineage presentation incomplete');
  }],
  ['UX-12-DEGRADED-INTEGRATION-VISIBLE', () => {
    const view = integrationHealthPresentation('STALE');
    assert(view.degradedVisible && view.semantic === 'WARNING', 'degraded connector hidden');
  }],
  ['UX-INTEGRATION-CONTEXT-OWNER-GATE-VISIBLE', () => {
    const view = integrationContextActionPresentation('OWNER_APPROVAL_REQUIRED');
    assert(!view.actionEnabled && view.requiresOwnerApproval && view.semantic === 'BLOCKED', 'owner gate not represented');
  }],
  ['UX-INTEGRATION-CONTEXT-RBAC-DENIAL-VISIBLE', () => {
    const view = integrationContextActionPresentation('AUTHORIZATION_DENIED');
    assert(!view.actionEnabled && view.permissionDenied && !view.requiresOwnerApproval, 'RBAC denial collapsed into owner approval');
  }],
  ['UX-INTEGRATION-CONTEXT-NON-INTERFERENCE-BLOCKS', () => {
    const view = integrationContextActionPresentation('SOURCE_PROJECT_NON_INTERFERENCE');
    assert(!view.actionEnabled && view.nonInterferenceBlocked, 'active source-project protection not visible');
  }],
  ['UX-INTEGRATION-CONTEXT-READY-IS-SERVER-RECHECKED', () => {
    const view = integrationContextActionPresentation('READY');
    assert(view.actionEnabled && view.serverRecheckRequired && !view.requiresOwnerApproval && !view.permissionDenied, 'server-authorized READY presentation invalid');
  }],
  ['UX-INTEGRATION-CONTEXT-POST-READ-AND-TARGET-MISMATCH-NOT-READY', () => {
    const pending = integrationContextActionPresentation('POST_READ_REQUIRED');
    const mismatch = integrationContextActionPresentation('TARGET_CONTEXT_MISMATCH');
    assert(!pending.actionEnabled && pending.semantic !== 'READY', 'post-read pending shown ready');
    assert(!mismatch.actionEnabled && mismatch.semantic === 'ERROR', 'target mismatch shown ready');
  }],
  ['UX-13-TR-EN-SEMANTIC-EQUIVALENCE', () => {
    const tr = localizedCriticalWarning('ORDER_VERIFICATION_REQUIRED', 'tr-TR');
    const en = localizedCriticalWarning('ORDER_VERIFICATION_REQUIRED', 'en-US');
    assert(tr.semanticCode === en.semanticCode && tr.text.length > 0 && en.text.length > 0, 'TR/EN warning semantics diverged');
  }],
  ['UX-14-UNKNOWN-COST-IS-NOT-ZERO', () => {
    const view = usageCostPresentation({ state: 'UNKNOWN' });
    assert(!view.numericZeroClaim && view.displayValue === 'Cost unknown', 'unknown cost rendered as zero');
  }],
  ['UX-15-SEND-LINEAGE-RECONSTRUCTABLE', () => {
    const view = sendLineagePresentation(['INBOUND_EVENT','TENANT_IDENTITY_CONTEXT','EVIDENCE_READ','AI_FIRST_OUTPUT','FINAL_CUSTOMER_OUTPUT','PROVIDER_RESULT']);
    assert(view.reconstructable && view.missingStages.length === 0 && view.orderValid, 'complete send lineage not reconstructable');
  }],
  ['UX-15-MISSING-PROVIDER-RESULT-NOT-RECONSTRUCTABLE', () => {
    const view = sendLineagePresentation(['INBOUND_EVENT','TENANT_IDENTITY_CONTEXT','EVIDENCE_READ','AI_FIRST_OUTPUT','FINAL_CUSTOMER_OUTPUT']);
    assert(!view.reconstructable && view.missingStages.includes('PROVIDER_RESULT'), 'incomplete send lineage shown complete');
  }],
];

for (const [name, run] of cases) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`PASS ${cases.length}/${cases.length} control-center UX presentation scenarios`);
