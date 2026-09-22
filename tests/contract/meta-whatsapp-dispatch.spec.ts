import { idempotencyKey, internalId, utcTimestamp } from '../../packages/domain/src';
import { createJob, createOutboxDeliveryRegistry } from '../../packages/events/src';
import { MockMetaWhatsAppPort } from '../../connectors/meta-whatsapp/src/port';
import { fixtureSendRequest } from '../../connectors/meta-whatsapp/src/fixtures';
import { dispatchMetaWhatsAppSend } from '../../connectors/meta-whatsapp/src/dispatch';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspace = internalId('ws-meta-dispatch', 'MerchantWorkspace');
const now = utcTimestamp('2026-09-22T10:00:00Z');

function stagedJob(suffix: string) {
  const result = createJob({
    jobId: internalId(`job-meta-dispatch-${suffix}`, 'Job'),
    merchantWorkspaceId: workspace,
    capabilityRef: 'meta-whatsapp.send_message@1',
    meteredSpend: false,
    idempotencyKey: idempotencyKey(`meta-dispatch-idem-${suffix}`),
    now,
  });
  assert(result.status === 'CREATED', 'expected job to be created');
  return result.job;
}

async function main(): Promise<void> {
  // D-090 I1: sendMessage cannot be reached except through a staged Action Intent.
  // Proven structurally (dispatchMetaWhatsAppSend is the only export that calls
  // port.sendMessage) and behaviorally: zero effects before dispatch, exactly one after.
  const port = new MockMetaWhatsAppPort('ALWAYS_SUCCEED');
  const registry = createOutboxDeliveryRegistry();
  assert(port.getEffectCount() === 0, 'no provider effect before any dispatch call');

  const job1 = stagedJob('1');
  const outboxId1 = internalId('outbox-meta-dispatch-1', 'Outbox');
  const request1 = fixtureSendRequest({ idempotencyKey: job1.idempotencyKey });
  const first = await dispatchMetaWhatsAppSend(registry, port, {
    job: job1,
    outboxId: outboxId1,
    payloadRef: 'payload:meta-dispatch:1',
    request: request1,
  });
  assert(first.outcome === 'DISPATCHED', 'first delivery of a fresh outboxId must dispatch');
  assert(first.outcome === 'DISPATCHED' && first.result.status === 'SUCCEEDED', 'ALWAYS_SUCCEED mock must report SUCCEEDED');
  assert(port.getEffectCount() === 1, 'exactly one provider effect after the first dispatch');

  // D-090 I1/RG-OUTBOX: replaying the same outboxId must never re-trigger the provider effect.
  const replay = await dispatchMetaWhatsAppSend(registry, port, {
    job: job1,
    outboxId: outboxId1,
    payloadRef: 'payload:meta-dispatch:1',
    request: request1,
  });
  assert(replay.outcome === 'ALREADY_DELIVERED', 'replaying the same outboxId must be recognized, not redelivered');
  assert(port.getEffectCount() === 1, 'a replayed outboxId must not increment the provider effect count');

  // A distinct outboxId (distinct Action Intent) is a distinct, real dispatch.
  const job2 = stagedJob('2');
  const outboxId2 = internalId('outbox-meta-dispatch-2', 'Outbox');
  const request2 = fixtureSendRequest({ idempotencyKey: job2.idempotencyKey });
  const second = await dispatchMetaWhatsAppSend(registry, port, {
    job: job2,
    outboxId: outboxId2,
    payloadRef: 'payload:meta-dispatch:2',
    request: request2,
  });
  assert(second.outcome === 'DISPATCHED', 'a distinct outboxId must dispatch');
  assert(port.getEffectCount() === 2, 'a distinct outboxId must increment the provider effect count');

  // A FAILED provider result is still surfaced as DISPATCHED (the Action Intent was
  // genuinely delivered/attempted) -- staging/delivery success is independent of
  // provider outcome, matching OutboundSendResult's own status field.
  const failingPort = new MockMetaWhatsAppPort('ALWAYS_FAIL');
  const job3 = stagedJob('3');
  const outboxId3 = internalId('outbox-meta-dispatch-3', 'Outbox');
  const request3 = fixtureSendRequest({ idempotencyKey: job3.idempotencyKey });
  const failed = await dispatchMetaWhatsAppSend(registry, failingPort, {
    job: job3,
    outboxId: outboxId3,
    payloadRef: 'payload:meta-dispatch:3',
    request: request3,
  });
  assert(failed.outcome === 'DISPATCHED', 'a FAILED send is still a real, non-replayed dispatch attempt');
  assert(failed.outcome === 'DISPATCHED' && failed.result.status === 'FAILED', 'ALWAYS_FAIL mock must report FAILED through dispatch');

  console.log('meta-whatsapp-dispatch: 10/10 PASS');
}

void main();
