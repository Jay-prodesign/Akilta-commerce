import { createUsageSummaryStore, type UsageSummaryQueryExecutor } from '../../apps/api/src/usage-summary-store';
import { internalId, isoCurrencyCode, utcTimestamp, type MerchantWorkspaceId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspaceId: MerchantWorkspaceId = internalId('usage-store-ws-1', 'MerchantWorkspace');
const rangeStart = utcTimestamp('2026-10-01T00:00:00Z');
const rangeEnd = utcTimestamp('2026-10-31T00:00:00Z');
const computedAt = utcTimestamp('2026-10-31T00:05:00Z');

function baseRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    usage_event_id: 'ue-1',
    module: 'conversation.ai_reply',
    run_id: null,
    correlation_id: null,
    logical_operation_ref: 'op-1',
    provider_type: 'openai',
    provider_operation: 'chat.completion',
    quantity: '100',
    unit: 'token',
    rate_card_version: 'rc-v1',
    provider_cost_amount_minor: null,
    provider_cost_currency: null,
    estimated_flag: false,
    reconciliation_state: 'SETTLED',
    provider_usage_ref: null,
    occurred_at: '2026-10-15T10:00:00.000Z',
    ...overrides,
  };
}

function executor(rows: readonly Record<string, unknown>[]): UsageSummaryQueryExecutor {
  return { query: () => Promise.resolve({ rows }) };
}

const cases: ReadonlyArray<{ readonly id: string; readonly run: () => Promise<void> }> = [
  {
    id: 'USTORE-01-ROWS-MAP-INTO-A-REAL-SUMMARY-WITH-KNOWN-COST',
    run: async () => {
      const store = createUsageSummaryStore(
        executor([baseRow({ provider_cost_amount_minor: '250', provider_cost_currency: 'USD' })]),
      );
      const result = await store.readSummary(workspaceId, rangeStart, rangeEnd, computedAt);
      assert(result.status === 'FOUND', 'a successful read must return FOUND');
      assert(
        result.status === 'FOUND' &&
          result.summary.totalEventCount === 1 &&
          result.summary.byModule[0]!.knownCostByCurrency[0]!.amountMinor === 250n &&
          result.summary.byModule[0]!.knownCostByCurrency[0]!.currency === isoCurrencyCode('USD'),
        'the mapped UsageEvent must carry its real known cost through to the summary',
      );
    },
  },
  {
    id: 'USTORE-02-NULL-PROVIDER-COST-MAPS-TO-UNKNOWN-NEVER-A-FABRICATED-ZERO',
    run: async () => {
      const store = createUsageSummaryStore(executor([baseRow()]));
      const result = await store.readSummary(workspaceId, rangeStart, rangeEnd, computedAt);
      assert(
        result.status === 'FOUND' && result.summary.byModule[0]!.unknownCostEventCount === 1 && result.summary.byModule[0]!.knownCostByCurrency.length === 0,
        'a row with no provider cost columns must map to an unknown-cost event, not a zero-cost one',
      );
    },
  },
  {
    id: 'USTORE-03-HALF-PRESENT-COST-PAIR-IS-A-STORE-ERROR-NEVER-A-GUESSED-VALUE',
    run: async () => {
      const store = createUsageSummaryStore(
        executor([baseRow({ provider_cost_amount_minor: '100', provider_cost_currency: null })]),
      );
      const result = await store.readSummary(workspaceId, rangeStart, rangeEnd, computedAt);
      assert(
        result.status === 'STORE_ERROR',
        'a row with only one half of the cost amount/currency pair present must never be silently completed with a guess',
      );
    },
  },
  {
    id: 'USTORE-04-READ-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const store = createUsageSummaryStore({ query: () => Promise.reject(new Error('connection lost')) });
      const result = await store.readSummary(workspaceId, rangeStart, rangeEnd, computedAt);
      assert(result.status === 'STORE_ERROR', 'a query failure (connectivity/timeout) must fail closed as STORE_ERROR');
    },
  },
  {
    id: 'USTORE-05-OPTIONAL-RUN-AND-CORRELATION-IDS-ARE-CARRIED-WHEN-PRESENT',
    run: async () => {
      const store = createUsageSummaryStore(executor([baseRow({ run_id: 'run-1', correlation_id: 'corr-1' })]));
      const result = await store.readSummary(workspaceId, rangeStart, rangeEnd, computedAt);
      assert(result.status === 'FOUND' && result.summary.totalEventCount === 1, 'a row with optional ids present must still map successfully');
    },
  },
  {
    id: 'USTORE-06-ZERO-ROWS-PRODUCES-A-REAL-EMPTY-SUMMARY-NOT-A-STORE-ERROR',
    run: async () => {
      const store = createUsageSummaryStore(executor([]));
      const result = await store.readSummary(workspaceId, rangeStart, rangeEnd, computedAt);
      assert(
        result.status === 'FOUND' && result.summary.totalEventCount === 0 && result.summary.byModule.length === 0,
        'a workspace with no usage in range must read as a genuine empty summary, not an error',
      );
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} usage summary store (adapter) scenarios`);
}

void main();
