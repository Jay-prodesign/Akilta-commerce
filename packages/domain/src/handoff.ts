import { DomainPrimitiveError } from './brand';
import type { ConversationOwnershipState } from './conversation';

export interface OwnershipSnapshot {
  readonly state: ConversationOwnershipState;
  readonly epoch: number;
}

export const OWNERSHIP_TRANSITIONS = [
  'REQUEST_HANDOFF',
  'ASSIGN_HUMAN',
  'HUMAN_TAKEOVER',
  'ENABLE_AI_SUGGEST_ONLY',
  'REQUEST_RETURN_TO_AI',
  'CONFIRM_RETURN_TO_AI',
  'RESTORE_AI_ACTIVE',
  'CLOSE',
] as const;
export type OwnershipTransition = (typeof OWNERSHIP_TRANSITIONS)[number];

export function transitionOwnership(
  snapshot: OwnershipSnapshot,
  transition: OwnershipTransition,
  options: { readonly pendingHumanWork?: boolean } = {},
): OwnershipSnapshot {
  const { state } = snapshot;
  let next: ConversationOwnershipState | null = null;

  if (transition === 'CLOSE' && state !== 'CLOSED') next = 'CLOSED';
  else if (state === 'AI_ACTIVE' && transition === 'REQUEST_HANDOFF') next = 'HANDOFF_REQUESTED';
  else if (
    (state === 'AI_ACTIVE' || state === 'HANDOFF_REQUESTED') &&
    transition === 'ASSIGN_HUMAN'
  ) next = 'HUMAN_ASSIGNED';
  else if (
    (state === 'AI_ACTIVE' || state === 'HANDOFF_REQUESTED' || state === 'HUMAN_ASSIGNED') &&
    transition === 'HUMAN_TAKEOVER'
  ) next = 'HUMAN_ACTIVE';
  else if (
    (state === 'HUMAN_ASSIGNED' || state === 'HUMAN_ACTIVE') &&
    transition === 'ENABLE_AI_SUGGEST_ONLY'
  ) next = 'AI_SUGGEST_ONLY';
  else if (
    (state === 'HUMAN_ASSIGNED' || state === 'HUMAN_ACTIVE' || state === 'AI_SUGGEST_ONLY') &&
    transition === 'REQUEST_RETURN_TO_AI'
  ) next = 'RETURN_TO_AI_PENDING';
  else if (state === 'RETURN_TO_AI_PENDING' && transition === 'CONFIRM_RETURN_TO_AI') {
    if (options.pendingHumanWork) {
      throw new DomainPrimitiveError('Return to AI blocked while human work is pending');
    }
    next = 'AI_ACTIVE_RESTORED';
  } else if (state === 'AI_ACTIVE_RESTORED' && transition === 'RESTORE_AI_ACTIVE') next = 'AI_ACTIVE';

  if (!next) throw new DomainPrimitiveError(`Invalid ownership transition ${state} -> ${transition}`);
  return Object.freeze({ state: next, epoch: snapshot.epoch + 1 });
}

export function canAutonomousAiSend(snapshot: OwnershipSnapshot): boolean {
  return snapshot.state === 'AI_ACTIVE';
}

export function validateQueuedAiSend(input: {
  readonly plannedOwnershipEpoch: number;
  readonly current: OwnershipSnapshot;
}): boolean {
  return input.current.state === 'AI_ACTIVE' && input.current.epoch === input.plannedOwnershipEpoch;
}
