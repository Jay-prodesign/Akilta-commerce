import { evaluateAuthorization } from '../../../packages/authz/src';
import type {
  AuthorizationDecision,
  ExecutionContext,
  ServerResolvedResourceContext,
} from '../../../packages/authz/src';
import type { Permission } from '../../../packages/authz/src/permissions';
import { checkAiCandidate } from '../../../packages/ai-gateway/src';
import type {
  AiGateway,
  AiGatewayCandidate,
  SafeConversationContext,
} from '../../../packages/ai-gateway/src';
import type {
  AgencyClientAssignment,
  Conversation,
  MerchantWorkspaceId,
} from '../../../packages/domain/src';
import type { ErrorCode } from '../../../packages/domain/src/errors';
import type {
  AppendOnlyEventWriter,
  AuditEvent,
  EvaluationEvent,
  IdempotencyRecord,
  IdempotencyRegistry,
  OperationalEvent,
  UsageEvent,
} from '../../../packages/events/src';
import { eventDeduplicationKey } from '../../../packages/events/src';
import {
  resolveFactCandidates,
  type ApprovedFactSet,
  type FactCandidate,
  type TruthAuthorityPolicy,
} from '../../../packages/truth-policy/src';

export interface RequestedFact {
  readonly factClass: string;
  readonly factKey: string;
}

export interface EvidencePlan {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly intent: string;
  readonly requestedFacts: readonly RequestedFact[];
}

/** Returns normalized/evidence-classified facts only; never raw unrestricted provider payloads. */
export interface EvidenceLookup {
  collect(plan: EvidencePlan): Promise<readonly FactCandidate[]>;
}

export interface GroundedResponseEventFactory {
  audit(input: {
    readonly decision: AuditEvent['decision'];
    readonly result: string;
    readonly matchedPermissionOrPolicyRef?: string;
  }): AuditEvent;
  evaluation(input: {
    readonly stage: EvaluationEvent['stage'];
    readonly safePayload?: unknown;
    readonly errorCode?: ErrorCode;
    readonly modelRef?: string;
  }): EvaluationEvent;
  usage(input: {
    readonly logicalOperationRef: string;
    readonly providerType: string;
    readonly providerOperation: string;
    readonly providerUsageRef?: string;
  }): UsageEvent;
}

export interface GroundedResponseInput {
  readonly inboundEvent: OperationalEvent;
  readonly executionContext: ExecutionContext;
  readonly target: ServerResolvedResourceContext;
  readonly agencyAssignment?: AgencyClientAssignment;
  readonly requiredPermission: Permission;
  readonly module: string;
  readonly conversation: Conversation;
  readonly intent: string;
  readonly requestedFacts: readonly RequestedFact[];
  readonly truthPolicies: readonly TruthAuthorityPolicy[];
  readonly approvedFactSetId: ApprovedFactSet['approvedFactSetId'];
  readonly safeConversationContext: SafeConversationContext;
  readonly responsePolicyRef: string;
  readonly allowedAiTools: readonly string[];
}

export type GroundedResponseOutcome =
  | {
      readonly outcome: 'DUPLICATE';
      readonly code: 'EVENT_DUPLICATE';
    }
  | {
      readonly outcome: 'DENIED';
      readonly code: Extract<ErrorCode, 'AUTH_TENANT_MISMATCH' | 'AUTH_PERMISSION_DENIED'>;
      readonly authorization: AuthorizationDecision;
    }
  | {
      readonly outcome: 'HANDOFF_REQUIRED';
      readonly code: Extract<
        ErrorCode,
        | 'TRUTH_MISSING'
        | 'TRUTH_CONFLICT'
        | 'AI_OUTPUT_POLICY_FAIL'
        | 'AI_OUTPUT_GROUNDEDNESS_FAIL'
      >;
      readonly approvedFactSet?: ApprovedFactSet;
      readonly candidate?: AiGatewayCandidate;
    }
  | {
      readonly outcome: 'SUGGEST_ONLY';
      readonly approvedFactSet: ApprovedFactSet;
      readonly candidate: AiGatewayCandidate;
      readonly reason: 'CONVERSATION_NOT_AI_ACTIVE';
    }
  | {
      /** Provider send is deliberately outside P0-016. This result is a validated send candidate, not a sent Message. */
      readonly outcome: 'SEND_CANDIDATE_READY';
      readonly approvedFactSet: ApprovedFactSet;
      readonly candidate: AiGatewayCandidate;
      readonly plannedOwnershipEpoch: number;
    };

