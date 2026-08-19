import {
  getActionDefinition,
  resolveActionAuthority,
  validateApprovalExecution,
  type ApprovalSnapshot,
  type CapabilityAuthoritySnapshot,
  type ExecutionContext,
  type ExecutionMaturityLevel,
  type ServerResolvedResourceContext,
} from '../../../packages/authz/src';
import type {
  ActionPlanId,
  AgencyClientAssignment,
  IdempotencyKey,
  IntegrationId,
  MerchantWorkspaceId,
  UtcTimestamp,
} from '../../../packages/domain/src';
import {
  evaluateExternalEffectGate,
  type EnvironmentName,
  type ExternalEffect,
  type SafetySwitchSnapshot,
} from './runtime-config';

export interface StagedActionPlan {
  readonly actionPlanId: ActionPlanId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly actionName: string;
  readonly requestedMaturity: ExecutionMaturityLevel;
  readonly inputSchemaVersion: string;
  readonly payloadHash: string;
  readonly exactPayloadRef: string;
  readonly evidenceRefs: readonly string[];
  readonly idempotencyKey: IdempotencyKey;
  readonly createdAt: UtcTimestamp;
}

export function stagedActionPlan(input: StagedActionPlan): StagedActionPlan {
  const definition = getActionDefinition(input.actionName);
  if (!definition) throw new Error('UNREGISTERED_ACTION');
  if (input.inputSchemaVersion !== definition.inputSchemaVersion) {
    throw new Error('INPUT_SCHEMA_VERSION_MISMATCH');
  }
  if (!input.payloadHash.trim()) throw new Error('PAYLOAD_HASH_REQUIRED');
  if (!input.exactPayloadRef.trim()) throw new Error('EXACT_PAYLOAD_REF_REQUIRED');
  return Object.freeze({ ...input, evidenceRefs: Object.freeze([...input.evidenceRefs]) });
}

const ACTION_EFFECT: Readonly<Record<string, ExternalEffect | undefined>> = {
  'commerce.product.read': 'COMMERCE_READ',
  'commerce.order.read': 'COMMERCE_READ',
  'conversation.reply.send': 'OUTBOUND_MESSAGE',
  'merchant_rule.activate': 'MERCHANT_RULE_ACTIVATION',
};

export type PrepareExecutionDecision =
  | {
      readonly decision: 'EXECUTION_READY';
      readonly plan: StagedActionPlan;
      readonly postReadRequired: boolean;
      readonly reversible: boolean;
    }
  | {
      readonly decision: 'APPROVAL_REQUIRED';
      readonly plan: StagedActionPlan;
      readonly reason: string;
    }
  | {
      readonly decision: 'DENY';
      readonly reason: string;
    };

export type ActionSafetyDecision =
  | { readonly decision: 'ALLOW'; readonly effect?: ExternalEffect }
  | { readonly decision: 'APPROVAL_REQUIRED'; readonly reason: string }
  | { readonly decision: 'DENY'; readonly reason: string };

export interface ActionSafetyInput {
  readonly actionName: string;
  readonly requestedMaturity: ExecutionMaturityLevel;
  readonly executionContext: ExecutionContext;
  readonly target: ServerResolvedResourceContext;
  readonly agencyAssignment?: AgencyClientAssignment;
  readonly capability?: CapabilityAuthoritySnapshot;
  readonly policyApprovalRequired?: boolean;
  readonly approval?: ApprovalSnapshot;
  readonly actionPlanId: ActionPlanId;
  readonly payloadHash: string;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly now: UtcTimestamp;
  readonly environment: EnvironmentName;
  readonly configVersion: string;
  readonly releaseFlagEnabled: boolean;
  readonly switches: readonly SafetySwitchSnapshot[];
  readonly provider?: string;
  readonly integrationId?: IntegrationId;
}

/**
 * Authority + approval + external-effect-gate composition, factored out of
 * prepareActionExecution so it can be called a second time, unchanged, immediately
 * before an external effect actually dispatches or retries (see dispatch-safety.ts /
 * I3-RG-AUTH-RACE). Behavior is identical to the inline checks this replaced.
 */
