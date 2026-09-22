import { assertNonEmptyString, DomainPrimitiveError, type Brand } from './brand';
import type {
  ActionId,
  ConversationId,
  CustomerIdentityId,
  IntegrationId,
  MerchantWorkspaceId,
  MessageId,
  UserId,
} from './ids';
import type { LocaleTag } from './locale';
import type { UtcTimestamp } from './time';

export type ChannelType = Brand<string, 'ChannelType'>;
export type ConversationStatus = Brand<string, 'ConversationStatus'>;
export type ProviderMessageStatus = Brand<string, 'ProviderMessageStatus'>;

export function channelType(value: string): ChannelType {
  return assertNonEmptyString(value, 'ChannelType') as ChannelType;
}
export function conversationStatus(value: string): ConversationStatus {
  return assertNonEmptyString(value, 'ConversationStatus') as ConversationStatus;
}
export function providerMessageStatus(value: string): ProviderMessageStatus {
  return assertNonEmptyString(value, 'ProviderMessageStatus') as ProviderMessageStatus;
}

export const CONVERSATION_OWNERSHIP_STATES = [
  'AI_ACTIVE',
  'HANDOFF_REQUESTED',
  'HUMAN_ASSIGNED',
  'HUMAN_ACTIVE',
  'AI_SUGGEST_ONLY',
  'RETURN_TO_AI_PENDING',
  'AI_ACTIVE_RESTORED',
  'CLOSED',
] as const;
export type ConversationOwnershipState = (typeof CONVERSATION_OWNERSHIP_STATES)[number];

export interface Conversation {
  readonly conversationId: ConversationId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly channel: ChannelType;
  readonly integrationId: IntegrationId;
  readonly channelThreadRef: string;
  readonly customerIdentityId?: CustomerIdentityId;
  readonly ownershipState: ConversationOwnershipState;
  readonly ownershipEpoch: number;
  readonly assignedUserId?: UserId;
  readonly status: ConversationStatus;
  readonly locale: LocaleTag;
  readonly lastMessageAt?: UtcTimestamp;
  readonly lastCustomerMessageAt?: UtcTimestamp;
  readonly lastOutboundAt?: UtcTimestamp;
}

export const MESSAGE_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];
export const MESSAGE_SENDER_TYPES = ['CUSTOMER', 'AI', 'HUMAN', 'SYSTEM'] as const;
export type MessageSenderType = (typeof MESSAGE_SENDER_TYPES)[number];

export interface Message {
  readonly messageId: MessageId;
  readonly conversationId: ConversationId;
  readonly direction: MessageDirection;
  readonly senderType: MessageSenderType;
  readonly channelMessageRef?: string;
  readonly contentType: string;
  readonly safeText?: string;
  readonly contentRef?: string;
  readonly receivedOrSentAt: UtcTimestamp;
  readonly providerStatus?: ProviderMessageStatus;
  readonly replyToRef?: string;
  readonly actionId?: ActionId;
  readonly finalSendActor?: 'AI' | 'HUMAN' | 'SYSTEM';
}

/** Candidate text is not a Message and must never be counted/rendered as sent. */
export interface MessageSuggestion {
  readonly conversationId: ConversationId;
  readonly candidateText: string;
  readonly createdAt: UtcTimestamp;
  readonly modelRef?: string;
  readonly evidenceRef?: string;
}

export interface OutboundSendResult {
  readonly status: 'SUCCEEDED' | 'FAILED';
  readonly providerMessageRef?: string;
  readonly providerStatus?: ProviderMessageStatus;
}

export function materializeSentMessage(input: {
  readonly messageId: MessageId;
  readonly conversationId: ConversationId;
  readonly senderType: Extract<MessageSenderType, 'AI' | 'HUMAN' | 'SYSTEM'>;
  readonly safeText?: string;
  readonly contentRef?: string;
  readonly contentType: string;
  readonly sentAt: UtcTimestamp;
  readonly actionId?: ActionId;
  readonly result: OutboundSendResult;
}): Message {
  if (input.result.status !== 'SUCCEEDED') {
    throw new DomainPrimitiveError('Outbound Message can be materialized only after successful send');
  }
  if (!input.result.providerMessageRef) {
    throw new DomainPrimitiveError('Successful outbound send requires providerMessageRef');
  }
  return Object.freeze({
    messageId: input.messageId,
    conversationId: input.conversationId,
    direction: 'OUTBOUND' as const,
    senderType: input.senderType,
    channelMessageRef: input.result.providerMessageRef,
    contentType: input.contentType,
    ...(input.safeText !== undefined ? { safeText: input.safeText } : {}),
    ...(input.contentRef !== undefined ? { contentRef: input.contentRef } : {}),
    receivedOrSentAt: input.sentAt,
    ...(input.result.providerStatus !== undefined ? { providerStatus: input.result.providerStatus } : {}),
    ...(input.actionId !== undefined ? { actionId: input.actionId } : {}),
    finalSendActor: input.senderType,
  });
}
