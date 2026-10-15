import {
  conversationOwnershipIdempotencyKey,
  resolveConversationOwnershipTransition,
  resolveInboundConversationBinding,
  type ConversationOwnershipIdempotencyKey,
  type ConversationOwnershipRecord,
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
    ownershipState: 'AI_ACTIVE',
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
  {
    id: 'CONV-08-CLOSED-SURFACE-RECORD-SIGNALS-BIND-NEW-CONTINUATION-NOT-BOUND-EXISTING',
    run: () => {
      const result = resolveInboundConversationBinding(claim(), existingRecord({ ownershipState: 'CLOSED' }));
      assert(
        result.status === 'BIND_NEW_CONTINUATION' && result.precedingConversationId === conversationId,
        'a matching inbound event against a CLOSED conversation must never implicitly resume it — it must signal a new continuation thread carrying the closed conversation id as the continuity reference',
      );
    },
  },
  {
    id: 'CONV-09-WORKSPACE-MISMATCH-ON-A-CLOSED-RECORD-STILL-DENIES-FAIL-CLOSED-TAKES-PRIORITY',
    run: () => {
      const result = resolveInboundConversationBinding(
        claim({ merchantWorkspaceId: otherWorkspaceId }),
        existingRecord({ ownershipState: 'CLOSED' }),
      );
      assert(
        result.status === 'DENIED' && result.reason === 'WORKSPACE_MISMATCH',
        'a claim mismatch must deny even against a closed record — a bad tenant claim must never ride in merely because the matched record happens to be closed',
      );
    },
  },
  {
    id: 'CONV-10-NON-CLOSED-LIVE-STATES-STILL-BIND-EXISTING-REGRESSION-UNCHANGED-BY-THE-NEW-BRANCH',
    run: () => {
      const liveStates: ExistingConversationSurfaceRecord['ownershipState'][] = [
        'AI_ACTIVE',
        'HANDOFF_REQUESTED',
        'HUMAN_ASSIGNED',
        'HUMAN_ACTIVE',
        'AI_SUGGEST_ONLY',
        'RETURN_TO_AI_PENDING',
        'AI_ACTIVE_RESTORED',
      ];
      for (const state of liveStates) {
        const result = resolveInboundConversationBinding(claim(), existingRecord({ ownershipState: state }));
        assert(
          result.status === 'BOUND_EXISTING' && result.conversationId === conversationId,
          `a surface record in live state ${state} must still bind to the existing conversation, unaffected by the CLOSED-continuation branch`,
        );
      }
    },
  },
  {
    id: 'CONV-11-BIND-NEW-CONTINUATION-CARRIES-NOTHING-BUT-THE-CONTINUITY-REFERENCE-NO-AUTHORITY-INHERITANCE-BY-CONSTRUCTION',
    run: () => {
      const result = resolveInboundConversationBinding(claim(), existingRecord({ ownershipState: 'CLOSED' }));
      assert(result.status === 'BIND_NEW_CONTINUATION', 'precondition: a closed surface record yields BIND_NEW_CONTINUATION');
      const keys = Object.keys(result).sort();
      assert(
        keys.length === 2 && keys[0] === 'precedingConversationId' && keys[1] === 'status',
        'BIND_NEW_CONTINUATION must carry exactly the continuity reference and nothing else — no customer verification, authorization, pending action, queued send, human assignment or AI execution authority field exists on this result for the caller to accidentally inherit',
      );
    },
  },
  {
    id: 'CONV-12-THE-CLOSED-CONVERSATION-ITSELF-REMAINS-TERMINAL-NO-REOPEN-TRANSITION-WAS-INVENTED',
    run: () => {
      // Composes with the already-existing ownership state machine rather than inventing a new one:
      // the closed predecessor record is still denied every trigger (TERMINAL_STATE); the new
      // continuation conversation gets its OWN fresh ConversationOwnershipRecord at AI_ACTIVE/epoch 0,
      // constructed directly by the caller — never produced by transitioning the closed record.
      const closedRecord: ConversationOwnershipRecord = {
        ownerConversationId: conversationId,
        ownerMerchantWorkspaceId: workspaceId,
        state: 'CLOSED',
        epoch: 4,
      };
      const noPriorApplications: ReadonlyMap<ConversationOwnershipIdempotencyKey, ConversationOwnershipRecord> = new Map();
      const attemptedReactivation = resolveConversationOwnershipTransition(
        {
          conversationId,
          merchantWorkspaceId: workspaceId,
          trigger: 'HUMAN_TAKEOVER',
          expectedEpoch: 4,
          idempotencyKey: conversationOwnershipIdempotencyKey('closed-reactivation-attempt'),
        },
        closedRecord,
        noPriorApplications,
      );
      assert(
        attemptedReactivation.status === 'DENIED' && attemptedReactivation.reason === 'TERMINAL_STATE',
        'the closed predecessor must remain terminal — no REOPEN trigger exists, consistent with the Founder policy that a future reopen capability is a separate product decision',
      );
    },
  },
  {
    id: 'CONV-13-DUPLICATE-INBOUND-AGAINST-A-CLOSED-SURFACE-IS-CAUGHT-BY-THE-EXISTING-DEDUP-PRIMITIVE-BEFORE-BINDING-RUNS',
    run: () => {
      // Mirrors CONV-05 for the closed-surface case: the caller dedupes via classifyDelivery first, so
      // a replayed inbound event never reaches — and therefore never redundantly re-triggers — a
      // second BIND_NEW_CONTINUATION decision for the same provider delivery.
      const event: OperationalEvent = {
        eventId: internalId('evt-closed-1', 'OperationalEvent'),
        merchantWorkspaceId: workspaceId,
        integrationId,
        eventType: 'conversation.inbound_message',
        source: 'meta_whatsapp',
        sourceEventId: 'wa-msg-closed-001',
        observedAt: utcTimestamp(new Date(0)),
        correlationId: internalId('corr-closed-1', 'Correlation'),
        idempotencyKey: idempotencyKey('fallback-key-closed-1'),
        processingState: 'RECEIVED',
      };
      const firstDelivery = classifyDelivery(new Set(), event);
      assert(firstDelivery === 'ACCEPT', 'the first delivery must be accepted, reaching the binding decision exactly once');
      const firstBinding = resolveInboundConversationBinding(claim(), existingRecord({ ownershipState: 'CLOSED' }));
      assert(firstBinding.status === 'BIND_NEW_CONTINUATION', 'the first, non-duplicate delivery must produce the continuation decision');

      const seenKeys = new Set([eventDeduplicationKey(event)]);
      const redelivery = classifyDelivery(seenKeys, event);
      assert(
        redelivery === 'DUPLICATE',
        'a redelivered webhook for the same provider event against a closed surface must classify as DUPLICATE and must never be passed on to resolveInboundConversationBinding a second time',
      );
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
