import type {
  CorrelationId,
  EventId,
  IdempotencyKey,
  IntegrationId,
  MerchantWorkspaceId,
  UtcTimestamp,
} from '../../domain/src';

export const EVENT_PROCESSING_STATES = [
  'RECEIVED',
  'PROCESSING',
  'PROCESSED',
  'FAILED_RETRYABLE',
  'FAILED_TERMINAL',
] as const;

export type EventProcessingState = (typeof EVENT_PROCESSING_STATES)[number];

export interface OperationalEvent<Payload = unknown> {
  readonly eventId: EventId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  /** Current server-resolved integration binding when the event originates from an integration/provider path. */
  readonly integrationId?: IntegrationId;
  readonly eventType: string;
  readonly source: string;
  readonly sourceEventId?: string;
  /** Provider/source-origin event timestamp when explicitly supplied. Never substitute observedAt. */
  readonly sourceTimestamp?: UtcTimestamp;
  /** AI Commerce receipt/capture time. Always required. */
  readonly observedAt: UtcTimestamp;
  readonly correlationId: CorrelationId;
  readonly causationEventId?: EventId;
  readonly idempotencyKey: IdempotencyKey;
  readonly payloadRef?: string;
  readonly safePayload?: Payload;
  readonly processingState: EventProcessingState;
}

export function eventDeduplicationKey(event: OperationalEvent): string {
  const integrationScope = event.integrationId ? `integration:${event.integrationId}` : 'integration:none';
  const externalIdentity = event.sourceEventId
    ? `source:${event.source}:${event.sourceEventId}`
    : `idempotency:${event.idempotencyKey}`;
  return `${event.merchantWorkspaceId}:${integrationScope}:${event.eventType}:${externalIdentity}`;
}

export function classifyDelivery(
  previouslySeenKeys: ReadonlySet<string>,
  event: OperationalEvent,
): 'ACCEPT' | 'DUPLICATE' {
  return previouslySeenKeys.has(eventDeduplicationKey(event)) ? 'DUPLICATE' : 'ACCEPT';
}

export function shouldAdvanceMonotonicProjection(
  currentSourceTimestamp: UtcTimestamp | null | undefined,
  incomingSourceTimestamp: UtcTimestamp | null | undefined,
): boolean {
  if (incomingSourceTimestamp === null || incomingSourceTimestamp === undefined) return false;
  if (currentSourceTimestamp === null || currentSourceTimestamp === undefined) return true;
  return new Date(incomingSourceTimestamp).getTime() > new Date(currentSourceTimestamp).getTime();
}

export interface IdempotencyRecord {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly namespace: string;
  readonly idempotencyKey: IdempotencyKey;
  readonly firstEventId: EventId;
  readonly state: 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_TERMINAL';
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface IdempotencyRegistry {
  get(merchantWorkspaceId: MerchantWorkspaceId, namespace: string, key: IdempotencyKey): Promise<IdempotencyRecord | null>;
  putIfAbsent(record: IdempotencyRecord): Promise<'INSERTED' | 'EXISTS'>;
}