export interface GroundedResponseDependencies {
  readonly evidenceLookup: EvidenceLookup;
  readonly aiGateway: AiGateway;
  readonly idempotencyRegistry: IdempotencyRegistry;
  readonly auditWriter: AppendOnlyEventWriter<AuditEvent>;
  readonly evaluationWriter: AppendOnlyEventWriter<EvaluationEvent>;
  readonly usageWriter: AppendOnlyEventWriter<UsageEvent>;
  readonly eventFactory: GroundedResponseEventFactory;
}

async function appendEvaluation(
  deps: GroundedResponseDependencies,
  input: Parameters<GroundedResponseEventFactory['evaluation']>[0],
): Promise<void> {
  await deps.evaluationWriter.append(deps.eventFactory.evaluation(input));
}

function truthFailure(factSet: ApprovedFactSet): 'TRUTH_MISSING' | 'TRUTH_CONFLICT' | null {
  if (factSet.conflicts.length > 0) return 'TRUTH_CONFLICT';
  if (factSet.unknowns.length > 0) return 'TRUTH_MISSING';
  return null;
}

function sameWorkspace(input: GroundedResponseInput): boolean {
  const workspace = input.executionContext.activeMerchantWorkspaceId;
  return (
    workspace !== null &&
    input.inboundEvent.merchantWorkspaceId === workspace &&
    input.target.merchantWorkspaceId === workspace &&
    input.conversation.merchantWorkspaceId === workspace
  );
}

