import type { AgencyClientAssignment, IntegrationId, MerchantWorkspaceId, SupportState } from '../../domain/src';
import { evaluateAuthorization } from './evaluator';
import type { Permission } from './permissions';
import type { ExecutionContext, ServerResolvedResourceContext } from './types';

export const ACTION_RISK_CLASSES = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'] as const;
export type ActionRiskClass = (typeof ACTION_RISK_CLASSES)[number];

/**
 * Implementation names for the D-040 execution-maturity axis.
 * Risk and maturity are independent: a low-risk action can still have a low ceiling,
 * and an otherwise mature action can still be blocked by authz/capability/policy.
 */
export const EXECUTION_MATURITY_LEVELS = [
  'READ',
  'RECOMMEND',
  'DRAFT_PREVIEW',
  'APPLY_GOVERNED',
  'BOUNDED_AUTOMATION',
] as const;
export type ExecutionMaturityLevel = (typeof EXECUTION_MATURITY_LEVELS)[number];

export type ApprovalMode = 'NEVER' | 'POLICY' | 'ALWAYS';

export interface ActionDefinition {
  readonly actionName: string;
  readonly module: string;
  readonly inputSchemaVersion: string;
  readonly requiredPermission: Permission;
  readonly riskClass: ActionRiskClass;
  readonly executionMaturityCeiling: ExecutionMaturityLevel;
  readonly externalEffect: boolean;
  readonly capabilityRequirement?: string;
  readonly approvalMode: ApprovalMode;
  readonly postReadRequired: boolean;
  readonly reversible: boolean;
}

export interface CapabilityAuthoritySnapshot {
  /** Server-resolved tenant binding inherited from the Integration parent. */
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  /** Exact integration whose operation capability was verified. */
  readonly integrationId: IntegrationId;
  readonly capabilityKey: string;
  readonly supportState: SupportState;
  readonly evidenceRef?: string;
}

export const CRV1_ACTION_DEFINITIONS = [
  {
    actionName: 'commerce.product.read',
    module: 'commerce',
    inputSchemaVersion: '1',
    requiredPermission: 'commerce.product:read',
    riskClass: 'R1',
    executionMaturityCeiling: 'READ',
    externalEffect: false,
    capabilityRequirement: 'commerce.get_product',
    approvalMode: 'NEVER',
    postReadRequired: false,
    reversible: true,
  },
  {
    actionName: 'commerce.order.read',
    module: 'commerce',
    inputSchemaVersion: '1',
    requiredPermission: 'commerce.order:read',
    riskClass: 'R1',
    executionMaturityCeiling: 'READ',
    externalEffect: false,
    capabilityRequirement: 'commerce.get_order',
    approvalMode: 'NEVER',
    postReadRequired: false,
    reversible: true,
  },
  {
    actionName: 'conversation.reply.prepare',
    module: 'conversation',
    inputSchemaVersion: '1',
    requiredPermission: 'conversation:respond',
    riskClass: 'R2',
    executionMaturityCeiling: 'DRAFT_PREVIEW',
    externalEffect: false,
    approvalMode: 'NEVER',
    postReadRequired: false,
    reversible: true,
  },
  {
    actionName: 'conversation.reply.send',
    module: 'conversation',
    inputSchemaVersion: '1',
    requiredPermission: 'conversation:respond',
    riskClass: 'R3',
    executionMaturityCeiling: 'APPLY_GOVERNED',
    externalEffect: true,
    capabilityRequirement: 'whatsapp.send_message',
    approvalMode: 'POLICY',
    postReadRequired: true,
    reversible: false,
  },
  {
    actionName: 'merchant_rule.activate',
    module: 'merchant-rules',
    inputSchemaVersion: '1',
    requiredPermission: 'merchant_rule:activate',
    riskClass: 'R3',
    executionMaturityCeiling: 'APPLY_GOVERNED',
    externalEffect: false,
    approvalMode: 'POLICY',
    postReadRequired: true,
    reversible: true,
  },
  {
    actionName: 'customer.export',
    module: 'privacy',
    inputSchemaVersion: '1',
    requiredPermission: 'customer:export',
    riskClass: 'R4',
    executionMaturityCeiling: 'APPLY_GOVERNED',
    externalEffect: true,
    approvalMode: 'ALWAYS',
    postReadRequired: true,
    reversible: false,
  },
] as const satisfies readonly ActionDefinition[];

