import type { MerchantWorkspaceId } from './ids';
import type { UtcTimestamp } from './time';
import type { WorkspaceReadinessState } from './support';

export const READINESS_GATE_STATES = ['NOT_STARTED','IN_PROGRESS','BLOCKED_BY_ACCESS','VERIFIED','DEGRADED'] as const;
export type ReadinessGateState = (typeof READINESS_GATE_STATES)[number];

export interface WorkspaceReadinessInputs {
  readonly workspaceCreated: boolean;
  readonly identityAdminState: ReadinessGateState;
  readonly whatsappIntegrationState: ReadinessGateState;
  readonly commerceIntegrationState: ReadinessGateState;
  readonly knowledgePolicyState: ReadinessGateState;
  readonly merchantRulesState: ReadinessGateState;
  readonly testConversationState: ReadinessGateState;
  readonly securityBaselineState: ReadinessGateState;
  readonly usageVisibilityState: ReadinessGateState;
}

export interface WorkspaceReadinessProjection extends WorkspaceReadinessInputs {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly overallState: WorkspaceReadinessState;
  readonly unmetGates: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly computedAt: UtcTimestamp;
}

const PRE_TEST_GATES: readonly (keyof WorkspaceReadinessInputs)[] = [
  'identityAdminState','whatsappIntegrationState','commerceIntegrationState','knowledgePolicyState','merchantRulesState','securityBaselineState','usageVisibilityState',
];
const ALL_STATE_GATES: readonly (keyof WorkspaceReadinessInputs)[] = [...PRE_TEST_GATES, 'testConversationState'];

function stateOf(inputs: WorkspaceReadinessInputs, key: keyof WorkspaceReadinessInputs): ReadinessGateState | null {
  const value = inputs[key];
  return typeof value === 'boolean' ? null : value;
}

export function deriveWorkspaceReadiness(inputs: WorkspaceReadinessInputs): { readonly overallState: WorkspaceReadinessState; readonly unmetGates: readonly string[] } {
  if (!inputs.workspaceCreated) return { overallState:'NOT_STARTED', unmetGates:['workspaceCreated'] };
  const states = ALL_STATE_GATES.map((key)=>[key,stateOf(inputs,key)] as const);
  if (states.some(([,state])=>state==='DEGRADED')) return { overallState:'DEGRADED', unmetGates:states.filter(([,s])=>s!=='VERIFIED').map(([k])=>k) };
  if (states.some(([,state])=>state==='BLOCKED_BY_ACCESS')) return { overallState:'BLOCKED_BY_ACCESS', unmetGates:states.filter(([,s])=>s!=='VERIFIED').map(([k])=>k) };
  const preTestReady = PRE_TEST_GATES.every((key)=>stateOf(inputs,key)==='VERIFIED');
  if (preTestReady && inputs.testConversationState === 'VERIFIED') return { overallState:'PILOT_READY', unmetGates:[] };
  if (preTestReady) return { overallState:'READY_FOR_TEST', unmetGates:['testConversationState'] };
  const allNotStarted = states.every(([,state])=>state==='NOT_STARTED');
  return { overallState: allNotStarted ? 'NOT_STARTED' : 'IN_PROGRESS', unmetGates:states.filter(([,s])=>s!=='VERIFIED').map(([k])=>k) };
}

export function recomputeWorkspaceReadiness(input: {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly gates: WorkspaceReadinessInputs;
  readonly evidenceRefs: readonly string[];
  readonly computedAt: UtcTimestamp;
}): WorkspaceReadinessProjection {
  const derived = deriveWorkspaceReadiness(input.gates);
  return Object.freeze({ merchantWorkspaceId:input.merchantWorkspaceId, ...input.gates, overallState:derived.overallState, unmetGates:derived.unmetGates, evidenceRefs:[...new Set(input.evidenceRefs)], computedAt:input.computedAt });
}
