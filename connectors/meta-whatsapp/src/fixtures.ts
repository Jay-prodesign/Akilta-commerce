import { idempotencyKey, internalId } from '../../../packages/domain/src';
import type { ConversationId, MessageId } from '../../../packages/domain/src';
import type { MetaWhatsAppSendRequest } from './port';

/** Deterministic fixtures only. No real WhatsApp thread/phone reference is encoded here. */
export function fixtureConversationId(suffix = '1'): ConversationId {
  return internalId(`meta-whatsapp-fixture-conversation-${suffix}`, 'Conversation');
}

export function fixtureMessageId(suffix = '1'): MessageId {
  return internalId(`meta-whatsapp-fixture-message-${suffix}`, 'Message');
}

export function fixtureSendRequest(
  overrides: Partial<MetaWhatsAppSendRequest> = {},
): MetaWhatsAppSendRequest {
  return {
    conversationId: fixtureConversationId(),
    channelThreadRef: 'mock-thread-ref-1',
    contentType: 'text/plain',
    safeText: 'Merhaba, siparişiniz hazırlanıyor.',
    idempotencyKey: idempotencyKey('meta-whatsapp-fixture-send-1'),
    ...overrides,
  };
}