const actionRegistry = new Map<string, ActionDefinition>(
  CRV1_ACTION_DEFINITIONS.map((definition) => [definition.actionName, definition]),
);

const maturityRank = new Map<ExecutionMaturityLevel, number>(
  EXECUTION_MATURITY_LEVELS.map((level, index) => [level, index]),
);

export function getActionDefinition(actionName: string): ActionDefinition | null {
  return actionRegistry.get(actionName) ?? null;
}

export type ActionAuthorityDecision =
  | {
      readonly decision: 'ALLOW';
      readonly definition: ActionDefinition;
      readonly matchedPermission: Permission;
    }
  | {
      readonly decision: 'APPROVAL_REQUIRED';
      readonly definition: ActionDefinition;
      readonly reason: 'ACTION_POLICY' | 'ALWAYS_APPROVAL';
    }
  | {
      readonly decision: 'DENY';
      readonly reason:
        | 'UNREGISTERED_ACTION'
        | 'MATURITY_CEILING_EXCEEDED'
        | 'AUTHORIZATION_DENIED'
        | 'CAPABILITY_EVIDENCE_MISSING'
        | 'CAPABILITY_WORKSPACE_MISMATCH'
        | 'CAPABILITY_INTEGRATION_MISMATCH'
        | 'CAPABILITY_NOT_AVAILABLE';
      readonly detail?: string;
    };

export function resolveActionAuthority(input: {
  readonly actionName: string;
  readonly requestedMaturity: ExecutionMaturityLevel;
  readonly executionContext: ExecutionContext;
  readonly target: ServerResolvedResourceContext;
  readonly agencyAssignment?: AgencyClientAssignment;
  readonly capability?: CapabilityAuthoritySnapshot;
  readonly integrationId?: IntegrationId;
  readonly policyApprovalRequired?: boolean;
}): ActionAuthorityDecision {
  const definition = getActionDefinition(input.actionName);
  if (!definition) return { decision: 'DENY', reason: 'UNREGISTERED_ACTION' };

  const requested = maturityRank.get(input.requestedMaturity);
  const ceiling = maturityRank.get(definition.executionMaturityCeiling);
  if (requested === undefined || ceiling === undefined || requested > ceiling) {
    return { decision: 'DENY', reason: 'MATURITY_CEILING_EXCEEDED' };
  }

  const authz = evaluateAuthorization({
    executionContext: input.executionContext,
    requiredPermission: definition.requiredPermission,
    target: input.target,
    module: definition.module,
    ...(input.agencyAssignment ? { agencyAssignment: input.agencyAssignment } : {}),
  });
  if (authz.decision === 'DENY') {
    return { decision: 'DENY', reason: 'AUTHORIZATION_DENIED', detail: authz.reason };
  }

  if (definition.capabilityRequirement) {
    if (!input.capability || input.capability.capabilityKey !== definition.capabilityRequirement) {
      return { decision: 'DENY', reason: 'CAPABILITY_EVIDENCE_MISSING' };
    }
    if (input.capability.merchantWorkspaceId !== input.target.merchantWorkspaceId) {
      return { decision: 'DENY', reason: 'CAPABILITY_WORKSPACE_MISMATCH' };
    }
    if (!input.integrationId || input.capability.integrationId !== input.integrationId) {
      return {
        decision: 'DENY',
        reason: 'CAPABILITY_INTEGRATION_MISMATCH',
        detail: input.integrationId ? 'CAPABILITY_BOUND_TO_DIFFERENT_INTEGRATION' : 'INTEGRATION_CONTEXT_REQUIRED',
      };
    }
    if (input.capability.supportState !== 'AVAILABLE' || !input.capability.evidenceRef) {
      return {
        decision: 'DENY',
        reason: 'CAPABILITY_NOT_AVAILABLE',
        detail: input.capability.supportState,
      };
    }
  }

  if (definition.approvalMode === 'ALWAYS') {
    return { decision: 'APPROVAL_REQUIRED', definition, reason: 'ALWAYS_APPROVAL' };
  }
  if (definition.approvalMode === 'POLICY' && input.policyApprovalRequired !== false) {
    return { decision: 'APPROVAL_REQUIRED', definition, reason: 'ACTION_POLICY' };
  }

  return {
    decision: 'ALLOW',
    definition,
    matchedPermission: authz.matchedPermission,
  };
}
