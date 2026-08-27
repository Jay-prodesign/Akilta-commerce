import {
  idempotencyKey,
  internalId,
  money,
  utcTimestamp,
  type CorrelationId,
  type MerchantWorkspaceId,
  type RunId,
} from '../../packages/domain/src';
import {
  NOT_CLASSIFIED,
  assertEvaluationAppend,
  classifyDelivery,
  eventDeduplicationKey,
  logicalUsageKey,
  rateCardVersion,
  reconciliationState,
  shouldAdvanceMonotonicProjection,
  shouldCountLogicalUsage,
  usageCostState,
  usageUnit,
  type EvaluationEvent,
  type OperationalEvent,
  type UsageEvent,
} from '../../packages/events/src';

const workspace = internalId('ws-a', 'MerchantWorkspace') as MerchantWorkspaceId;
const run = internalId('run-events-1', 'Run') as RunId;
const correlation = internalId('corr-events-1', 'Correlation') as CorrelationId;

function event(id: string, sourceEventId: string, sourceTimestamp: string): OperationalEvent {
  return {
    eventId: internalId(id, 'OperationalEvent'),
    merchantWorkspaceId: workspace,
    eventType: 'message.inbound',
    source: 'synthetic',
    sourceEventId,
    sourceTimestamp: utcTimestamp(sourceTimestamp),
    observedAt: utcTimestamp('2026-08-07T18:10:00Z'),
    correlationId: correlation,
    idempotencyKey: idempotencyKey(`idem-${sourceEventId}`),
    processingState: 'RECEIVED',
    safePayload: { text: 'safe fixture' },
  };
}

const first = event('event-1', 'provider-event-1', '2026-08-07T18:00:00Z');
const duplicate = event('event-2', 'provider-event-1', '2026-08-07T18:00:00Z');
const older = event('event-3', 'provider-event-older', '2026-08-07T17:59:00Z');

const evalFirst: EvaluationEvent = {
  evaluationEventId: internalId('eval-1', 'EvaluationEvent'),
  merchantWorkspaceId: workspace,
  runId: run,
  stage: 'FIRST_OUTPUT',
  trainingEligibility: NOT_CLASSIFIED,
  privacyClassification: 'SYNTHETIC',
  redactionState: 'SAFE',
  safePayload: { answer: 'first' },
  occurredAt: utcTimestamp('2026-08-07T18:01:00Z'),
};
const evalCorrection: EvaluationEvent = {
  ...evalFirst,
  evaluationEventId: internalId('eval-2', 'EvaluationEvent'),
  stage: 'CORRECTION',
  safePayload: { answer: 'corrected' },
  occurredAt: utcTimestamp('2026-08-07T18:02:00Z'),
};

const usage: UsageEvent = {
  usageEventId: internalId('usage-1', 'UsageEvent'),
  merchantWorkspaceId: workspace,
  module: 'agent-assist',
  runId: run,
  correlationId: correlation,
  logicalOperationRef: 'reply-42',
  providerType: 'synthetic-ai',
  providerOperation: 'generate',
  quantity: 1n,
  unit: usageUnit('logical_operation'),
  rateCardVersion: rateCardVersion('unpriced-v0'),
  estimatedFlag: false,
  reconciliationState: reconciliationState('PENDING'),
  occurredAt: utcTimestamp('2026-08-07T18:03:00Z'),
};
const usageWithCost: UsageEvent = { ...usage, providerCost: money(25n, 'USD') };

let appendPass = true;
try {
  assertEvaluationAppend([evalFirst], evalCorrection);
} catch {
  appendPass = false;
}

let regressionRejected = false;
try {
  assertEvaluationAppend([evalCorrection], {
    ...evalFirst,
    evaluationEventId: internalId('eval-3', 'EvaluationEvent'),
    stage: 'INPUT',
  });
} catch {
  regressionRejected = true;
}

export const EVENT_LINEAGE_SCENARIOS = [
  {
    id: 'VS-08-DUPLICATE-INBOUND',
    actual: classifyDelivery(new Set([eventDeduplicationKey(first)]), duplicate),
    expected: 'DUPLICATE',
  },
  {
    id: 'VS-10-OLDER-STATUS-NO-REGRESSION',
    actual: shouldAdvanceMonotonicProjection(first.sourceTimestamp, older.sourceTimestamp),
    expected: false,
  },
  {
    id: 'VS-10-EVALUATION-APPEND-FORWARD',
    actual: appendPass,
    expected: true,
  },
  {
    id: 'TM-15-EVALUATION-REGRESSION-REJECTED',
    actual: regressionRejected,
    expected: true,
  },
  {
    id: 'P0-005-TRAINING-DEFAULT-NOT-CLASSIFIED',
    actual: evalFirst.trainingEligibility,
    expected: NOT_CLASSIFIED,
  },
  {
    id: 'F-USAGE-01-RETRY-NO-LOGICAL-DOUBLE-COUNT',
    actual: shouldCountLogicalUsage(new Set([logicalUsageKey(usage)]), { ...usage, usageEventId: internalId('usage-2', 'UsageEvent') }),
    expected: false,
  },
  {
    id: 'P0-006-UNKNOWN-COST-NOT-ZERO',
    actual: usageCostState(usage),
    expected: 'UNKNOWN',
  },
  {
    id: 'P0-006-KNOWN-COST',
    actual: usageCostState(usageWithCost),
    expected: 'KNOWN',
  },
] as const;

let eventLineagePass = 0;
for (const scenario of EVENT_LINEAGE_SCENARIOS) {
  if (JSON.stringify(scenario.actual) === JSON.stringify(scenario.expected)) eventLineagePass += 1;
  else throw new Error(`${scenario.id}: expected ${JSON.stringify(scenario.expected)} got ${JSON.stringify(scenario.actual)}`);
}
console.log(`EVENT_LINEAGE_SCENARIOS ${eventLineagePass}/${EVENT_LINEAGE_SCENARIOS.length} PASS`);