export async function orchestrateGroundedResponse(
  input: GroundedResponseInput,
  deps: GroundedResponseDependencies,
): Promise<GroundedResponseOutcome> {
  const dedupeKey = eventDeduplicationKey(input.inboundEvent);
  const idempotencyRecord: IdempotencyRecord = {
    merchantWorkspaceId: input.inboundEvent.merchantWorkspaceId,
    namespace: 'grounded-response.inbound',
    idempotencyKey: input.inboundEvent.idempotencyKey,
    firstEventId: input.inboundEvent.eventId,
    state: 'IN_PROGRESS',
    createdAt: input.inboundEvent.observedAt,
    updatedAt: input.inboundEvent.observedAt,
  };
  const inserted = await deps.idempotencyRegistry.putIfAbsent(idempotencyRecord);
  if (inserted === 'EXISTS') {
    await appendEvaluation(deps, {
      stage: 'CHECK',
      safePayload: { result: 'DUPLICATE', dedupeKey },
      errorCode: 'EVENT_DUPLICATE',
    });
    return { outcome: 'DUPLICATE', code: 'EVENT_DUPLICATE' };
  }

  await appendEvaluation(deps, {
    stage: 'INPUT',
    safePayload: {
      inboundEventId: input.inboundEvent.eventId,
      intent: input.intent,
      conversationId: input.conversation.conversationId,
    },
  });

  if (!sameWorkspace(input)) {
    const authorization: AuthorizationDecision = {
      decision: 'DENY',
      code: 'AUTH_TENANT_MISMATCH',
      reason: 'ACTIVE_WORKSPACE_MISMATCH',
    };
    await deps.auditWriter.append(
      deps.eventFactory.audit({ decision: 'DENY', result: authorization.reason }),
    );
    await appendEvaluation(deps, {
      stage: 'CHECK',
      safePayload: { authorization: authorization.reason },
      errorCode: authorization.code,
    });
    return { outcome: 'DENIED', code: authorization.code, authorization };
  }

  const authorization = evaluateAuthorization({
    executionContext: input.executionContext,
    requiredPermission: input.requiredPermission,
    target: input.target,
    module: input.module,
    ...(input.agencyAssignment ? { agencyAssignment: input.agencyAssignment } : {}),
  });
  if (authorization.decision === 'DENY') {
    await deps.auditWriter.append(
      deps.eventFactory.audit({ decision: 'DENY', result: authorization.reason }),
    );
    await appendEvaluation(deps, {
      stage: 'CHECK',
      safePayload: { authorization: authorization.reason },
      errorCode: authorization.code,
    });
    return { outcome: 'DENIED', code: authorization.code, authorization };
  }

  await deps.auditWriter.append(
    deps.eventFactory.audit({
      decision: 'ALLOW',
      result: 'GROUND_RESPONSE_READ_AND_DRAFT_ALLOWED',
      matchedPermissionOrPolicyRef: authorization.matchedGrantSourceRef,
    }),
  );

  const evidencePlan: EvidencePlan = {
    merchantWorkspaceId: input.inboundEvent.merchantWorkspaceId,
    intent: input.intent,
    requestedFacts: input.requestedFacts,
  };
  const candidates = await deps.evidenceLookup.collect(evidencePlan);
  const factSet = resolveFactCandidates({
    approvedFactSetId: input.approvedFactSetId,
    merchantWorkspaceId: input.inboundEvent.merchantWorkspaceId,
    intent: input.intent,
    policies: input.truthPolicies,
    requestedFacts: input.requestedFacts,
    candidates,
    generatedAt: input.inboundEvent.observedAt,
  });
  await appendEvaluation(deps, {
    stage: 'RETRIEVAL',
    safePayload: {
      resolvedFactCount: factSet.resolvedFacts.length,
      unknownCount: factSet.unknowns.length,
      conflictCount: factSet.conflicts.length,
    },
  });

  const truthError = truthFailure(factSet);
  if (truthError) {
    await appendEvaluation(deps, {
      stage: 'CHECK',
      safePayload: { result: truthError },
      errorCode: truthError,
    });
    return { outcome: 'HANDOFF_REQUIRED', code: truthError, approvedFactSet: factSet };
  }

  const aiRequest = {
    merchantWorkspaceId: input.inboundEvent.merchantWorkspaceId,
    runId: input.executionContext.runId,
    locale: input.executionContext.locale,
    approvedFactSet: factSet,
    conversationContext: input.safeConversationContext,
    responsePolicyRef: input.responsePolicyRef,
    toolPolicy: { allowedTools: input.allowedAiTools, actionAuthority: 'NONE' as const },
  };
  const candidate = await deps.aiGateway.generateResponse(aiRequest);
  await appendEvaluation(deps, {
    stage: 'FIRST_OUTPUT',
    safePayload: {
      candidateText: candidate.candidateText,
      claimedFacts: candidate.claimedFacts,
      requestedTools: candidate.requestedTools.map((tool) => tool.toolName),
    },
    modelRef: candidate.modelRef,
  });

  await deps.usageWriter.append(
    deps.eventFactory.usage({
      logicalOperationRef: `grounded-response:${input.inboundEvent.eventId}`,
      providerType: 'AI',
      providerOperation: 'generate_response',
    }),
  );

  const check = checkAiCandidate(aiRequest, candidate);
  if (check.result === 'FAIL') {
    await appendEvaluation(deps, {
      stage: 'CHECK',
      safePayload: { result: check.reason },
      errorCode: check.code,
      modelRef: candidate.modelRef,
    });
    return {
      outcome: 'HANDOFF_REQUIRED',
      code: check.code,
      approvedFactSet: factSet,
      candidate,
    };
  }

  await appendEvaluation(deps, {
    stage: 'CHECK',
    safePayload: { result: 'PASS' },
    modelRef: candidate.modelRef,
  });
  await appendEvaluation(deps, {
    stage: 'FINAL_OUTPUT',
    safePayload: { candidateText: candidate.candidateText },
    modelRef: candidate.modelRef,
  });

  if (input.conversation.ownershipState !== 'AI_ACTIVE') {
    return {
      outcome: 'SUGGEST_ONLY',
      approvedFactSet: factSet,
      candidate,
      reason: 'CONVERSATION_NOT_AI_ACTIVE',
    };
  }

  return {
    outcome: 'SEND_CANDIDATE_READY',
    approvedFactSet: factSet,
    candidate,
    plannedOwnershipEpoch: input.conversation.ownershipEpoch,
  };
}
