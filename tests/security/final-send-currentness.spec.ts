import {
  evaluateFinalSendCurrentness,
  type FinalSendCurrentnessAuthoritativeState,
  type FinalSendCurrentnessClaim,
} from '../../packages/authz/src';
import type { ConversationOwnershipRecord } from '../../packages/authz/src';
import type { WorkspaceContextSnapshot } from '../../packages/authz/src';
import type { RuleResolution } from '../../packages/merchant-rules/src';
import { internalId, utcTimestamp, type MerchantWorkspaceId, type UserId } from '../../packages/domain/src';
import type { ConversationId, MerchantRuleVersionId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const conversationId: ConversationId = internalId('send-conversation-1', 'Conversation');
const workspaceId: MerchantWorkspaceId = internalId('send-workspace-1', 'MerchantWorkspace');
const principalId: UserId = internalId('send-principal-1', 'User');
const ruleVersionId: MerchantRuleVersionId = internalId('send-rule-version-1', 'MerchantRuleVersion');
const otherRuleVersionId: MerchantRuleVersionId = internalId('send-rule-version-2', 'MerchantRuleVersion');

function ownership(state: ConversationOwnershipRecord['state'], epoch = 0): ConversationOwnershipRecord {
  return { ownerConversationId: conversationId, ownerMerchantWorkspaceId: workspaceId, state, epoch };
}

function workspaceContext(generation = 0): WorkspaceContextSnapshot {
  return {
    principalId,
    merchantWorkspaceId: workspaceId,
    generation,
    contextVersion: JSON.stringify([principalId, workspaceId, generation]),
  };
}

const noActiveRule: RuleResolution = { state: 'NO_ACTIVE_RULE' };

function claim(overrides: Partial<FinalSendCurrentnessClaim> = {}): FinalSendCurrentnessClaim {
  return {
    actor: 'AI',
    claimedOwnershipEpoch: 0,
    claimedWorkspaceContextVersion: workspaceContext(0).contextVersion,
    ...overrides,
  };
}

function authoritative(
  overrides: Partial<FinalSendCurrentnessAuthoritativeState> = {},
): FinalSendCurrentnessAuthoritativeState {
  return {
    ownership: ownership('AI_ACTIVE', 0),
    workspaceContext: workspaceContext(0),
    ruleResolution: noActiveRule,
    ...overrides,
  };
}

const cases: Array<{ id: string; run: () => void }> = [
  {
    id: 'SEND-01-AI-SEND-IN-AI-ACTIVE-WITH-ALL-CURRENT-AXES-ALLOWS',
    run: () => {
      const result = evaluateFinalSendCurrentness(claim(), authoritative());
      assert(result.status === 'ALLOW', 'a fully current AI send in AI_ACTIVE must be allowed');
    },
  },
  {
    id: 'SEND-02-HUMAN-SEND-IN-HUMAN-ACTIVE-WITH-ALL-CURRENT-AXES-ALLOWS',
    run: () => {
      const result = evaluateFinalSendCurrentness(
        claim({ actor: 'HUMAN' }),
        authoritative({ ownership: ownership('HUMAN_ACTIVE', 0) }),
      );
      assert(result.status === 'ALLOW', 'a fully current HUMAN send in HUMAN_ACTIVE must be allowed');
    },
  },
  {
    id: 'SEND-03-AI-SEND-DENIED-IN-AI-SUGGEST-ONLY',
    run: () => {
      const result = evaluateFinalSendCurrentness(claim(), authoritative({ ownership: ownership('AI_SUGGEST_ONLY', 0) }));
      assert(
        result.status === 'DENY' && result.reason === 'ACTOR_NOT_PERMITTED_IN_OWNERSHIP_STATE',
        'AI must never send while ownership is AI_SUGGEST_ONLY',
      );
    },
  },
  {
    id: 'SEND-04-AI-SEND-DENIED-IN-AI-ACTIVE-RESTORED',
    run: () => {
      const result = evaluateFinalSendCurrentness(
        claim(),
        authoritative({ ownership: ownership('AI_ACTIVE_RESTORED', 0) }),
      );
      assert(
        result.status === 'DENY' && result.reason === 'ACTOR_NOT_PERMITTED_IN_OWNERSHIP_STATE',
        'AI must not send merely because the conversation is restored toward AI — only AI_ACTIVE permits a send (conservative reading)',
      );
    },
  },
  {
    id: 'SEND-05-HUMAN-SEND-DENIED-IN-HUMAN-ASSIGNED',
    run: () => {
      const result = evaluateFinalSendCurrentness(
        claim({ actor: 'HUMAN' }),
        authoritative({ ownership: ownership('HUMAN_ASSIGNED', 0) }),
      );
      assert(
        result.status === 'DENY' && result.reason === 'ACTOR_NOT_PERMITTED_IN_OWNERSHIP_STATE',
        'HUMAN_ASSIGNED is not yet HUMAN_ACTIVE — a send must not be permitted before takeover completes',
      );
    },
  },
  {
    id: 'SEND-06-STALE-OWNERSHIP-EPOCH-DENIES-EVEN-IN-CORRECT-STATE',
    run: () => {
      const result = evaluateFinalSendCurrentness(
        claim({ claimedOwnershipEpoch: 3 }),
        authoritative({ ownership: ownership('AI_ACTIVE', 4) }),
      );
      assert(
        result.status === 'DENY' && result.reason === 'STALE_OWNERSHIP_EPOCH',
        'a stale claimed epoch must deny even though the ownership state itself is correct',
      );
    },
  },
  {
    id: 'SEND-07-STALE-WORKSPACE-CONTEXT-DENIES',
    run: () => {
      const result = evaluateFinalSendCurrentness(
        claim({ claimedWorkspaceContextVersion: workspaceContext(1).contextVersion }),
        authoritative({ workspaceContext: workspaceContext(2) }),
      );
      assert(
        result.status === 'DENY' && result.reason === 'STALE_WORKSPACE_CONTEXT',
        'a claimed workspace context version from an older generation must deny',
      );
    },
  },
  {
    id: 'SEND-08-NO-ACTIVE-RULE-WITH-NO-CLAIMED-RULE-ALLOWS',
    run: () => {
      const result = evaluateFinalSendCurrentness(claim(), authoritative({ ruleResolution: noActiveRule }));
      assert(result.status === 'ALLOW', 'absence of an active rule and no claimed rule version must not deny');
    },
  },
  {
    id: 'SEND-09-CLAIMING-A-RULE-VERSION-WHEN-NONE-IS-ACTIVE-DENIES',
    run: () => {
      const result = evaluateFinalSendCurrentness(
        claim({ claimedMerchantRuleVersionId: ruleVersionId }),
        authoritative({ ruleResolution: noActiveRule }),
      );
      assert(
        result.status === 'DENY' && result.reason === 'STALE_RULE_VERSION',
        'a claimed rule version must deny when the authoritative resolution has no active rule at all',
      );
    },
  },
  {
    id: 'SEND-10-RESOLVED-RULE-WITH-MATCHING-CLAIMED-VERSION-ALLOWS',
    run: () => {
      const resolution: RuleResolution = {
        state: 'RESOLVED',
        winner: {
          merchantRuleVersionId: ruleVersionId,
          merchantRuleId: internalId('send-rule-1', 'MerchantRule'),
          merchantWorkspaceId: workspaceId,
          version: 1,
          scopeKey: 'scope',
          intent: 'intent',
          effectKey: 'effect',
          effectValue: 'value',
          authorityClass: 'MERCHANT_RULE',
          approvalState: 'APPROVED',
          lifecycleState: 'ACTIVE',
          riskClass: 'R0',
          sourceRef: 'source',
          createdAt: utcTimestamp(new Date(0)),
        },
        shadowedVersionIds: [],
      };
      const result = evaluateFinalSendCurrentness(
        claim({ claimedMerchantRuleVersionId: ruleVersionId }),
        authoritative({ ruleResolution: resolution }),
      );
      assert(result.status === 'ALLOW', 'a claimed rule version matching the resolved winner must allow');
    },
  },
  {
    id: 'SEND-11-RESOLVED-RULE-WITH-STALE-CLAIMED-VERSION-DENIES',
    run: () => {
      const resolution: RuleResolution = {
        state: 'RESOLVED',
        winner: {
          merchantRuleVersionId: ruleVersionId,
          merchantRuleId: internalId('send-rule-1', 'MerchantRule'),
          merchantWorkspaceId: workspaceId,
          version: 2,
          scopeKey: 'scope',
          intent: 'intent',
          effectKey: 'effect',
          effectValue: 'value',
          authorityClass: 'MERCHANT_RULE',
          approvalState: 'APPROVED',
          lifecycleState: 'ACTIVE',
          riskClass: 'R0',
          sourceRef: 'source',
          createdAt: utcTimestamp(new Date(0)),
        },
        shadowedVersionIds: [],
      };
      const result = evaluateFinalSendCurrentness(
        claim({ claimedMerchantRuleVersionId: otherRuleVersionId }),
        authoritative({ ruleResolution: resolution }),
      );
      assert(
        result.status === 'DENY' && result.reason === 'STALE_RULE_VERSION',
        'a claimed rule version id that no longer matches the current winner must deny, even if a rule was once active under that id',
      );
    },
  },
  {
    id: 'SEND-12-DIRECT-CONFLICT-REQUIRES-REVIEW-ALWAYS-DENIES-REGARDLESS-OF-CLAIM',
    run: () => {
      const resolution: RuleResolution = {
        state: 'DIRECT_CONFLICT_REQUIRES_REVIEW',
        competingVersionIds: [ruleVersionId, otherRuleVersionId],
      };
      const result = evaluateFinalSendCurrentness(
        claim({ claimedMerchantRuleVersionId: ruleVersionId }),
        authoritative({ ruleResolution: resolution }),
      );
      assert(
        result.status === 'DENY' && result.reason === 'RULE_CONFLICT_REQUIRES_REVIEW',
        'an unresolved direct rule conflict must block every send regardless of what the sender claimed',
      );
    },
  },
  {
    id: 'SEND-13-CUSTOMER-ORDER-ACCESS-DENY-PROPAGATES-WHEN-PROVIDED',
    run: () => {
      const result = evaluateFinalSendCurrentness(
        claim(),
        authoritative({ customerOrderAccess: { decision: 'DENY', reason: 'VERIFICATION_EXPIRED' } }),
      );
      assert(
        result.status === 'DENY' && result.reason === 'CUSTOMER_IDENTITY_NOT_CURRENT',
        'a provided customer-order-access DENY must block the send, regardless of its specific underlying reason',
      );
    },
  },
  {
    id: 'SEND-14-CUSTOMER-ORDER-ACCESS-ALLOW-PERMITS-SEND',
    run: () => {
      const result = evaluateFinalSendCurrentness(
        claim(),
        authoritative({ customerOrderAccess: { decision: 'ALLOW' } }),
      );
      assert(result.status === 'ALLOW', 'a provided customer-order-access ALLOW must not itself block an otherwise-current send');
    },
  },
  {
    id: 'SEND-15-ABSENT-CUSTOMER-ORDER-ACCESS-IS-NOT-EVALUATED',
    run: () => {
      const result = evaluateFinalSendCurrentness(claim(), authoritative());
      assert(
        result.status === 'ALLOW',
        'when the send does not disclose order-bound customer data, the caller omits customerOrderAccess and that axis must not block the send',
      );
    },
  },
  {
    id: 'SEND-16-OWNERSHIP-STATE-GATE-IS-CHECKED-BEFORE-EPOCH-STALENESS',
    run: () => {
      const result = evaluateFinalSendCurrentness(
        claim({ claimedOwnershipEpoch: 99 }),
        authoritative({ ownership: ownership('HUMAN_ACTIVE', 0) }),
      );
      assert(
        result.status === 'DENY' && result.reason === 'ACTOR_NOT_PERMITTED_IN_OWNERSHIP_STATE',
        'the actor/state gate must be checked first, before the epoch is even compared',
      );
    },
  },
];

function main() {
  for (const testCase of cases) {
    testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} final-send currentness fencing scenarios`);
}

main();