export function evaluateActionSafety(input: ActionSafetyInput): ActionSafetyDecision {
  const actionDefinition = getActionDefinition(input.actionName);
  if (!actionDefinition) return { decision: 'DENY', reason: 'UNREGISTERED_ACTION' };

  const authority = resolveActionAuthority({
    actionName: input.actionName,
    requestedMaturity: input.requestedMaturity,
    executionContext: input.executionContext,
    target: input.target,
    ...(input.agencyAssignment ? { agencyAssignment: input.agencyAssignment } : {}),
    ...(input.capability ? { capability: input.capability } : {}),
    ...(input.integrationId ? { integrationId: input.integrationId } : {}),
    ...(input.policyApprovalRequired !== undefined
      ? { policyApprovalRequired: input.policyApprovalRequired }
      : {}),
  });
  if (authority.decision === 'DENY') {
    return { decision: 'DENY', reason: `ACTION_AUTHORITY:${authority.reason}` };
  }

  if (authority.decision === 'APPROVAL_REQUIRED') {
    if (!input.approval) {
      return { decision: 'APPROVAL_REQUIRED', reason: authority.reason };
    }
    const approval = validateApprovalExecution({
      approval: input.approval,
      merchantWorkspaceId: input.merchantWorkspaceId,
      actionPlanId: input.actionPlanId,
      payloadHash: input.payloadHash,
      now: input.now,
    });
    if (approval.decision === 'DENY') {
      return { decision: 'DENY', reason: `APPROVAL:${approval.reason}` };
    }
  }

  const effect = ACTION_EFFECT[input.actionName];
  // Any registered action explicitly marked as an external effect must never
  // bypass the safety-effect layer because its mapping is missing or stale.
  if (actionDefinition.externalEffect && !effect) {
    return { decision: 'DENY', reason: 'UNMAPPED_EXTERNAL_EFFECT' };
  }
  if (effect) {
    const gate = evaluateExternalEffectGate({
      effect,
      environment: input.environment,
      configVersion: input.configVersion,
      merchantWorkspaceId: input.merchantWorkspaceId,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.integrationId ? { integrationId: input.integrationId } : {}),
      operation: input.actionName,
      releaseFlagEnabled: input.releaseFlagEnabled,
      authorizationDecision: 'ALLOW',
      ...(input.capability ? { providerSupportState: input.capability.supportState } : {}),
      switches: input.switches,
    });
    if (gate.decision === 'DENY') {
      return { decision: 'DENY', reason: `SAFETY_GATE:${gate.reason}` };
    }
  }

  return { decision: 'ALLOW', ...(effect ? { effect } : {}) };
}

export function prepareActionExecution(input: {
  readonly plan: StagedActionPlan;
  readonly executionContext: ExecutionContext;
  readonly target: ServerResolvedResourceContext;
  readonly agencyAssignment?: AgencyClientAssignment;
  readonly capability?: CapabilityAuthoritySnapshot;
  readonly policyApprovalRequired?: boolean;
  readonly approval?: ApprovalSnapshot;
  readonly now: UtcTimestamp;
  readonly environment: EnvironmentName;
  readonly configVersion: string;
  readonly releaseFlagEnabled: boolean;
  readonly switches: readonly SafetySwitchSnapshot[];
  readonly provider?: string;
  readonly integrationId?: IntegrationId;
}): PrepareExecutionDecision {
  const { plan } = input;
  const actionDefinition = getActionDefinition(plan.actionName);
  if (!actionDefinition) return { decision: 'DENY', reason: 'UNREGISTERED_ACTION' };
  if (plan.inputSchemaVersion !== actionDefinition.inputSchemaVersion) {
    return { decision: 'DENY', reason: 'ACTION_INPUT_SCHEMA_VERSION_STALE' };
  }
  if (plan.merchantWorkspaceId !== input.target.merchantWorkspaceId) {
    return { decision: 'DENY', reason: 'ACTION_PLAN_WORKSPACE_MISMATCH' };
  }

  const safety = evaluateActionSafety({
    actionName: plan.actionName,
    requestedMaturity: plan.requestedMaturity,
    executionContext: input.executionContext,
    target: input.target,
    ...(input.agencyAssignment ? { agencyAssignment: input.agencyAssignment } : {}),
    ...(input.capability ? { capability: input.capability } : {}),
    ...(input.policyApprovalRequired !== undefined
      ? { policyApprovalRequired: input.policyApprovalRequired }
      : {}),
    ...(input.approval ? { approval: input.approval } : {}),
    actionPlanId: plan.actionPlanId,
    payloadHash: plan.payloadHash,
    merchantWorkspaceId: plan.merchantWorkspaceId,
    now: input.now,
    environment: input.environment,
    configVersion: input.configVersion,
    releaseFlagEnabled: input.releaseFlagEnabled,
    switches: input.switches,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.integrationId ? { integrationId: input.integrationId } : {}),
  });

  if (safety.decision === 'DENY') return { decision: 'DENY', reason: safety.reason };
  if (safety.decision === 'APPROVAL_REQUIRED') {
    return { decision: 'APPROVAL_REQUIRED', plan, reason: safety.reason };
  }
  return {
    decision: 'EXECUTION_READY',
    plan,
    postReadRequired: actionDefinition.postReadRequired,
    reversible: actionDefinition.reversible,
  };
}
