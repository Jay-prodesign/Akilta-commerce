import type { IdempotencyKey, JobId, MerchantWorkspaceId, OutboxId, UtcTimestamp } from '../../domain/src';
import type { LogicalAsyncTopic } from './async-envelope';
import type { JobRecord } from './job';

export const OUTBOX_DELIVERY_STATES = ['PENDING', 'DELIVERED'] as const;
export type OutboxDeliveryState = (typeof OUTBOX_DELIVERY_STATES)[number];

export interface OutboxRecord {
  readonly outboxId: OutboxId;
  readonly jobId: JobId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly topic: LogicalAsyncTopic;
  readonly idempotencyKey: IdempotencyKey;
  readonly payloadRef: string;
  readonly deliveryState: OutboxDeliveryState;
  readonly createdAt: UtcTimestamp;
  readonly deliveredAt?: UtcTimestamp;
}

export interface StagedActionIntent {
  readonly job: JobRecord;
  readonly outbox: OutboxRecord;
}

/**
 * D-090 I1 / RG-OUTBOX: models the committed-Action-Intent-before-external-effect
 * boundary at the domain level. The job and its outbox record are constructed
 * together from one call and share the same jobId/merchantWorkspaceId/
 * idempotencyKey by construction, so a caller cannot build a divergent pair. The
 * real transactional guarantee (both rows land in the same DB transaction or
 * neither does) is enforced by the single-statement/single-transaction INSERT in
 * migrations/0002_job_run_outbox_quota.sql; this function is the equivalent pure
 * model that a caller composes before ever touching a provider/queue.
 */
export function stageJobWithOutbox(input: {
  readonly job: JobRecord;
  readonly outboxId: OutboxId;
  readonly topic: LogicalAsyncTopic;
  readonly payloadRef: string;
}): StagedActionIntent {
  if (!input.payloadRef.trim()) throw new Error('PAYLOAD_REF_REQUIRED');
  return {
    job: input.job,
    outbox: {
      outboxId: input.outboxId,
      jobId: input.job.jobId,
      merchantWorkspaceId: input.job.merchantWorkspaceId,
      topic: input.topic,
      idempotencyKey: input.job.idempotencyKey,
      payloadRef: input.payloadRef,
      deliveryState: 'PENDING',
      createdAt: input.job.createdAt,
    },
  };
}

export interface OutboxDeliveryRegistry {
  readonly delivered: Set<OutboxId>;
}

export function createOutboxDeliveryRegistry(): OutboxDeliveryRegistry {
  return { delivered: new Set() };
}

export type DeliverOutboxResult =
  | { readonly outcome: 'DELIVERED' }
  | { readonly outcome: 'ALREADY_DELIVERED' };

/**
 * At-least-once delivery, exactly-once external effect: `effect` fires only the
 * first time a given outboxId is delivered through this registry. A replayed
 * delivery attempt (retry, redelivery, dead-letter reprocessing) for an outboxId
 * already marked DELIVERED is recognized and short-circuited before `effect` runs
 * again.
 */
export function deliverOutboxRecord(
  registry: OutboxDeliveryRegistry,
  record: OutboxRecord,
  effect: () => void,
): DeliverOutboxResult {
  if (registry.delivered.has(record.outboxId)) return { outcome: 'ALREADY_DELIVERED' };
  effect();
  registry.delivered.add(record.outboxId);
  return { outcome: 'DELIVERED' };
}
