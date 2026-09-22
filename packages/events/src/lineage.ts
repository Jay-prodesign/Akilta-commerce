import { DomainPrimitiveError, assertNonEmptyString, type Brand } from '../../domain/src/brand';
import type {
  AuditEventId,
  CorrelationId,
  EvaluationEventId,
  EventId,
  MerchantWorkspaceId,
  OrganizationId,
  RequestId,
  RunId,
  UserId,
  UtcTimestamp,
} from '../../domain/src';
import type { ErrorCode } from '../../domain/src/errors';

export type TrainingEligibility = Brand<string, 'TrainingEligibility'>;
export const NOT_CLASSIFIED = 'NOT_CLASSIFIED' as TrainingEligibility;

export function trainingEligibility(value: string): TrainingEligibility {
  return assertNonEmptyString(value, 'TrainingEligibility') as TrainingEligibility;
}

export type AuditDecision = 'ALLOW' | 'DENY' | 'APPROVAL_REQUIRED';

export interface AuditEvent {
  readonly auditEventId: AuditEventId;
  readonly actorUserId?: UserId;
  readonly actorOrganizationId?: OrganizationId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly resourceType: string;
  readonly resourceId?: string;
  readonly action: string;
  readonly decision: AuditDecision;
  readonly matchedPermissionOrPolicyRef?: string;
  readonly requestId?: RequestId;
  readonly runId: RunId;
  readonly correlationId: CorrelationId;
  readonly result: string;
  readonly occurredAt: UtcTimestamp;
}

export const EVALUATION_STAGES = [
  'INPUT',
  'RETRIEVAL',
  'FIRST_OUTPUT',
  'CHECK',
  'CORRECTION',
  'FINAL_OUTPUT',
  'EXECUTION',
  'POST_READ',
  'OUTCOME',
] as const;

export type EvaluationStage = (typeof EVALUATION_STAGES)[number];

export interface EvaluationEvent<Payload = unknown> {
  readonly evaluationEventId: EvaluationEventId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly runId: RunId;
  readonly parentEventId?: EventId | EvaluationEventId;
  readonly stage: EvaluationStage;
  readonly modelRef?: string;
  readonly toolRef?: string;
  readonly versionRef?: string;
  readonly errorCode?: ErrorCode;
  readonly trainingEligibility: TrainingEligibility;
  readonly privacyClassification: string;
  readonly redactionState: string;
  readonly safePayload?: Payload;
  readonly payloadRef?: string;
  readonly occurredAt: UtcTimestamp;
}

const stageRank = new Map<EvaluationStage, number>(
  EVALUATION_STAGES.map((stage, index) => [stage, index]),
);

export function assertEvaluationAppend(
  existing: readonly EvaluationEvent[],
  candidate: EvaluationEvent,
): void {
  if (existing.some((event) => event.evaluationEventId === candidate.evaluationEventId)) {
    throw new DomainPrimitiveError('EvaluationEvent IDs are immutable and cannot be appended twice');
  }

  const sameRun = existing.filter(
    (event) =>
      event.runId === candidate.runId && event.merchantWorkspaceId === candidate.merchantWorkspaceId,
  );
  const previous = sameRun.at(-1);
  if (!previous) return;

  const previousRank = stageRank.get(previous.stage);
  const candidateRank = stageRank.get(candidate.stage);
  if (previousRank === undefined || candidateRank === undefined) {
    throw new DomainPrimitiveError('Unknown evaluation stage');
  }

  if (candidateRank < previousRank) {
    throw new DomainPrimitiveError('Evaluation lineage cannot silently regress to an earlier stage');
  }
}

/** Append-only persistence: no update/delete mutation method exists by contract. */
export interface AppendOnlyEventWriter<T> {
  append(event: T): Promise<void>;
}
