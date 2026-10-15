import { DomainPrimitiveError } from '../../domain/src';
import type { ConversationId, ConversationOwnershipState, MerchantWorkspaceId } from '../../domain/src';

/**
 * SC-05 (Conversation Core / AC-HANDOFF-106) — pure CAS transition for conversation ownership/handoff
 * epoch, grounded directly in the canonical CONVERSATION_OWNERSHIP state machine (D108_CLOSURE_PLAN
 * STATE_MACHINES sheet) and the already-existing `ownership_epoch` CAS column + append-only
 * `conversation_ownership_events` audit table (`CHECK (to_epoch = from_epoch + 1)`,
 * DB-06-OWNERSHIP-EPOCH-CONSTRAINT). No new schema is needed for this unit — only the decision
 * function that was missing.
 *
 * Same CAS/idempotency discipline as every prior XSESS-01/05/06 and provider-store-binding unit:
 * `expectedEpoch` is the CAS precondition, never a timestamp; a successful transition advances the
 * epoch by exactly one; a losing concurrent actor gets an explicit CONFLICT; a retried request (same
 * idempotency key) replays its original outcome. This function only decides the ownership state/epoch
 * transition itself — it has no opinion on message send authority, customer identity, workspace
 * generation, or rule freshness; "final-send currentness fencing" (composing all of those) is a
 * separate, later unit that reuses this one's resulting epoch as one of its inputs.
 *
 * CLOSED is terminal here by design: the canonical state machine defines no outgoing trigger from
 * CLOSED ("later inbound requires explicit reopen-or-new-thread policy" — a deliberately separate,
 * not-yet-selected concern), so any trigger presented against a CLOSED record is DENIED, never
 * silently reactivating AI ownership.
 */

export type ConversationOwnershipTrigger =
  | 'REQUEST_HANDOFF'
  | 'ASSIGN_HUMAN'
  | 'HUMAN_TAKEOVER'
  | 'ENABLE_AI_SUGGEST_ONLY'
  | 'REQUEST_RETURN_TO_AI'
  | 'CONFIRM_RETURN_TO_AI'
  | 'RESTORE_AI_ACTIVE'
  | 'CLOSE';

/**
 * The exact canonical CONVERSATION_OWNERSHIP transition table: for each source state, which
 * triggers are allowed and which state each leads to. Absence of a trigger for a state is itself
 * the forbidden-transition boundary (e.g. no trigger exists for CLOSED; HUMAN_ACTIVE has no
 * ASSIGN_HUMAN re-entry; AI_SUGGEST_ONLY has no HUMAN_TAKEOVER).
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<ConversationOwnershipState, Partial<Record<ConversationOwnershipTrigger, ConversationOwnershipState>>>
> = {
  AI_ACTIVE: {
    REQUEST_HANDOFF: 'HANDOFF_REQUESTED',
    ASSIGN_HUMAN: 'HUMAN_ASSIGNED',
    HUMAN_TAKEOVER: 'HUMAN_ACTIVE',
    CLOSE: 'CLOSED',
  },
  HANDOFF_REQUESTED: {
    ASSIGN_HUMAN: 'HUMAN_ASSIGNED',
    HUMAN_TAKEOVER: 'HUMAN_ACTIVE',
    CLOSE: 'CLOSED',
  },
  HUMAN_ASSIGNED: {
    HUMAN_TAKEOVER: 'HUMAN_ACTIVE',
    ENABLE_AI_SUGGEST_ONLY: 'AI_SUGGEST_ONLY',
    REQUEST_RETURN_TO_AI: 'RETURN_TO_AI_PENDING',
    CLOSE: 'CLOSED',
  },
  HUMAN_ACTIVE: {
    ENABLE_AI_SUGGEST_ONLY: 'AI_SUGGEST_ONLY',
    REQUEST_RETURN_TO_AI: 'RETURN_TO_AI_PENDING',
    CLOSE: 'CLOSED',
  },
  AI_SUGGEST_ONLY: {
    REQUEST_RETURN_TO_AI: 'RETURN_TO_AI_PENDING',
    CLOSE: 'CLOSED',
  },
  RETURN_TO_AI_PENDING: {
    CONFIRM_RETURN_TO_AI: 'AI_ACTIVE_RESTORED',
    CLOSE: 'CLOSED',
  },
  AI_ACTIVE_RESTORED: {
    RESTORE_AI_ACTIVE: 'AI_ACTIVE',
    CLOSE: 'CLOSED',
  },
  CLOSED: {},
};

export type ConversationOwnershipIdempotencyKey = string & {
  readonly __brand: 'ConversationOwnershipIdempotencyKey';
};

function assertIsConversationOwnershipIdempotencyKey(
  value: string,
): asserts value is ConversationOwnershipIdempotencyKey {
  if (!value) throw new DomainPrimitiveError('ConversationOwnershipIdempotencyKey must be non-empty');
}

export function conversationOwnershipIdempotencyKey(value: string): ConversationOwnershipIdempotencyKey {
  const normalized = value.trim();
  assertIsConversationOwnershipIdempotencyKey(normalized);
  return normalized;
}

export interface ConversationOwnershipRecord {
  readonly ownerConversationId: ConversationId;
  readonly ownerMerchantWorkspaceId: MerchantWorkspaceId;
  readonly state: ConversationOwnershipState;
  readonly epoch: number;
}

export interface ConversationOwnershipTransitionRequest {
  readonly conversationId: ConversationId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly trigger: ConversationOwnershipTrigger;
  /** CAS precondition: the epoch the caller last observed. Never a timestamp. */
  readonly expectedEpoch: number;
  readonly idempotencyKey: ConversationOwnershipIdempotencyKey;
}

