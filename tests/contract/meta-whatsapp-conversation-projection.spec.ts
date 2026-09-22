import { internalId, utcTimestamp } from '../../packages/domain/src';
import { projectConversationAfterDispatch } from '../../connectors/meta-whatsapp/src/conversation-projection';
import { fixtureConversation } from '../../connectors/meta-whatsapp/src/fixtures';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function main(): void {
  const sentAt = utcTimestamp('2026-09-22T15:00:00Z');

  // A SUCCEEDED result materializes a Message and advances a Conversation with no
  // prior lastMessageAt.
  const fresh = fixtureConversation();
  const succeeded = projectConversationAfterDispatch({
    conversation: fresh,
    messageId: internalId('proj-message-1', 'Message'),
    senderType: 'AI',
    contentType: 'text/plain',
    safeText: 'Siparişiniz kargoya verildi.',
    sentAt,
    result: { status: 'SUCCEEDED', providerMessageRef: 'mock-send-1' },
  });
  assert(succeeded.outcome === 'PROJECTED', 'a SUCCEEDED result must project');
  assert(succeeded.outcome === 'PROJECTED' && succeeded.message.direction === 'OUTBOUND', 'materialized message must be OUTBOUND');
  assert(succeeded.outcome === 'PROJECTED' && succeeded.message.channelMessageRef === 'mock-send-1', 'materialized message must carry the provider ref');
  assert(succeeded.outcome === 'PROJECTED' && succeeded.conversation.lastMessageAt === sentAt, 'lastMessageAt must advance from undefined');
  assert(succeeded.outcome === 'PROJECTED' && succeeded.conversation.lastOutboundAt === sentAt, 'lastOutboundAt must advance from undefined');

  // A FAILED result never materializes a Message and never advances Conversation state.
  const failed = projectConversationAfterDispatch({
    conversation: fresh,
    messageId: internalId('proj-message-2', 'Message'),
    senderType: 'AI',
    contentType: 'text/plain',
    sentAt,
    result: { status: 'FAILED' },
  });
  assert(failed.outcome === 'NOT_SENT', 'a FAILED result must not project');

  // Out-of-order delivery: an older sentAt than the Conversation's current
  // lastMessageAt must not regress the projection (reuses shouldAdvanceMonotonicProjection).
  const advanced = fixtureConversation({ lastMessageAt: utcTimestamp('2026-09-22T16:00:00Z') });
  const staleDelivery = projectConversationAfterDispatch({
    conversation: advanced,
    messageId: internalId('proj-message-3', 'Message'),
    senderType: 'AI',
    contentType: 'text/plain',
    sentAt: utcTimestamp('2026-09-22T15:30:00Z'), // older than advanced.lastMessageAt
    result: { status: 'SUCCEEDED', providerMessageRef: 'mock-send-3' },
  });
  assert(staleDelivery.outcome === 'PROJECTED', 'a stale-but-successful send still materializes a Message');
  assert(
    staleDelivery.outcome === 'PROJECTED' && staleDelivery.conversation.lastMessageAt === advanced.lastMessageAt,
    'an out-of-order sentAt must not regress lastMessageAt',
  );
  assert(
    staleDelivery.outcome === 'PROJECTED' && staleDelivery.conversation === advanced,
    'a non-advancing projection must return the original Conversation object unchanged, not a mutated copy',
  );

  // Equal timestamp: sentAt exactly equal to the Conversation's current lastMessageAt
  // must not advance either (shouldAdvanceMonotonicProjection uses strict >, not >=).
  const equalTimestamp = utcTimestamp('2026-09-22T16:00:00Z'); // exactly advanced.lastMessageAt
  const equalDelivery = projectConversationAfterDispatch({
    conversation: advanced,
    messageId: internalId('proj-message-5', 'Message'),
    senderType: 'AI',
    contentType: 'text/plain',
    sentAt: equalTimestamp,
    result: { status: 'SUCCEEDED', providerMessageRef: 'mock-send-5' },
  });
  assert(equalDelivery.outcome === 'PROJECTED', 'an equal-timestamp successful send still materializes a Message');
  assert(
    equalDelivery.outcome === 'PROJECTED' && equalDelivery.conversation.lastMessageAt === advanced.lastMessageAt,
    'an equal sentAt must not advance lastMessageAt (strict > semantics, not >=)',
  );
  assert(
    equalDelivery.outcome === 'PROJECTED' && equalDelivery.conversation === advanced,
    'an equal-timestamp non-advancing projection must return the original Conversation object unchanged',
  );

  // A newer sentAt than the current lastMessageAt does advance the projection.
  const newer = projectConversationAfterDispatch({
    conversation: advanced,
    messageId: internalId('proj-message-4', 'Message'),
    senderType: 'AI',
    contentType: 'text/plain',
    sentAt: utcTimestamp('2026-09-22T17:00:00Z'), // newer than advanced.lastMessageAt
    result: { status: 'SUCCEEDED', providerMessageRef: 'mock-send-4' },
  });
  assert(newer.outcome === 'PROJECTED', 'a newer successful send must project');
  assert(
    newer.outcome === 'PROJECTED' && newer.conversation.lastMessageAt === utcTimestamp('2026-09-22T17:00:00Z'),
    'a genuinely newer sentAt must advance lastMessageAt',
  );

  console.log('meta-whatsapp-conversation-projection: 14/14 PASS');
}

main();
