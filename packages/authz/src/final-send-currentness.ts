import type { ConversationOwnershipState, CustomerOrderAccessDecision } from '../../domain/src';
import type { MerchantRuleVersionId } from '../../domain/src';
import type { RuleResolution } from '../../merchant-rules/src';
import type { ConversationOwnershipRecord } from './conversation-ownership-transition';
import type { WorkspaceContextSnapshot } from './workspace-context-generation';

/**
 * SC-05 (Conversation Core) — final-send currentness fencing. A pure composition over four
 * already-existing authoritative sources; it invents no new state or persistence of its own:
 *  - ownership state/epoch       -> conversation-ownership-transition.ts (this session, SC-05)
 *  - workspace context version   -> workspace-context-generation.ts (SC-02)
 *  - merchant rule resolution    -> merchant-rules/src/rules.ts resolveRuleGroup() (pre-existing)
 *  - customer identity freshness -> domain/src/customer-identity.ts authorizeCustomerOrderAccess()
 *                                   (pre-existing; caller runs it and passes the decision through
 *                                   only when this send would disclose order-bound customer data —
 *                                   not every message is customer-identity-gated)
 *
 * This function makes no network/DB call and reads no clock; all four authoritative values must
 * already have been freshly read by the caller in the same request as the send itself. It only
 * decides whether the send may proceed, given a *claim* (what the sender believed was current when
 * it decided to send) against that just-read authoritative state. Any mismatch denies with a
 * specific, attributable reason — never a silent proceed.
 *
 * Actor/state gate (conservative reading, flagged to and accepted by the Founder): AI may send only
 * while ownership is AI_ACTIVE; HUMAN may send only while ownership is HUMAN_ACTIVE. This governs
 * the *send* boundary specifically, not whether work may be queued/suggested — AI_SUGGEST_ONLY and
 * AI_ACTIVE_RESTORED both deny an AI send here, matching the canonical state machine's explicit ban
 * on AI output reaching the customer outside AI_ACTIVE.
 */

export type FinalSendActor = 'AI' | 'HUMAN';

const SEND_PERMITTED_OWNERSHIP_STATE: Readonly<Record<FinalSendActor, ConversationOwnershipState>> = {
  AI: 'AI_ACTIVE',
  HUMAN: 'HUMAN_ACTIVE',
};

export interface FinalSendCurrentnessClaim {
  readonly actor: FinalSendActor;
  /** What the sender last observed for each axis when it decided to send. */
  readonly claimedOwnershipEpoch: number;
  readonly claimedWorkspaceContextVersion: string;
  /** Absent when the sender believes no merchant rule governs this send. */
  readonly claimedMerchantRuleVersionId?: MerchantRuleVersionId;
}

export interface FinalSendCurrentnessAuthoritativeState {
  readonly ownership: ConversationOwnershipRecord;
  readonly workspaceContext: WorkspaceContextSnapshot;
  readonly ruleResolution: RuleResolution;
  /**
   * Present only when this send discloses order-bound customer data; the caller computes it via
   * `authorizeCustomerOrderAccess()` against the identity/target/required-disclosure for this
   * specific send. Absent means the axis does not apply to this send (e.g. a message carrying no
   * customer-identity-gated disclosure).
   */
  readonly customerOrderAccess?: CustomerOrderAccessDecision;
}

export type FinalSendCurrentnessResult =
  | { readonly status: 'ALLOW' }
  | {
      readonly status: 'DENY';
      readonly reason:
        | 'ACTOR_NOT_PERMITTED_IN_OWNERSHIP_STATE'
        | 'STALE_OWNERSHIP_EPOCH'
        | 'STALE_WORKSPACE_CONTEXT'
        | 'RULE_CONFLICT_REQUIRES_REVIEW'
        | 'STALE_RULE_VERSION'
        | 'CUSTOMER_IDENTITY_NOT_CURRENT';
    };

/**
 * Decision order, each a hard gate the next never reconsiders:
 *  1. Actor/ownership-state gate — the sending actor must match the single ownership state it is
 *     permitted to send from at all, independent of any epoch claim.
 *  2. Ownership epoch currentness — the claimed epoch must equal the just-read authoritative epoch.
 *  3. Workspace context currentness — the claimed context version must equal the just-read
 *     authoritative version (already collision-safe across workspace id + generation).
 *  4. Rule-generation currentness — a DIRECT_CONFLICT_REQUIRES_REVIEW resolution blocks the send
 *     outright (there is no safe current winner to fence against); otherwise the claimed winning
 *     rule version id (or its absence, for NO_ACTIVE_RULE) must match exactly.
 *  5. Customer identity currentness — when this send discloses order-bound customer data, the
 *     caller-supplied `authorizeCustomerOrderAccess` decision must itself be ALLOW.
 */
export function evaluateFinalSendCurrentness(
  claim: FinalSendCurrentnessClaim,
  authoritative: FinalSendCurrentnessAuthoritativeState,
): FinalSendCurrentnessResult {
  if (authoritative.ownership.state !== SEND_PERMITTED_OWNERSHIP_STATE[claim.actor]) {
    return { status: 'DENY', reason: 'ACTOR_NOT_PERMITTED_IN_OWNERSHIP_STATE' };
  }

  if (claim.claimedOwnershipEpoch !== authoritative.ownership.epoch) {
    return { status: 'DENY', reason: 'STALE_OWNERSHIP_EPOCH' };
  }

  if (claim.claimedWorkspaceContextVersion !== authoritative.workspaceContext.contextVersion) {
    return { status: 'DENY', reason: 'STALE_WORKSPACE_CONTEXT' };
  }

  const { ruleResolution } = authoritative;
  if (ruleResolution.state === 'DIRECT_CONFLICT_REQUIRES_REVIEW') {
    return { status: 'DENY', reason: 'RULE_CONFLICT_REQUIRES_REVIEW' };
  }
  const authoritativeRuleVersionId =
    ruleResolution.state === 'RESOLVED' ? ruleResolution.winner.merchantRuleVersionId : undefined;
  if (claim.claimedMerchantRuleVersionId !== authoritativeRuleVersionId) {
    return { status: 'DENY', reason: 'STALE_RULE_VERSION' };
  }

  if (authoritative.customerOrderAccess && authoritative.customerOrderAccess.decision !== 'ALLOW') {
    return { status: 'DENY', reason: 'CUSTOMER_IDENTITY_NOT_CURRENT' };
  }

  return { status: 'ALLOW' };
}