export type ConversationOwnershipTransitionResult =
  | { readonly status: 'APPLIED'; readonly resultingRecord: ConversationOwnershipRecord }
  | { readonly status: 'ALREADY_APPLIED'; readonly resultingRecord: ConversationOwnershipRecord }
  | { readonly status: 'CONFLICT'; readonly reason: 'STALE_EXPECTED_EPOCH' }
  | {
      readonly status: 'DENIED';
      readonly reason: 'SCOPE_MISMATCH' | 'TERMINAL_STATE' | 'TRIGGER_NOT_ALLOWED_FROM_STATE';
    };

/**
 * Decision order, each one a hard gate the next never reconsiders:
 *  1. Idempotency replay — a previously-APPLIED request with this exact key returns its original
 *     outcome verbatim, regardless of what `currentRecord` has since become.
 *  2. Scope match — the request's (conversationId, merchantWorkspaceId) must be the record's own
 *     scope, or this is a caller/wiring defect, not a staleness condition.
 *  3. Terminal-state gate — CLOSED accepts no trigger at all (DENIED TERMINAL_STATE), never an
 *     implicit reactivation.
 *  4. Allowed-transition lookup — the trigger must be defined for the current state in the exact
 *     canonical table above, or DENIED TRIGGER_NOT_ALLOWED_FROM_STATE.
 *  5. CAS precondition — `expectedEpoch` must equal the current epoch exactly. Any mismatch is an
 *     explicit CONFLICT, never a silent overwrite.
 * A successful transition advances the epoch by exactly one.
 */
export function resolveConversationOwnershipTransition(
  request: ConversationOwnershipTransitionRequest,
  currentRecord: ConversationOwnershipRecord,
  appliedIdempotencyKeys: ReadonlyMap<ConversationOwnershipIdempotencyKey, ConversationOwnershipRecord>,
): ConversationOwnershipTransitionResult {
  const priorOutcome = appliedIdempotencyKeys.get(request.idempotencyKey);
  if (priorOutcome) {
    return { status: 'ALREADY_APPLIED', resultingRecord: priorOutcome };
  }

  if (
    request.conversationId !== currentRecord.ownerConversationId ||
    request.merchantWorkspaceId !== currentRecord.ownerMerchantWorkspaceId
  ) {
    return { status: 'DENIED', reason: 'SCOPE_MISMATCH' };
  }

  if (currentRecord.state === 'CLOSED') {
    return { status: 'DENIED', reason: 'TERMINAL_STATE' };
  }

  const targetState = ALLOWED_TRANSITIONS[currentRecord.state][request.trigger];
  if (!targetState) {
    return { status: 'DENIED', reason: 'TRIGGER_NOT_ALLOWED_FROM_STATE' };
  }

  if (request.expectedEpoch !== currentRecord.epoch) {
    return { status: 'CONFLICT', reason: 'STALE_EXPECTED_EPOCH' };
  }

  return {
    status: 'APPLIED',
    resultingRecord: {
      ownerConversationId: currentRecord.ownerConversationId,
      ownerMerchantWorkspaceId: currentRecord.ownerMerchantWorkspaceId,
      state: targetState,
      epoch: currentRecord.epoch + 1,
    },
  };
}
