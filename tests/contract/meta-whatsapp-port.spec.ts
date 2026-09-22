import { idempotencyKey, internalId, materializeSentMessage, utcTimestamp } from '../../packages/domain/src';
import { MockMetaWhatsAppPort, sendAndMaterialize } from '../../connectors/meta-whatsapp/src/port';
import { fixtureSendRequest } from '../../connectors/meta-whatsapp/src/fixtures';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  // D-103 Lane A: successful mock send materializes a real Message via the same
  // domain-level guarantee every other channel uses (materializeSentMessage).
  const port = new MockMetaWhatsAppPort('ALWAYS_SUCCEED');
  const request = fixtureSendRequest();
  const { result, message } = await sendAndMaterialize(port, request, (sendResult) =>
    materializeSentMessage({
      messageId: internalId('meta-whatsapp-materialized-1', 'Message'),
      conversationId: request.conversationId,
      senderType: 'AI',
      contentType: request.contentType,
      sentAt: utcTimestamp('2026-09-22T10:00:00Z'),
      result: sendResult,
      ...(request.safeText !== undefined ? { safeText: request.safeText } : {}),
    }),
  );
  assert(result.status === 'SUCCEEDED', 'ALWAYS_SUCCEED mock must succeed');
  assert(message !== undefined, 'Successful send must materialize a Message');
  assert(message?.direction === 'OUTBOUND', 'Materialized message must be OUTBOUND');
  assert(message?.finalSendActor === 'AI', 'Materialized message must record AI as final send actor');
  assert(message?.channelMessageRef === result.providerMessageRef, 'Materialized message channelMessageRef must come from the send result');

  // D-090 I2: same idempotencyKey must never cause a second provider-side effect.
  const replay = await port.sendMessage(request);
  assert(replay.providerMessageRef === result.providerMessageRef, 'Replayed idempotencyKey must return the identical prior result');
  assert(port.getEffectCount() === 1, 'A replayed idempotencyKey must not increment the effect count');
  const audit = port.getAudit();
  assert(audit.length === 2, 'Audit must record both the original send and the replay');
  assert(audit[0]?.replay === false && audit[1]?.replay === true, 'Audit must distinguish original send from replay');

  // Distinct idempotencyKeys are distinct effects.
  const secondRequest = fixtureSendRequest({ idempotencyKey: idempotencyKey('meta-whatsapp-fixture-send-2') });
  const secondResult = await port.sendMessage(secondRequest);
  assert(port.getEffectCount() === 2, 'A distinct idempotencyKey must increment the effect count');
  assert(secondResult.providerMessageRef !== result.providerMessageRef, 'Distinct sends must get distinct providerMessageRef values');

  // ALWAYS_FAIL: a failed send must never materialize a Message.
  const failingPort = new MockMetaWhatsAppPort('ALWAYS_FAIL');
  let materializeCalled = false;
  const failed = await sendAndMaterialize(failingPort, fixtureSendRequest({ idempotencyKey: idempotencyKey('meta-whatsapp-fixture-send-fail') }), () => {
    materializeCalled = true;
    throw new Error('materialize must not be called on FAILED send');
  });
  assert(failed.result.status === 'FAILED', 'ALWAYS_FAIL mock must report FAILED');
  assert(failed.message === undefined, 'A FAILED send must not produce a Message');
  assert(materializeCalled === false, 'materialize callback must not run for a FAILED send');

  console.log('meta-whatsapp-port: 10/10 PASS');
}

void main();
