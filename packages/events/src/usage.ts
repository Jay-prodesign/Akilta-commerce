import { assertNonEmptyString, type Brand } from '../../domain/src/brand';
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

export function usageUnit(value: string): UsageUnit {
  return assertNonEmptyString(value, 'UsageUnit') as UsageUnit;
}

export function rateCardVersion(value: string): RateCardVersion {
  return assertNonEmptyString(value, 'RateCardVersion') as RateCardVersion;
}

export function reconciliationState(value: string): ReconciliationState {
  return assertNonEmptyString(value, 'ReconciliationState') as ReconciliationState;
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
