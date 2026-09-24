export const AI_TASK_CLASSES = [
  'T1_CLASSIFICATION_ROUTING',
  'T2_CUSTOMER_RESPONSE',
  'T3_AGENT_ASSIST',
  'T4_MERCHANT_RULE_INTERPRETATION',
  'T5_SUMMARIZATION_INSIGHT',
  'T6_PLANNING',
] as const;
export type AiTaskClass = (typeof AI_TASK_CLASSES)[number];

export type AiCapability =
  | 'TEXT'
  | 'STRUCTURED_OUTPUT'
  | 'TOOLS'
  | 'MULTILINGUAL'
  | 'VISION'
  | 'HIGH_REASONING';

export type EvaluationStatus = 'PASS' | 'FAIL' | 'PENDING';
export type CostClass = 'LOW' | 'MEDIUM' | 'HIGH';
export type LatencyClass = 'FAST' | 'BALANCED' | 'SLOW_ALLOWED';

export interface ModelCandidateRef {
  readonly providerRef: string;
  readonly modelRef: string;
  readonly capabilities: readonly AiCapability[];
  readonly availability: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
}

export interface ModelProfile {
  readonly profileId: string;
  readonly taskClass: AiTaskClass;
  readonly minimumRequiredCapabilities: readonly AiCapability[];
  readonly latencyClass: LatencyClass;
  readonly costClass: CostClass;
  readonly allowedModels: readonly ModelCandidateRef[];
  readonly evaluationStatus: EvaluationStatus;
  readonly evaluationRef?: string;
  readonly fallbackProfileId?: string;
}

export interface RoutingRequest {
  readonly taskClass: AiTaskClass;
  readonly requiredCapabilities: readonly AiCapability[];
}

export type RoutingDecision =
  | { readonly status: 'ROUTED'; readonly profile: ModelProfile; readonly model: ModelCandidateRef }
  | { readonly status: 'NO_ELIGIBLE_PROFILE'; readonly reason: string };

const COST_RANK: Record<CostClass, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const LATENCY_RANK: Record<LatencyClass, number> = { FAST: 0, BALANCED: 1, SLOW_ALLOWED: 2 };

function hasAllCapabilities(candidate: readonly AiCapability[], required: readonly AiCapability[]): boolean {
  return required.every((capability) => candidate.includes(capability));
}

export function routeModelProfile(
  request: RoutingRequest,
  profiles: readonly ModelProfile[],
): RoutingDecision {
  const eligibleProfiles = profiles
    .filter(
      (profile) =>
        profile.taskClass === request.taskClass &&
        profile.evaluationStatus === 'PASS' &&
        hasAllCapabilities(profile.minimumRequiredCapabilities, request.requiredCapabilities),
    )
    .sort(
      (a, b) =>
        COST_RANK[a.costClass] - COST_RANK[b.costClass] ||
        LATENCY_RANK[a.latencyClass] - LATENCY_RANK[b.latencyClass] ||
        a.profileId.localeCompare(b.profileId),
    );

  for (const profile of eligibleProfiles) {
    const model = profile.allowedModels.find(
      (candidate) =>
        candidate.availability === 'AVAILABLE' &&
        hasAllCapabilities(candidate.capabilities, request.requiredCapabilities),
    );
    if (model) return { status: 'ROUTED', profile, model };
  }
  return { status: 'NO_ELIGIBLE_PROFILE', reason: 'NO_EVALUATED_AVAILABLE_PROFILE_MATCHES_TASK' };
}

/** Fingerprint of authority-bearing context that model fallback is forbidden to change. */
export interface ModelAuthorityInvariant {
  readonly approvedFactSetRef: string;
  readonly unknownFactRefs: readonly string[];
  readonly conflictFactRefs: readonly string[];
  readonly allowedToolNames: readonly string[];
  readonly disclosureBoundaryRef: string;
  readonly authorizationBoundaryRef: string;
  readonly actionAuthority: 'NONE';
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
}

export type FallbackValidation =
  | { readonly status: 'ALLOW' }
  | {
      readonly status: 'DENY';
      readonly reason:
        | 'FALLBACK_EVAL_NOT_PASS'
        | 'TASK_CLASS_CHANGED'
        | 'FACT_SET_CHANGED'
        | 'UNKNOWN_STATE_CHANGED'
        | 'CONFLICT_STATE_CHANGED'
        | 'TOOLS_CHANGED'
        | 'DISCLOSURE_BOUNDARY_CHANGED'
        | 'AUTHORIZATION_BOUNDARY_CHANGED'
        | 'ACTION_AUTHORITY_CHANGED';
    };

export function validateModelFallback(input: {
  readonly primaryProfile: ModelProfile;
  readonly fallbackProfile: ModelProfile;
  readonly before: ModelAuthorityInvariant;
  readonly after: ModelAuthorityInvariant;
}): FallbackValidation {
  if (input.fallbackProfile.evaluationStatus !== 'PASS') return { status: 'DENY', reason: 'FALLBACK_EVAL_NOT_PASS' };
  if (input.primaryProfile.taskClass !== input.fallbackProfile.taskClass) return { status: 'DENY', reason: 'TASK_CLASS_CHANGED' };
  if (input.before.approvedFactSetRef !== input.after.approvedFactSetRef) return { status: 'DENY', reason: 'FACT_SET_CHANGED' };
  if (!sameStringSet(input.before.unknownFactRefs, input.after.unknownFactRefs)) return { status: 'DENY', reason: 'UNKNOWN_STATE_CHANGED' };
  if (!sameStringSet(input.before.conflictFactRefs, input.after.conflictFactRefs)) return { status: 'DENY', reason: 'CONFLICT_STATE_CHANGED' };
  if (!sameStringSet(input.before.allowedToolNames, input.after.allowedToolNames)) return { status: 'DENY', reason: 'TOOLS_CHANGED' };
  if (input.before.disclosureBoundaryRef !== input.after.disclosureBoundaryRef) return { status: 'DENY', reason: 'DISCLOSURE_BOUNDARY_CHANGED' };
  if (input.before.authorizationBoundaryRef !== input.after.authorizationBoundaryRef) return { status: 'DENY', reason: 'AUTHORIZATION_BOUNDARY_CHANGED' };
  if (input.before.actionAuthority !== input.after.actionAuthority) return { status: 'DENY', reason: 'ACTION_AUTHORITY_CHANGED' };
  return { status: 'ALLOW' };
}

export type ModelFailureClass =
  | 'TRANSIENT_PROVIDER'
  | 'STRUCTURED_OUTPUT_INVALID'
  | 'TRUTH_CHECK_FAIL'
  | 'AUTHZ_POLICY_FAIL'
  | 'PROMPT_INJECTION_FAIL';

export function nextModelAttempt(input: {
  readonly failure: ModelFailureClass;
  readonly attemptsSoFar: number;
}): 'RETRY_SAME_CONTRACT' | 'FAIL_CLOSED_HANDOFF' {
  if (input.failure === 'TRUTH_CHECK_FAIL' || input.failure === 'AUTHZ_POLICY_FAIL' || input.failure === 'PROMPT_INJECTION_FAIL') {
    return 'FAIL_CLOSED_HANDOFF';
  }
  return input.attemptsSoFar < 1 ? 'RETRY_SAME_CONTRACT' : 'FAIL_CLOSED_HANDOFF';
}
