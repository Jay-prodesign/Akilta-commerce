import { channelType, conversationStatus, idempotencyKey, internalId, localeTag } from '../../../packages/domain/src';
import type { Conversation, ConversationId, MessageId } from '../../../packages/domain/src';
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

export function fixtureConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    conversationId: fixtureConversationId(),
    merchantWorkspaceId: internalId('meta-whatsapp-fixture-workspace-1', 'MerchantWorkspace'),
    channel: channelType('whatsapp'),
    integrationId: internalId('meta-whatsapp-fixture-integration-1', 'Integration'),
    channelThreadRef: 'mock-thread-ref-1',
    ownershipState: 'AI_ACTIVE',
    ownershipEpoch: 1,
    status: conversationStatus('OPEN'),
    locale: localeTag('tr-TR'),
    ...overrides,
  };
}
