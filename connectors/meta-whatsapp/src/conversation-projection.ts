import {
  materializeSentMessage,
  type Conversation,
  type Message,
  type MessageId,
  type MessageSenderType,
  type OutboundSendResult,
  type UtcTimestamp,
} from '../../../packages/domain/src';
import { shouldAdvanceMonotonicProjection } from '../../../packages/events/src';

export interface ProjectConversationAfterDispatchInput {
  readonly conversation: Conversation;
  readonly messageId: MessageId;
  readonly senderType: Extract<MessageSenderType, 'AI' | 'HUMAN' | 'SYSTEM'>;
  readonly contentType: string;
  readonly safeText?: string;
  readonly contentRef?: string;
  readonly sentAt: UtcTimestamp;
  readonly result: OutboundSendResult;
}

export type ProjectConversationAfterDispatchResult =
  | { readonly outcome: 'PROJECTED'; readonly conversation: Conversation; readonly message: Message }
  | { readonly outcome: 'NOT_SENT' };

/**
 * Domain/state-transition slice of P0-017 Lane A: composes a dispatch result into
 * Conversation state, reusing existing proven primitives rather than re-deriving them.
 * A FAILED OutboundSendResult can never materialize a Message or advance Conversation
 * state (materializeSentMessage's own guard enforces this). A SUCCEEDED result
 * materializes the Message, then advances lastMessageAt/lastOutboundAt only if sentAt
 * is genuinely newer than the Conversation's current lastMessageAt -- reusing
 * shouldAdvanceMonotonicProjection (the same out-of-order-delivery-must-not-regress
 * invariant already proven in tests/contract/event-lineage.spec.ts) instead of
 * re-deriving timestamp-ordering logic here.
 */
export function projectConversationAfterDispatch(
  input: ProjectConversationAfterDispatchInput,
): ProjectConversationAfterDispatchResult {
  if (input.result.status !== 'SUCCEEDED') return { outcome: 'NOT_SENT' };

  const message = materializeSentMessage({
    messageId: input.messageId,
    conversationId: input.conversation.conversationId,
    senderType: input.senderType,
    contentType: input.contentType,
    sentAt: input.sentAt,
    result: input.result,
    ...(input.safeText !== undefined ? { safeText: input.safeText } : {}),
    ...(input.contentRef !== undefined ? { contentRef: input.contentRef } : {}),
  });

  const advances = shouldAdvanceMonotonicProjection(input.conversation.lastMessageAt, input.sentAt);
  const conversation: Conversation = advances
    ? { ...input.conversation, lastMessageAt: input.sentAt, lastOutboundAt: input.sentAt }
    : input.conversation;

  return { outcome: 'PROJECTED', conversation, message };
}
