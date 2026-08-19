import type { MerchantWorkspaceId, QuotaReservationId, UtcTimestamp } from '../../domain/src';
import { authorizeBudgetConsume, type TenantUsageBudget } from './budget';

export interface QuotaReservation {
  readonly quotaReservationId: QuotaReservationId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly budgetKey: string;
  readonly amount: bigint;
  readonly createdAt: UtcTimestamp;
}

export type ReserveQuotaResult =
  | { readonly decision: 'ALLOW'; readonly reservation: QuotaReservation }
  | { readonly decision: 'DENY'; readonly reason: 'BUDGET_NOT_FOUND' | 'TENANT_MISMATCH' | 'LIMIT_EXCEEDED' | 'INVALID_AMOUNT' };

/**
 * D-090 I5 / RG-QUOTA (D-088 S1 pre-spend cost admission): in-memory atomic quota
 * ledger. `reserveAtomic` reads the current budget and writes the reserved amount
 * back in one synchronous call with no `await` between read and write -- Node's
 * run-to-completion semantics for synchronous code give this the same exclusivity
 * a DB-level atomic `UPDATE ... SET used = used + amount WHERE used + amount <=
 * limit` gets from a row lock, which is what the real quota_reservations table
 * (migrations/0002) enforces at runtime. Two "concurrent" async callers racing to
 * reserveAtomic against the same budget key can never both observe the
 * pre-reservation `used` value, so they can never oversubscribe it.
 */
export class AtomicQuotaLedger {
  private readonly budgets = new Map<string, TenantUsageBudget>();

  seed(budget: TenantUsageBudget): void {
    this.budgets.set(AtomicQuotaLedger.key(budget.merchantWorkspaceId, budget.budgetKey), budget);
  }

  currentUsed(merchantWorkspaceId: MerchantWorkspaceId, budgetKey: string): bigint | null {
    return this.budgets.get(AtomicQuotaLedger.key(merchantWorkspaceId, budgetKey))?.used ?? null;
  }

  reserveAtomic(input: {
    readonly quotaReservationId: QuotaReservationId;
    readonly merchantWorkspaceId: MerchantWorkspaceId;
    readonly budgetKey: string;
    readonly amount: bigint;
    readonly now: UtcTimestamp;
  }): ReserveQuotaResult {
    const key = AtomicQuotaLedger.key(input.merchantWorkspaceId, input.budgetKey);
    const budget = this.budgets.get(key);
    if (!budget) return { decision: 'DENY', reason: 'BUDGET_NOT_FOUND' };

    const decision = authorizeBudgetConsume({
      budget,
      merchantWorkspaceId: input.merchantWorkspaceId,
      amount: input.amount,
    });
    if (decision.decision === 'DENY') return decision;

    this.budgets.set(key, { ...budget, used: decision.nextUsed });
    return {
      decision: 'ALLOW',
      reservation: {
        quotaReservationId: input.quotaReservationId,
        merchantWorkspaceId: input.merchantWorkspaceId,
        budgetKey: input.budgetKey,
        amount: input.amount,
        createdAt: input.now,
      },
    };
  }

  private static key(merchantWorkspaceId: MerchantWorkspaceId, budgetKey: string): string {
    return `${merchantWorkspaceId}:${budgetKey}`;
  }
}

/**
 * D-090 I5 bounded concurrency + tenant fairness: runs `items` through `worker`
 * with at most `maxConcurrent` in flight at once. Each lane independently pulls
 * the next item off the shared cursor, so one item's own slowness (e.g. a
 * quota-exhausted tenant being denied and retried) never blocks another item's
 * lane -- there is no per-tenant queue ordering that lets one tenant's backlog
 * starve another tenant's dispatch.
 */
export async function boundedConcurrencyRun<T>(
  items: readonly T[],
  maxConcurrent: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error('MAX_CONCURRENT_MUST_BE_POSITIVE_INTEGER');
  }
  const queue = items.map((item, index) => ({ item, index }));
  async function lane(): Promise<void> {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      await worker(next.item, next.index);
    }
  }
  const laneCount = Math.min(maxConcurrent, items.length);
  await Promise.all(Array.from({ length: laneCount }, () => lane()));
}
