import {
  rateCardVersion,
  reconciliationState,
  summarizeUsageEvents,
  usageUnit,
  type UsageEvent,
  type UsageSummary,
} from '../../../packages/events/src';
import {
  internalId,
  isoCurrencyCode,
  money,
  utcTimestamp,
  type MerchantWorkspaceId,
  type UtcTimestamp,
} from '../../../packages/domain/src';

/**
 * AC-CCIA-001 ("usage.summary" Control Center read operation) persistence adapter. Reads already-
 * persisted `usage_events` rows for one workspace and time range and hands them, unmodified, to the
 * pure `summarizeUsageEvents` projection (packages/events/src/usage.ts) — this file owns no
 * aggregation/billing logic of its own, only the SQL read and the row→`UsageEvent` mapping.
 *
 * `provider_cost_amount_minor`/`provider_cost_currency` are both nullable in the schema (UNKNOWN
 * cost semantics, P0-006): a row is mapped to `providerCost: undefined` only when BOTH are absent;
 * a row carrying only one of the two is a data-integrity defect this adapter refuses to paper over —
 * it is reported as `STORE_ERROR`, never silently treated as a known or unknown cost by guessing.
 */

export interface UsageSummaryQueryExecutor {
  query(sql: string, params: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

const SELECT_EVENTS_IN_RANGE = `
  SELECT usage_event_id, module, run_id, correlation_id, logical_operation_ref, provider_type,
         provider_operation, quantity, unit, rate_card_version, provider_cost_amount_minor,
         provider_cost_currency, estimated_flag, reconciliation_state, provider_usage_ref, occurred_at
  FROM usage_events
  WHERE merchant_workspace_id = $1 AND occurred_at >= $2 AND occurred_at < $3
`;

export type UsageSummaryReadOutcome =
  | { readonly status: 'FOUND'; readonly summary: UsageSummary }
  | { readonly status: 'STORE_ERROR' };

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function rowToUsageEvent(merchantWorkspaceId: MerchantWorkspaceId, row: Record<string, unknown>): UsageEvent {
  const hasCostAmount = row.provider_cost_amount_minor !== null && row.provider_cost_amount_minor !== undefined;
  const hasCostCurrency = row.provider_cost_currency !== null && row.provider_cost_currency !== undefined;
  if (hasCostAmount !== hasCostCurrency) {
    throw new Error('usage_events row has a provider cost amount/currency pair that is only half-present');
  }

  const runIdText = textOrUndefined(row.run_id);
  const correlationIdText = textOrUndefined(row.correlation_id);
  const providerUsageRefText = textOrUndefined(row.provider_usage_ref);

  return {
    usageEventId: internalId(String(row.usage_event_id), 'UsageEvent'),
    merchantWorkspaceId,
    module: String(row.module),
    ...(runIdText !== undefined ? { runId: internalId(runIdText, 'Run') } : {}),
    ...(correlationIdText !== undefined ? { correlationId: internalId(correlationIdText, 'Correlation') } : {}),
    logicalOperationRef: String(row.logical_operation_ref),
    providerType: String(row.provider_type),
    providerOperation: String(row.provider_operation),
    quantity: BigInt(String(row.quantity)),
    unit: usageUnit(String(row.unit)),
    rateCardVersion: rateCardVersion(String(row.rate_card_version)),
    ...(hasCostAmount
      ? { providerCost: money(BigInt(String(row.provider_cost_amount_minor)), isoCurrencyCode(String(row.provider_cost_currency))) }
      : {}),
    estimatedFlag: Boolean(row.estimated_flag),
    reconciliationState: reconciliationState(String(row.reconciliation_state)),
    ...(providerUsageRefText !== undefined ? { providerUsageRef: providerUsageRefText } : {}),
    occurredAt: utcTimestamp(new Date(String(row.occurred_at))),
  };
}

export interface UsageSummaryStore {
  readSummary(
    merchantWorkspaceId: MerchantWorkspaceId,
    rangeStart: UtcTimestamp,
    rangeEnd: UtcTimestamp,
    computedAt: UtcTimestamp,
  ): Promise<UsageSummaryReadOutcome>;
}

export function createUsageSummaryStore(executor: UsageSummaryQueryExecutor): UsageSummaryStore {
  return {
    async readSummary(merchantWorkspaceId, rangeStart, rangeEnd, computedAt) {
      let rows: readonly Record<string, unknown>[];
      try {
        const result = await executor.query(SELECT_EVENTS_IN_RANGE, [merchantWorkspaceId, rangeStart, rangeEnd]);
        rows = result.rows;
      } catch {
        return { status: 'STORE_ERROR' };
      }

      let events: readonly UsageEvent[];
      try {
        events = rows.map((row) => rowToUsageEvent(merchantWorkspaceId, row));
      } catch {
        return { status: 'STORE_ERROR' };
      }

      return {
        status: 'FOUND',
        summary: summarizeUsageEvents({ merchantWorkspaceId, events, rangeStart, rangeEnd, computedAt }),
      };
    },
  };
}
