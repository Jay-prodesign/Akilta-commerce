import type { MerchantWorkspaceId } from '../../domain/src';

export interface TenantUsageBudget {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly budgetKey: string;
  readonly used: bigint;
  readonly limit: bigint;
}

export type BudgetDecision =
  | { readonly decision: 'ALLOW'; readonly nextUsed: bigint }
  | { readonly decision: 'DENY'; readonly reason: 'TENANT_MISMATCH' | 'LIMIT_EXCEEDED' | 'INVALID_AMOUNT' };

export function authorizeBudgetConsume(input: {
  readonly budget: TenantUsageBudget;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly amount: bigint;
}): BudgetDecision {
  if (input.budget.merchantWorkspaceId !== input.merchantWorkspaceId) return { decision: 'DENY', reason: 'TENANT_MISMATCH' };
  if (input.amount <= 0n) return { decision: 'DENY', reason: 'INVALID_AMOUNT' };
  const nextUsed = input.budget.used + input.amount;
  if (nextUsed > input.budget.limit) return { decision: 'DENY', reason: 'LIMIT_EXCEEDED' };
  return { decision: 'ALLOW', nextUsed };
}
