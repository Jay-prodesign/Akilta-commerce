import type {
  CorrelationId,
  EventId,
  IdempotencyKey,
  IntegrationId,
  MerchantWorkspaceId,
  UtcTimestamp,
} from '../../domain/src';

export const LOGICAL_ASYNC_TOPICS = [
  'ingress.events',
  'conversation.process',
  'commerce.sync_or_reconcile',
  'action.execute',
  'provider.status_reconcile',
  'evaluation.append',
  'usage.append',
  'dead_letter.quarantine',
] as const;
export type LogicalAsyncTopic = (typeof LOGICAL_ASYNC_TOPICS)[number];

export interface AsyncEventEnvelope {
  readonly schemaVersion: '1';
  readonly topic: LogicalAsyncTopic;
  readonly eventId: EventId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly integrationId?: IntegrationId;
  readonly source: string;
  readonly sourceEventId?: string;
  /** Provider/source-origin event time when available. Never substitute observedAt. */
  readonly sourceTimestamp?: UtcTimestamp;
  /** AI Commerce receipt/capture time. */
  readonly observedAt: UtcTimestamp;
  readonly correlationId: CorrelationId;
  readonly causationEventId?: EventId;
  readonly idempotencyKey: IdempotencyKey;
  readonly priorityClass?: 'LOW' | 'NORMAL' | 'HIGH';
  readonly payloadType: string;
  readonly safePayloadRef: string;
}


export interface ServerResolvedAsyncIntegrationBinding {
  readonly integrationId: IntegrationId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
}

export type AsyncEventTenantBindingValidation =
  | { readonly status: 'VALID' }
  | { readonly status: 'INVALID'; readonly reason: 'INTEGRATION_BINDING_REQUIRED' | 'INTEGRATION_ID_MISMATCH' | 'INTEGRATION_WORKSPACE_MISMATCH' };

/**
 * Internal async envelopes are routing data, not tenant authority snapshots.
 * When an envelope carries integrationId, consumers that persist/reroute/quarantine it must
 * compare that pair against current server-resolved Integration state before trusting it.
 */
export function validateAsyncEventTenantBinding(input: {
  readonly envelope: AsyncEventEnvelope;
  readonly serverResolvedIntegration?: ServerResolvedAsyncIntegrationBinding;
}): AsyncEventTenantBindingValidation {
  if (input.envelope.integrationId === undefined) return { status: 'VALID' };
  if (input.serverResolvedIntegration === undefined) {
    return { status: 'INVALID', reason: 'INTEGRATION_BINDING_REQUIRED' };
  }
  if (input.serverResolvedIntegration.integrationId !== input.envelope.integrationId) {
    return { status: 'INVALID', reason: 'INTEGRATION_ID_MISMATCH' };
  }
  if (input.serverResolvedIntegration.merchantWorkspaceId !== input.envelope.merchantWorkspaceId) {
    return { status: 'INVALID', reason: 'INTEGRATION_WORKSPACE_MISMATCH' };
  }
  return { status: 'VALID' };
}
