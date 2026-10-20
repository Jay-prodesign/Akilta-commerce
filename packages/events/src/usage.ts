import { assertNonEmptyString, type Brand } from '../../domain/src/brand';
import { addMoney } from '../../domain/src/money';
import type {
  CorrelationId,
  MerchantWorkspaceId,
  Money,
  RunId,
  UsageEventId,
  UtcTimestamp,
} from '../../domain/src';

export type UsageUnit = Brand<string, 'UsageUnit'>;
export type RateCardVersion = Brand<string, 'RateCardVersion'>;
export type ReconciliationState = Brand<string, 'ReconciliationState'>;

function assertIsUsageUnit(value: string): asserts value is UsageUnit {
  assertNonEmptyString(value, 'UsageUnit');
}

function assertIsRateCardVersion(value: string): asserts value is RateCardVersion {
  assertNonEmptyString(value, 'RateCardVersion');
}

function assertIsReconciliationState(value: string): asserts value is ReconciliationState {
  assertNonEmptyString(value, 'ReconciliationState');
}

export function usageUnit(value: string): UsageUnit {
  assertIsUsageUnit(value);
  return value;
}

export function rateCardVersion(value: string): RateCardVersion {
  assertIsRateCardVersion(value);
  return value;
}

export function reconciliationState(value: string): ReconciliationState {
  assertIsReconciliationState(value);
  return value;
}

export interface UsageEvent {
  readonly usageEventId: UsageEventId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly module: string;
  readonly runId?: RunId;
  readonly correlationId?: CorrelationId;
  readonly logicalOperationRef: string;
  readonly providerType: string;
  readonly providerOperation: string;
  readonly quantity: bigint;
  readonly unit: UsageUnit;
  readonly rateCardVersion: RateCardVersion;
  readonly providerCost?: Money;
  readonly estimatedFlag: boolean;
  readonly reconciliationState: ReconciliationState;
  readonly providerUsageRef?: string;
  readonly occurredAt: UtcTimestamp;
}

export function usageCostState(event: UsageEvent): 'KNOWN' | 'UNKNOWN' {
  return event.providerCost ? 'KNOWN' : 'UNKNOWN';
}

export function logicalUsageKey(event: UsageEvent): string {
  return `${event.merchantWorkspaceId}:${event.module}:${event.logicalOperationRef}`;
}

export function shouldCountLogicalUsage(
  alreadyCountedLogicalKeys: ReadonlySet<string>,
  event: UsageEvent,
): boolean {
  return !alreadyCountedLogicalKeys.has(logicalUsageKey(event));
}

/**
 * AC-CCIA-001 (Control Center "usage.summary" read operation) — a pure, non-authority projection
 * over already-persisted `UsageEvent` rows. Grants nothing and invents no price, trial, billing or
 * reconciliation-policy semantics; it only counts and sums what has already been recorded, exactly
 * as `UsageEvent`'s own fields already model.
 *
 * Costs are summed per currency, never across currencies — `addMoney` already throws on a currency
 * mismatch, so this function cannot silently collapse USD and EUR events into one meaningless total.
 * An event with no `providerCost` is never treated as a zero-cost event: it is counted separately as
 * `unknownCostEventCount`, matching the canonical P0-006 invariant ("unknown cost is never silently
 * zero"). Module grouping uses exact string equality only (no normalization/fuzzy matching).
 */
export interface UsageModuleSummary {
  readonly module: string;
  readonly eventCount: number;
  /** One entry per distinct currency actually observed for this module; never merged across currencies. */
  readonly knownCostByCurrency: readonly Money[];
  readonly unknownCostEventCount: number;
}

export interface UsageSummary {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly rangeStart: UtcTimestamp;
  readonly rangeEnd: UtcTimestamp;
  readonly totalEventCount: number;
  readonly byModule: readonly UsageModuleSummary[];
  readonly computedAt: UtcTimestamp;
}

export function summarizeUsageEvents(input: {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly events: readonly UsageEvent[];
  readonly rangeStart: UtcTimestamp;
  readonly rangeEnd: UtcTimestamp;
  readonly computedAt: UtcTimestamp;
}): UsageSummary {
  const byModule = new Map<
    string,
    { eventCount: number; costByCurrency: Map<string, Money>; unknownCostEventCount: number }
  >();

  for (const event of input.events) {
    let bucket = byModule.get(event.module);
    if (!bucket) {
      bucket = { eventCount: 0, costByCurrency: new Map(), unknownCostEventCount: 0 };
      byModule.set(event.module, bucket);
    }
    bucket.eventCount += 1;
    if (event.providerCost) {
      const existing = bucket.costByCurrency.get(event.providerCost.currency);
      bucket.costByCurrency.set(
        event.providerCost.currency,
        existing ? addMoney(existing, event.providerCost) : event.providerCost,
      );
    } else {
      bucket.unknownCostEventCount += 1;
    }
  }

  const byModuleSorted: readonly UsageModuleSummary[] = Array.from(byModule.entries())
    .map(([module, bucket]) => ({
      module,
      eventCount: bucket.eventCount,
      knownCostByCurrency: Object.freeze([...bucket.costByCurrency.values()]),
      unknownCostEventCount: bucket.unknownCostEventCount,
    }))
    .sort((a, b) => a.module.localeCompare(b.module));

  return Object.freeze({
    merchantWorkspaceId: input.merchantWorkspaceId,
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
    totalEventCount: input.events.length,
    byModule: Object.freeze(byModuleSorted),
    computedAt: input.computedAt,
  });
}
