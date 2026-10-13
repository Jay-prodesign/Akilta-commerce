import {
  resolveInboundConversationBinding,
  type ExistingConversationSurfaceRecord,
  type InboundConversationSurfaceClaim,
} from '../../packages/authz/src';
import {
  classifyDelivery,
  eventDeduplicationKey,
  shouldAdvanceMonotonicProjection,
  type OperationalEvent,
} from '../../packages/events/src';
import {
  channelType,
  idempotencyKey,
  internalId,
  utcTimestamp,
  type ConversationId,
  type IntegrationId,
  type MerchantWorkspaceId,
} from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const conversationId: ConversationId = internalId('conv-01', 'Conversation');
const workspaceId: MerchantWorkspaceId = internalId('conv-workspace-1', 'MerchantWorkspace');
const otherWorkspaceId: MerchantWorkspaceId = internalId('conv-workspace-2', 'MerchantWorkspace');
const integrationId: IntegrationId = internalId('conv-integration-1', 'Integration');
const channel = channelType('whatsapp');
const threadRef = 'thread-001';

function claim(overrides: Partial<InboundConversationSurfaceClaim> = {}): InboundConversationSurfaceClaim {
  return {
    merchantWorkspaceId: workspaceId,
    integrationId,
    channel,
    channelThreadRef: threadRef,
    ...overrides,
  };
}

function existingRecord(
  overrides: Partial<ExistingConversationSurfaceRecord> = {},
): ExistingConversationSurfaceRecord {
  return {
    conversationId,
    merchantWorkspaceId: workspaceId,
    integrationId,
    channel,
    channelThreadRef: threadRef,
    ...overrides,
  };
}

const cases: Array<{ id: string; run: () => void }> = [
  {
    id: 'CONV-01-NO-EXISTING-RECORD-SIGNALS-BIND-NEW',
    run: () => {
      const result = resolveInboundConversationBinding(claim(), null);
      assert(result.status === 'BIND_NEW', 'an inbound event with no existing surface match must signal creating a new conversation');
    },
  },
  {
    id: 'CONV-02-MATCHING-EXISTING-RECORD-BINDS-TO-IT',
    run: () => {
      const result = resolveInboundConversationBinding(claim(), existingRecord());
      assert(
        result.status === 'BOUND_EXISTING' && result.conversationId === conversationId,
        'an inbound event matching an existing surface record must bind to that exact conversation',
      );
    },
  },
  {
    id: 'CONV-03-WORKSPACE-CLAIM-DISAGREEING-WITH-THE-RECORD-DENIES-NOT-SILENTLY-BOUND',
    run: () => {
      const result = resolveInboundConversationBinding(
        claim({ merchantWorkspaceId: otherWorkspaceId }),
        existingRecord(),
      );
      assert(
        result.status === 'DENIED' && result.reason === 'WORKSPACE_MISMATCH',
        'a claimed workspace that disagrees with the surface-keyed record must deny — never silently bind into the wrong tenant',
      );
    },
  },
  {
    id: 'CONV-04-INTEGRATION-CLAIM-DISAGREEING-WITH-THE-RECORD-DENIES',
    run: () => {
      const otherIntegrationId: IntegrationId = internalId('conv-integration-2', 'Integration');
      const result = resolveInboundConversationBinding(
        claim({ integrationId: otherIntegrationId }),
        existingRecord(),
      );
      assert(
        result.status === 'DENIED' && result.reason === 'WORKSPACE_MISMATCH',
        'a claimed integration that disagrees with the surface-keyed record must deny, defense-in-depth against a defective lookup',
      );
    },
  },
  {
    id: 'CONV-05-DUPLICATE-INBOUND-SAME-SOURCE-EVENT-ID-IS-REJECTED-BY-EXISTING-DEDUP-UNCHANGED',
    run: () => {
      // Demonstrates composition with the pre-existing dedup primitive rather than reimplementing it:
      // the binding decision above is orthogonal to delivery dedup, which remains exactly as it was.
      const bound = resolveInboundConversationBinding(claim(), existingRecord());
      assert(bound.status === 'BOUND_EXISTING', 'precondition: the inbound event binds to an existing conversation');

      const event: OperationalEvent = {
        eventId: internalId('evt-1', 'OperationalEvent'),
        merchantWorkspaceId: workspaceId,
        integrationId,
        eventType: 'conversation.inbound_message',
        source: 'meta_whatsapp',
        sourceEventId: 'wa-msg-001',
        observedAt: utcTimestamp(new Date(0)),
        correlationId: internalId('corr-1', 'Correlation'),
        idempotencyKey: idempotencyKey('fallback-key-1'),
        processingState: 'RECEIVED',
      };
      const firstDelivery = classifyDelivery(new Set(), event);
      assert(firstDelivery === 'ACCEPT', 'the first delivery of a given provider source event id must be accepted');

      const seenKeys = new Set([eventDeduplicationKey(event)]);
      const redelivery = classifyDelivery(seenKeys, event);
      assert(
        redelivery === 'DUPLICATE',
        'a redelivered webhook with the same provider source event id against the same conversation must classify as DUPLICATE, unaffected by this binding unit',
      );
    },
  },
  {
    id: 'CONV-06-OUT-OF-ORDER-INBOUND-DOES-NOT-REGRESS-THE-MONOTONIC-PROJECTION-UNCHANGED',
    run: () => {
      const bound = resolveInboundConversationBinding(claim(), existingRecord());
      assert(bound.status === 'BOUND_EXISTING', 'precondition: the inbound event binds to an existing conversation');

      const currentSourceTimestamp = utcTimestamp(new Date(2000));
      const outOfOrderIncoming = utcTimestamp(new Date(1000));
      const inOrderIncoming = utcTimestamp(new Date(3000));

      assert(
        shouldAdvanceMonotonicProjection(currentSourceTimestamp, outOfOrderIncoming) === false,
        'an out-of-order inbound event (older source timestamp) must never advance the conversation projection',
      );
      assert(
        shouldAdvanceMonotonicProjection(currentSourceTimestamp, inOrderIncoming) === true,
        'a genuinely newer inbound event must advance the conversation projection',
      );
    },
  },
  {
    id: 'CONV-07-DIFFERENT-CHANNEL-THREAD-REF-WITH-NO-EXISTING-MATCH-ALWAYS-BINDS-NEW-NOT-REUSED',
    run: () => {
      const result = resolveInboundConversationBinding(claim({ channelThreadRef: 'thread-002' }), null);
      assert(result.status === 'BIND_NEW', 'a distinct channelThreadRef with no existing record must never be conflated with an unrelated conversation');
    },
  },
];

function main() {
  for (const testCase of cases) {
    testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} inbound conversation binding scenarios`);
}

main();
