import { utcTimestamp, type UtcTimestamp } from '../../domain/src';

export interface JobLeaseState {
  readonly ownerLeaseId?: string;
  readonly leaseExpiresAt?: UtcTimestamp;
  readonly fencingToken: number;
}

export type LeaseAcquisitionResult =
  | {
      readonly decision: 'ACQUIRED';
      readonly ownerLeaseId: string;
      readonly leaseExpiresAt: UtcTimestamp;
      readonly fencingToken: number;
    }
  | { readonly decision: 'DENY'; readonly reason: 'STILL_LEASED'; readonly currentOwnerLeaseId: string };

function isExpired(leaseExpiresAt: UtcTimestamp | undefined, now: UtcTimestamp): boolean {
  if (!leaseExpiresAt) return true;
  return new Date(leaseExpiresAt).getTime() <= new Date(now).getTime();
}

/**
 * D-090 P0-023 remediation F1: smallest deterministic single-owner mechanism
 * for Job/Run dispatch -- a lease/heartbeat with a monotonically increasing
 * fencing token, not a generic workflow engine.
 *
 * An unclaimed lease, or one whose holder's lease has expired (the
 * crashed/restarted-worker case), can always be reclaimed by a new
 * candidate -- this is the crash/restart/orphan-reconciliation path, and it
 * requires no external detector: the next worker that looks at the job
 * simply observes the expiry and reclaims it.
 *
 * An actively-held, non-expired lease can only be "acquired" again by its
 * own current owner (heartbeat renewal); a different candidate is denied
 * outright -- this is the stale/dual-worker rejection path.
 */
export function acquireJobLease(input: {
  readonly current: JobLeaseState;
  readonly candidateLeaseId: string;
  readonly now: UtcTimestamp;
  readonly leaseDurationSeconds: number;
}): LeaseAcquisitionResult {
  const { current } = input;
  const currentOwnerLeaseId = current.ownerLeaseId;
  const heldByOther = currentOwnerLeaseId !== undefined && currentOwnerLeaseId !== input.candidateLeaseId;
  if (heldByOther && currentOwnerLeaseId !== undefined && !isExpired(current.leaseExpiresAt, input.now)) {
    return { decision: 'DENY', reason: 'STILL_LEASED', currentOwnerLeaseId };
  }
  const nextFencingToken = current.fencingToken + 1;
  const expiresAtMs = new Date(input.now).getTime() + input.leaseDurationSeconds * 1000;
  return {
    decision: 'ACQUIRED',
    ownerLeaseId: input.candidateLeaseId,
    leaseExpiresAt: utcTimestamp(new Date(expiresAtMs)),
    fencingToken: nextFencingToken,
  };
}

export type FencedOperationResult =
  | { readonly decision: 'ALLOW' }
  | { readonly decision: 'DENY'; readonly reason: 'STALE_FENCING_TOKEN' };

/**
 * Stale/dual-worker rejection at the operation layer: any dispatch/retry
 * attempt presenting a fencing token below the job's current floor fails
 * closed, regardless of whether the attempt is otherwise business-valid --
 * it is evidence of a worker that no longer holds the current lease (crashed,
 * timed out, or superseded by a reclaim).
 */
export function evaluateFencedOperation(
  currentFencingToken: number,
  presentedFencingToken: number,
): FencedOperationResult {
  if (presentedFencingToken < currentFencingToken) {
    return { decision: 'DENY', reason: 'STALE_FENCING_TOKEN' };
  }
  return { decision: 'ALLOW' };
}
