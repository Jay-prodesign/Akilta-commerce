import type { OutboundSendResult } from '../../../packages/domain/src';
import type { JobRecord } from '../../../packages/events/src/job';
import type { OutboxDeliveryRegistry } from '../../../packages/events/src/outbox';
import { deliverOutboxRecord, stageJobWithOutbox } from '../../../packages/events/src/outbox';
import type { OutboxId } from '../../../packages/domain/src';
import type { MetaWhatsAppPort, MetaWhatsAppSendRequest } from './port';

export interface DispatchMetaWhatsAppSendInput {
  /** Caller-committed Job (D-088 minimum Job/Run schema) -- constructed via createJob before this is called. */
  readonly job: JobRecord;
  readonly outboxId: OutboxId;
  readonly payloadRef: string;
  readonly request: MetaWhatsAppSendRequest;
}

export type DispatchMetaWhatsAppSendResult =
  | { readonly outcome: 'DISPATCHED'; readonly result: OutboundSendResult }
  | { readonly outcome: 'ALREADY_DELIVERED' };

/**
 * D-090 I1/RG-OUTBOX applied to the P0-017 Lane-A send path: stages a committed
 * Action Intent (job + outbox record, sharing one idempotencyKey by construction)
 * *before* the port's provider-side effect can run at all -- there is no path in
 * this function that calls `port.sendMessage` without a `StagedActionIntent`
 * already in hand. `deliverOutboxRecord`'s at-least-once/exactly-once-effect
 * registry then guarantees a replayed `outboxId` short-circuits before the
 * closure that calls `port.sendMessage` ever runs again, so a redelivered outbox
 * entry can never trigger a second provider-side send.
 *
 * `deliverOutboxRecord`'s `effect` is synchronous (existing job/outbox contract,
 * shared with every other topic); the port's send is async. This function bridges
 * the two locally -- capturing the in-flight promise inside the synchronous
 * closure and awaiting it only after confirming the closure actually ran (i.e.
 * this delivery was not a replay) -- without changing the shared outbox contract.
 */
export async function dispatchMetaWhatsAppSend(
  registry: OutboxDeliveryRegistry,
  port: MetaWhatsAppPort,
  input: DispatchMetaWhatsAppSendInput,
): Promise<DispatchMetaWhatsAppSendResult> {
  const staged = stageJobWithOutbox({
    job: input.job,
    outboxId: input.outboxId,
    topic: 'action.execute',
    payloadRef: input.payloadRef,
  });

  let sendPromise: Promise<OutboundSendResult> | undefined;
  const delivery = deliverOutboxRecord(registry, staged.outbox, () => {
    sendPromise = port.sendMessage(input.request);
  });

  if (delivery.outcome === 'ALREADY_DELIVERED') {
    return { outcome: 'ALREADY_DELIVERED' };
  }
  if (!sendPromise) {
    throw new Error('UNREACHABLE_DELIVERED_WITHOUT_EFFECT: deliverOutboxRecord reported DELIVERED but its effect did not run');
  }
  const result = await sendPromise;
  return { outcome: 'DISPATCHED', result };
}
