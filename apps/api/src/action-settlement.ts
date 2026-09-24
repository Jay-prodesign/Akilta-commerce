import { getActionDefinition } from '../../../packages/authz/src';

export const ACTION_SETTLEMENT_STATUSES = [
  'SUCCEEDED',
  'FAILED',
  'COMPENSATION_REQUIRED',
  'BLOCKED',
] as const;
export type ActionSettlementStatus = (typeof ACTION_SETTLEMENT_STATUSES)[number];

export const PROVIDER_EXECUTION_STATES = [
  'CONFIRMED_SUCCESS',
  'CONFIRMED_FAILURE',
  'OUTCOME_UNKNOWN',
  'PARTIAL_EFFECT',
] as const;
export type ProviderExecutionState = (typeof PROVIDER_EXECUTION_STATES)[number];

export const POST_READ_VERIFICATION_STATES = [
  'NOT_RUN',
  'VERIFIED_MATCH',
  'VERIFIED_MISMATCH',
  'UNAVAILABLE',
] as const;
export type PostReadVerificationState = (typeof POST_READ_VERIFICATION_STATES)[number];

export type ActionSettlementReason =
  | 'VERIFIED_SUCCESS'
  | 'PROVIDER_EXECUTION_FAILED'
  | 'PROVIDER_OUTCOME_UNCERTAIN'
  | 'PROVIDER_PARTIAL_EFFECT'
  | 'POST_READ_REQUIRED'
  | 'ACTION_POSTREAD_MISMATCH'
  | 'POST_READ_UNAVAILABLE';

export type ActionSettlementNextSafeAction =
  | 'NONE'
  | 'RUN_POST_READ'
  | 'RECONCILE_PROVIDER_RESULT'
  | 'COMPENSATE_OR_ROLLBACK'
  | 'MANUAL_REVIEW';

export interface ActionExecutionEvidence {
  readonly providerState: ProviderExecutionState;
  /** Safe evidence/result reference only; never a raw provider payload or credential. */
  readonly providerResultRef?: string;
  readonly postReadState?: PostReadVerificationState;
  /** Safe post-read evidence reference when a semantic verification actually ran. */
  readonly postReadEvidenceRef?: string;
}

export interface ActionSettlementResult {
  readonly actionName: string;
  readonly status: ActionSettlementStatus;
  readonly reason: ActionSettlementReason;
  readonly nextSafeAction: ActionSettlementNextSafeAction;
  readonly postReadRequired: boolean;
  readonly reversible: boolean;
  readonly providerResultRef?: string;
  readonly postReadEvidenceRef?: string;
  readonly errorCode?: 'ACTION_POSTREAD_MISMATCH';
}

function nonBlank(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireProviderEvidence(evidence: ActionExecutionEvidence): void {
  if (
    evidence.providerState !== 'OUTCOME_UNKNOWN' &&
    !nonBlank(evidence.providerResultRef)
  ) {
    throw new Error('PROVIDER_RESULT_EVIDENCE_REQUIRED');
  }
}

function requirePostReadEvidence(evidence: ActionExecutionEvidence): void {
  if (
    (evidence.postReadState === 'VERIFIED_MATCH' || evidence.postReadState === 'VERIFIED_MISMATCH') &&
    !nonBlank(evidence.postReadEvidenceRef)
  ) {
    throw new Error('POST_READ_EVIDENCE_REQUIRED');
  }
}

/**
 * Provider-neutral action finalization policy.
 *
 * Authority boundaries:
 * - action behavior comes from the server-side action registry, never client input;
 * - transport/provider success alone is not enough when the action requires post-read;
 * - unknown/partial outcomes fail closed and are never silently retried or relabeled success;
 * - compensation is only requested when the registered action is reversible;
 * - provider-specific payload paths, retry semantics and compensation implementations stay in adapters/runtime.
 */
export function settleActionExecution(input: {
  readonly actionName: string;
  readonly evidence: ActionExecutionEvidence;
}): ActionSettlementResult {
  const definition = getActionDefinition(input.actionName);
  if (!definition) throw new Error('UNREGISTERED_ACTION');

  const evidence = input.evidence;
  requireProviderEvidence(evidence);
  requirePostReadEvidence(evidence);

  const base = {
    actionName: input.actionName,
    postReadRequired: definition.postReadRequired,
    reversible: definition.reversible,
    ...(nonBlank(evidence.providerResultRef) ? { providerResultRef: evidence.providerResultRef } : {}),
    ...(nonBlank(evidence.postReadEvidenceRef) ? { postReadEvidenceRef: evidence.postReadEvidenceRef } : {}),
  } as const;

  if (evidence.providerState === 'CONFIRMED_FAILURE') {
    return {
      ...base,
      status: 'FAILED',
      reason: 'PROVIDER_EXECUTION_FAILED',
      nextSafeAction: 'NONE',
    };
  }

  if (evidence.providerState === 'OUTCOME_UNKNOWN') {
    return {
      ...base,
      status: 'BLOCKED',
      reason: 'PROVIDER_OUTCOME_UNCERTAIN',
      nextSafeAction: 'RECONCILE_PROVIDER_RESULT',
    };
  }

  if (evidence.providerState === 'PARTIAL_EFFECT') {
    return definition.reversible
      ? {
          ...base,
          status: 'COMPENSATION_REQUIRED',
          reason: 'PROVIDER_PARTIAL_EFFECT',
          nextSafeAction: 'COMPENSATE_OR_ROLLBACK',
        }
      : {
          ...base,
          status: 'BLOCKED',
          reason: 'PROVIDER_PARTIAL_EFFECT',
          nextSafeAction: 'MANUAL_REVIEW',
        };
  }

  // Confirmed transport/provider success is final only when the registry does not require post-read.
  if (!definition.postReadRequired) {
    return {
      ...base,
      status: 'SUCCEEDED',
      reason: 'VERIFIED_SUCCESS',
      nextSafeAction: 'NONE',
    };
  }

  const postRead = evidence.postReadState ?? 'NOT_RUN';
  if (postRead === 'NOT_RUN') {
    return {
      ...base,
      status: 'BLOCKED',
      reason: 'POST_READ_REQUIRED',
      nextSafeAction: 'RUN_POST_READ',
    };
  }

  if (postRead === 'UNAVAILABLE') {
    return {
      ...base,
      status: 'BLOCKED',
      reason: 'POST_READ_UNAVAILABLE',
      nextSafeAction: 'RECONCILE_PROVIDER_RESULT',
    };
  }

  if (postRead === 'VERIFIED_MISMATCH') {
    return definition.reversible
      ? {
          ...base,
          status: 'COMPENSATION_REQUIRED',
          reason: 'ACTION_POSTREAD_MISMATCH',
          nextSafeAction: 'COMPENSATE_OR_ROLLBACK',
          errorCode: 'ACTION_POSTREAD_MISMATCH',
        }
      : {
          ...base,
          status: 'BLOCKED',
          reason: 'ACTION_POSTREAD_MISMATCH',
          nextSafeAction: 'MANUAL_REVIEW',
          errorCode: 'ACTION_POSTREAD_MISMATCH',
        };
  }

  return {
    ...base,
    status: 'SUCCEEDED',
    reason: 'VERIFIED_SUCCESS',
    nextSafeAction: 'NONE',
  };
}
