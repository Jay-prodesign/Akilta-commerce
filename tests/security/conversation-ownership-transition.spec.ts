import {
  conversationOwnershipIdempotencyKey,
  resolveConversationOwnershipTransition,
  type ConversationOwnershipIdempotencyKey,
  type ConversationOwnershipRecord,
  type ConversationOwnershipTransitionRequest,
} from '../../packages/authz/src';
import { internalId, type MerchantWorkspaceId } from '../../packages/domain/src';
import type { ConversationId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const conversationId: ConversationId = internalId('handoff-conversation-1', 'Conversation');
const otherConversationId: ConversationId = internalId('handoff-conversation-2', 'Conversation');
const workspaceId: MerchantWorkspaceId = internalId('handoff-workspace-1', 'MerchantWorkspace');
const otherWorkspaceId: MerchantWorkspaceId = internalId('handoff-workspace-2', 'MerchantWorkspace');

const noPriorApplications: ReadonlyMap<ConversationOwnershipIdempotencyKey, ConversationOwnershipRecord> = new Map();

function record(state: ConversationOwnershipRecord['state'], epoch = 0): ConversationOwnershipRecord {
  return { ownerConversationId: conversationId, ownerMerchantWorkspaceId: workspaceId, state, epoch };
}

function request(overrides: Partial<ConversationOwnershipTransitionRequest> = {}): ConversationOwnershipTransitionRequest {
  return {
    conversationId,
    merchantWorkspaceId: workspaceId,
    trigger: 'REQUEST_HANDOFF',
    expectedEpoch: 0,
    idempotencyKey: conversationOwnershipIdempotencyKey('handoff-op-1'),
    ...overrides,
  };
}

const cases: Array<{ id: string; run: () => void }> = [
  {
    id: 'HANDOFF-01-AI-ACTIVE-REQUEST-HANDOFF-APPLIES',
    run: () => {
      const result = resolveConversationOwnershipTransition(request(), record('AI_ACTIVE', 0), noPriorApplications);
      assert(
        result.status === 'APPLIED' && result.resultingRecord.state === 'HANDOFF_REQUESTED' && result.resultingRecord.epoch === 1,
        'AI_ACTIVE + REQUEST_HANDOFF must apply to HANDOFF_REQUESTED and advance the epoch by exactly one',
      );
    },
  },
  {
    id: 'HANDOFF-02-AI-ACTIVE-HUMAN-TAKEOVER-DIRECT-APPLIES',
    run: () => {
      const result = resolveConversationOwnershipTransition(
        request({ trigger: 'HUMAN_TAKEOVER' }),
        record('AI_ACTIVE', 0),
        noPriorApplications,
      );
      assert(result.status === 'APPLIED' && result.resultingRecord.state === 'HUMAN_ACTIVE', 'a direct human takeover from AI_ACTIVE must be allowed');
    },
  },
  {
    id: 'HANDOFF-03-HUMAN-ASSIGNED-ENABLE-AI-SUGGEST-ONLY-APPLIES',
    run: () => {
      const result = resolveConversationOwnershipTransition(
        request({ trigger: 'ENABLE_AI_SUGGEST_ONLY', expectedEpoch: 2 }),
        record('HUMAN_ASSIGNED', 2),
        noPriorApplications,
      );
      assert(result.status === 'APPLIED' && result.resultingRecord.state === 'AI_SUGGEST_ONLY', 'HUMAN_ASSIGNED + ENABLE_AI_SUGGEST_ONLY must transition to AI_SUGGEST_ONLY');
    },
  },
  {
    id: 'HANDOFF-04-AI-SUGGEST-ONLY-CANNOT-BE-DIRECTLY-HUMAN-TAKEN-OVER-AGAIN',
    run: () => {
      // AI_SUGGEST_ONLY restriction: the only way out is REQUEST_RETURN_TO_AI or CLOSE — a direct
      // HUMAN_TAKEOVER re-entry is not a defined transition from this state in the canonical table.
      const result = resolveConversationOwnershipTransition(
        request({ trigger: 'HUMAN_TAKEOVER', expectedEpoch: 3 }),
        record('AI_SUGGEST_ONLY', 3),
        noPriorApplications,
      );
      assert(
        result.status === 'DENIED' && result.reason === 'TRIGGER_NOT_ALLOWED_FROM_STATE',
        'HUMAN_TAKEOVER from AI_SUGGEST_ONLY must deny — not a canonical transition',
      );
    },
  },
  {
    id: 'HANDOFF-05-HUMAN-ACTIVE-CANNOT-RE-ASSIGN-HUMAN',
    run: () => {
      // HUMAN_ACTIVE restriction: ASSIGN_HUMAN is only valid from AI_ACTIVE/HANDOFF_REQUESTED, not
      // as a re-entry from HUMAN_ACTIVE itself.
      const result = resolveConversationOwnershipTransition(
        request({ trigger: 'ASSIGN_HUMAN', expectedEpoch: 1 }),
        record('HUMAN_ACTIVE', 1),
        noPriorApplications,
      );
      assert(
        result.status === 'DENIED' && result.reason === 'TRIGGER_NOT_ALLOWED_FROM_STATE',
        'ASSIGN_HUMAN from HUMAN_ACTIVE must deny — not a canonical transition',
      );
    },
  },
  {
    id: 'HANDOFF-06-CLOSED-IS-TERMINAL-NO-TRIGGER-ACCEPTED',
    run: () => {
      const result = resolveConversationOwnershipTransition(
        request({ trigger: 'RESTORE_AI_ACTIVE', expectedEpoch: 7 }),
        record('CLOSED', 7),
        noPriorApplications,
      );
      assert(
        result.status === 'DENIED' && result.reason === 'TERMINAL_STATE',
        'CLOSED must deny every trigger — no implicit reactivation, reopen is a separate explicit policy',
      );
    },
  },
  {
    id: 'HANDOFF-07-RETURN-TO-AI-PENDING-CONFIRM-RETURN-APPLIES',
    run: () => {
      const result = resolveConversationOwnershipTransition(
        request({ trigger: 'CONFIRM_RETURN_TO_AI', expectedEpoch: 4 }),
        record('RETURN_TO_AI_PENDING', 4),
        noPriorApplications,
      );
      assert(result.status === 'APPLIED' && result.resultingRecord.state === 'AI_ACTIVE_RESTORED', 'CONFIRM_RETURN_TO_AI must transition to AI_ACTIVE_RESTORED');
    },
  },
  {
    id: 'HANDOFF-08-AI-ACTIVE-RESTORED-RESTORE-AI-ACTIVE-CLOSES-THE-LOOP',
    run: () => {
      const result = resolveConversationOwnershipTransition(
        request({ trigger: 'RESTORE_AI_ACTIVE', expectedEpoch: 5 }),
        record('AI_ACTIVE_RESTORED', 5),
        noPriorApplications,
      );
      assert(result.status === 'APPLIED' && result.resultingRecord.state === 'AI_ACTIVE', 'RESTORE_AI_ACTIVE must transition back to AI_ACTIVE under a new epoch');
    },
  },
  {
    id: 'HANDOFF-09-CLOSE-IS-AVAILABLE-FROM-ANY-LIVE-STATE',
    run: () => {
      const states: ConversationOwnershipRecord['state'][] = [
        'AI_ACTIVE',
        'HANDOFF_REQUESTED',
        'HUMAN_ASSIGNED',
        'HUMAN_ACTIVE',
        'AI_SUGGEST_ONLY',
        'RETURN_TO_AI_PENDING',
        'AI_ACTIVE_RESTORED',
      ];
      for (const state of states) {
        const result = resolveConversationOwnershipTransition(
          request({ trigger: 'CLOSE', expectedEpoch: 0 }),
          record(state, 0),
          noPriorApplications,
        );
        assert(result.status === 'APPLIED' && result.resultingRecord.state === 'CLOSED', `CLOSE must be available from ${state}`);
      }
    },
  },
  {
    id: 'HANDOFF-10-CONCURRENT-COMPETING-TAKEOVERS-ONE-WINS-OTHER-CONFLICTS',
    run: () => {
      const base = record('AI_ACTIVE', 0);
      const first = resolveConversationOwnershipTransition(
        request({ trigger: 'HUMAN_TAKEOVER', idempotencyKey: conversationOwnershipIdempotencyKey('writer-a') }),
        base,
        noPriorApplications,
      );
      assert(first.status === 'APPLIED', 'the first writer against the then-current epoch must succeed');

      // The second writer's trigger (ENABLE_AI_SUGGEST_ONLY) is valid from the resulting HUMAN_ACTIVE
      // state, so this isolates the CAS epoch check rather than tripping the allowed-transition gate.
      const second = resolveConversationOwnershipTransition(
        request({ trigger: 'ENABLE_AI_SUGGEST_ONLY', idempotencyKey: conversationOwnershipIdempotencyKey('writer-b') }),
        first.status === 'APPLIED' ? first.resultingRecord : base,
        noPriorApplications,
      );
      assert(
        second.status === 'CONFLICT' && second.reason === 'STALE_EXPECTED_EPOCH',
        'the losing concurrent writer must receive an explicit CONFLICT, never silently overwrite the winner',
      );
    },
  },
  {
    id: 'HANDOFF-11-RETRY-WITH-SAME-IDEMPOTENCY-KEY-REPLAYS-PRIOR-OUTCOME',
    run: () => {
      const key = conversationOwnershipIdempotencyKey('retry-key-1');
      const applied: ConversationOwnershipRecord = {
        ownerConversationId: conversationId,
        ownerMerchantWorkspaceId: workspaceId,
        state: 'HUMAN_ACTIVE',
        epoch: 1,
      };
      const ledger: ReadonlyMap<ConversationOwnershipIdempotencyKey, ConversationOwnershipRecord> = new Map([[key, applied]]);
      const driftedCurrent = record('CLOSED', 9);
      const retry = resolveConversationOwnershipTransition(
        request({ trigger: 'HUMAN_TAKEOVER', expectedEpoch: 0, idempotencyKey: key }),
        driftedCurrent,
        ledger,
      );
      assert(
        retry.status === 'ALREADY_APPLIED' && retry.resultingRecord.state === 'HUMAN_ACTIVE' && retry.resultingRecord.epoch === 1,
        'a retried request with a previously-applied idempotency key must replay the original outcome verbatim, even against a drifted (and even terminal) current record',
      );
    },
  },
  {
    id: 'HANDOFF-12-SCOPE-MISMATCH-ON-WRONG-CONVERSATION-DENIES',
    run: () => {
      const result = resolveConversationOwnershipTransition(
        request({ conversationId: otherConversationId }),
        record('AI_ACTIVE', 0),
        noPriorApplications,
      );
      assert(result.status === 'DENIED' && result.reason === 'SCOPE_MISMATCH', 'a request scoped to a different conversation must deny');
    },
  },
  {
    id: 'HANDOFF-13-SCOPE-MISMATCH-ON-WRONG-WORKSPACE-DENIES',
    run: () => {
      const result = resolveConversationOwnershipTransition(
        request({ merchantWorkspaceId: otherWorkspaceId }),
        record('AI_ACTIVE', 0),
        noPriorApplications,
      );
      assert(result.status === 'DENIED' && result.reason === 'SCOPE_MISMATCH', 'a request scoped to a different workspace must deny');
    },
  },
  {
    id: 'HANDOFF-14-STALE-EXPECTED-EPOCH-ON-OTHERWISE-VALID-TRIGGER-CONFLICTS',
    run: () => {
      const result = resolveConversationOwnershipTransition(
        request({ trigger: 'HUMAN_TAKEOVER', expectedEpoch: 0 }),
        record('AI_ACTIVE', 3),
        noPriorApplications,
      );
      assert(
        result.status === 'CONFLICT' && result.reason === 'STALE_EXPECTED_EPOCH',
        'a valid trigger with a stale expectedEpoch must still fail closed as CONFLICT, not apply against the wrong baseline',
      );
    },
  },
];

function main() {
  for (const testCase of cases) {
    testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} conversation ownership transition scenarios`);
}

main();
