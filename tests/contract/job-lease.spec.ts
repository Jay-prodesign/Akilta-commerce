import { acquireJobLease, evaluateFencedOperation, type JobLeaseState } from '../../packages/events/src/job-lease';
import { utcTimestamp } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const t0 = utcTimestamp('2026-08-20T09:00:00Z');
const t1 = utcTimestamp('2026-08-20T09:00:30Z');
const tAfterExpiry = utcTimestamp('2026-08-20T09:01:05Z');

const unclaimed: JobLeaseState = { fencingToken: 0 };

const cases: Array<[string, () => void]> = [
  [
    'LEASE-01-UNCLAIMED-JOB-CAN-BE-ACQUIRED',
    () => {
      const result = acquireJobLease({ current: unclaimed, candidateLeaseId: 'worker-a', now: t0, leaseDurationSeconds: 60 });
      assert(result.decision === 'ACQUIRED', 'an unclaimed job must be acquirable');
      if (result.decision === 'ACQUIRED') {
        assert(result.fencingToken === 1, 'fencing token must advance from 0 to 1 on first acquisition');
        assert(result.ownerLeaseId === 'worker-a', 'owner lease id must match the acquiring candidate');
      }
    },
  ],
  [
    'LEASE-02-DUAL-WORKER-REJECTED-WHILE-ACTIVELY-HELD',
    () => {
      const first = acquireJobLease({ current: unclaimed, candidateLeaseId: 'worker-a', now: t0, leaseDurationSeconds: 60 });
      assert(first.decision === 'ACQUIRED', 'setup: first acquisition must succeed');
      if (first.decision !== 'ACQUIRED') return;
      const held: JobLeaseState = { ownerLeaseId: first.ownerLeaseId, leaseExpiresAt: first.leaseExpiresAt, fencingToken: first.fencingToken };

      const second = acquireJobLease({ current: held, candidateLeaseId: 'worker-b', now: t1, leaseDurationSeconds: 60 });
      assert(
        second.decision === 'DENY' && second.reason === 'STILL_LEASED' && second.currentOwnerLeaseId === 'worker-a',
        'a second worker must be denied while the first worker actively holds a non-expired lease',
      );
    },
  ],
  [
    'LEASE-03-SAME-OWNER-RENEWAL-ALLOWED',
    () => {
      const first = acquireJobLease({ current: unclaimed, candidateLeaseId: 'worker-a', now: t0, leaseDurationSeconds: 60 });
      assert(first.decision === 'ACQUIRED', 'setup');
      if (first.decision !== 'ACQUIRED') return;
      const held: JobLeaseState = { ownerLeaseId: first.ownerLeaseId, leaseExpiresAt: first.leaseExpiresAt, fencingToken: first.fencingToken };

      const renewal = acquireJobLease({ current: held, candidateLeaseId: 'worker-a', now: t1, leaseDurationSeconds: 60 });
      assert(renewal.decision === 'ACQUIRED', 'the current owner must be able to renew (heartbeat) its own lease');
      if (renewal.decision === 'ACQUIRED') {
        assert(renewal.fencingToken === 2, 'fencing token still advances monotonically on renewal');
      }
    },
  ],
  [
    'LEASE-04-CRASH-RESTART-ORPHAN-RECONCILIATION-VIA-EXPIRY',
    () => {
      const first = acquireJobLease({ current: unclaimed, candidateLeaseId: 'worker-a', now: t0, leaseDurationSeconds: 60 });
      assert(first.decision === 'ACQUIRED', 'setup');
      if (first.decision !== 'ACQUIRED') return;
      const orphaned: JobLeaseState = { ownerLeaseId: first.ownerLeaseId, leaseExpiresAt: first.leaseExpiresAt, fencingToken: first.fencingToken };

      // worker-a crashed and never renewed; its lease has since expired.
      const reclaim = acquireJobLease({ current: orphaned, candidateLeaseId: 'worker-b', now: tAfterExpiry, leaseDurationSeconds: 60 });
      assert(
        reclaim.decision === 'ACQUIRED' && reclaim.ownerLeaseId === 'worker-b',
        'a different worker must be able to reclaim a job whose prior lease has expired (crash/restart/orphan reconciliation)',
      );
      if (reclaim.decision === 'ACQUIRED') {
        assert(reclaim.fencingToken === 2, 'reclaiming an orphaned lease still advances the fencing token past the crashed worker');
      }
    },
  ],
  [
    'LEASE-05-STALE-FENCING-TOKEN-REJECTED',
    () => {
      const result = evaluateFencedOperation(5, 3);
      assert(result.decision === 'DENY' && result.reason === 'STALE_FENCING_TOKEN', 'a token below the current floor must be rejected regardless of business validity');
    },
  ],
  [
    'LEASE-06-CURRENT-OR-NEWER-FENCING-TOKEN-ALLOWED',
    () => {
      const current = evaluateFencedOperation(5, 5);
      const newer = evaluateFencedOperation(5, 6);
      assert(current.decision === 'ALLOW', 'the exact current token must be allowed');
      assert(newer.decision === 'ALLOW', 'a token at or above the current floor must be allowed');
    },
  ],
];

for (const [name, fn] of cases) { fn(); console.log(`PASS ${name}`); }
console.log(`PASS ${cases.length}/${cases.length} job lease scenarios`);
