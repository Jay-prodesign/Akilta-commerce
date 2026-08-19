import { AtomicQuotaLedger, boundedConcurrencyRun } from '../../packages/events/src/quota-ledger';
import { internalId, utcTimestamp } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspaceA = internalId('mw_quota_a', 'MerchantWorkspace');
const workspaceB = internalId('mw_quota_b', 'MerchantWorkspace');
const now = utcTimestamp('2026-08-19T09:00:00Z');

async function main(): Promise<void> {
  const cases: Array<[string, () => Promise<void> | void]> = [
    [
      'QUOTA-01-DENIES-WHEN-BUDGET-NOT-SEEDED',
      () => {
        const ledger = new AtomicQuotaLedger();
        const result = ledger.reserveAtomic({
          quotaReservationId: internalId('qr_missing', 'QuotaReservation'),
          merchantWorkspaceId: workspaceA,
          budgetKey: 'ai.generate_batch',
          amount: 1n,
          now,
        });
        assert(result.decision === 'DENY' && result.reason === 'BUDGET_NOT_FOUND', 'reservation against an unseeded budget must deny');
      },
    ],
    [
      'QUOTA-02-ATOMIC-RESERVATION-ALLOWS-WITHIN-LIMIT-AND-UPDATES-USED',
      () => {
        const ledger = new AtomicQuotaLedger();
        ledger.seed({ merchantWorkspaceId: workspaceA, budgetKey: 'ai.generate_batch', used: 0n, limit: 10n });
        const result = ledger.reserveAtomic({
          quotaReservationId: internalId('qr_001', 'QuotaReservation'),
          merchantWorkspaceId: workspaceA,
          budgetKey: 'ai.generate_batch',
          amount: 4n,
          now,
        });
        assert(result.decision === 'ALLOW', 'reservation within limit should be allowed');
        assert(ledger.currentUsed(workspaceA, 'ai.generate_batch') === 4n, 'atomic reservation must update the ledger used amount');
      },
    ],
    [
      'QUOTA-03-CONCURRENT-RESERVATIONS-NEVER-OVERSUBSCRIBE-BUDGET',
      async () => {
        const ledger = new AtomicQuotaLedger();
        ledger.seed({ merchantWorkspaceId: workspaceA, budgetKey: 'ai.generate_batch', used: 0n, limit: 5n });

        // 10 concurrent attempts of amount=1 against a limit of 5: exactly 5 must be
        // granted, regardless of resolution order, proving reserveAtomic's
        // synchronous read-then-write cannot be interleaved by other callers.
        const attempts = Array.from({ length: 10 }, (_, i) => i);
        const results = await Promise.all(
          attempts.map(
            (i) =>
              new Promise<'ALLOW' | 'DENY'>((resolve) => {
                setTimeout(() => {
                  const result = ledger.reserveAtomic({
                    quotaReservationId: internalId(`qr_concurrent_${i}`, 'QuotaReservation'),
                    merchantWorkspaceId: workspaceA,
                    budgetKey: 'ai.generate_batch',
                    amount: 1n,
                    now,
                  });
                  resolve(result.decision);
                }, 0);
              }),
          ),
        );
        const granted = results.filter((r) => r === 'ALLOW').length;
        assert(granted === 5, `D-088 S1 atomic admission: expected exactly 5 grants against limit=5, got ${granted}`);
        assert(ledger.currentUsed(workspaceA, 'ai.generate_batch') === 5n, 'used amount must exactly equal the granted total, never exceeding limit');
      },
    ],
    [
      'QUOTA-04-TENANT-FAIRNESS-ONE-WORKSPACE-EXHAUSTED-DOES-NOT-BLOCK-ANOTHER',
      () => {
        const ledger = new AtomicQuotaLedger();
        ledger.seed({ merchantWorkspaceId: workspaceA, budgetKey: 'ai.generate_batch', used: 5n, limit: 5n });
        ledger.seed({ merchantWorkspaceId: workspaceB, budgetKey: 'ai.generate_batch', used: 0n, limit: 5n });

        const exhausted = ledger.reserveAtomic({
          quotaReservationId: internalId('qr_a_exhausted', 'QuotaReservation'),
          merchantWorkspaceId: workspaceA,
          budgetKey: 'ai.generate_batch',
          amount: 1n,
          now,
        });
        const other = ledger.reserveAtomic({
          quotaReservationId: internalId('qr_b_fresh', 'QuotaReservation'),
          merchantWorkspaceId: workspaceB,
          budgetKey: 'ai.generate_batch',
          amount: 1n,
          now,
        });
        assert(exhausted.decision === 'DENY', 'workspace A must be denied once its budget is exhausted');
        assert(other.decision === 'ALLOW', 'D-090 I5 tenant fairness: workspace B must not be blocked by workspace A exhaustion');
      },
    ],
    [
      'QUOTA-05-BOUNDED-CONCURRENCY-NEVER-EXCEEDS-LIMIT',
      async () => {
        let active = 0;
        let peak = 0;
        const items = Array.from({ length: 12 }, (_, i) => i);
        await boundedConcurrencyRun(items, 3, async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          active -= 1;
        });
        assert(peak <= 3, `bounded concurrency must never exceed maxConcurrent=3, observed peak=${peak}`);
        assert(active === 0, 'all lanes must have completed');
      },
    ],
    [
      'QUOTA-06-BOUNDED-CONCURRENCY-PROCESSES-EVERY-ITEM-EXACTLY-ONCE',
      async () => {
        const processed: number[] = [];
        const items = Array.from({ length: 9 }, (_, i) => i);
        await boundedConcurrencyRun(items, 4, (item) => {
          processed.push(item);
          return Promise.resolve();
        });
        assert(processed.length === items.length, 'every item must be processed');
        assert(new Set(processed).size === items.length, 'no item may be processed more than once');
      },
    ],
    [
      'QUOTA-07-INVALID-MAX-CONCURRENT-REJECTED',
      async () => {
        let threw = false;
        try {
          await boundedConcurrencyRun([1, 2], 0, async () => {});
        } catch {
          threw = true;
        }
        assert(threw, 'maxConcurrent=0 must be rejected');
      },
    ],
  ];

  for (const [name, fn] of cases) {
    await fn();
    console.log(`PASS ${name}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} quota ledger scenarios`);
}

void main();
