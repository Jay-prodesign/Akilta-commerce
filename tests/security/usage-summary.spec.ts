import {
  rateCardVersion,
  reconciliationState,
  summarizeUsageEvents,
  usageUnit,
  type UsageEvent,
} from '../../packages/events/src';
import {
  internalId,
  isoCurrencyCode,
  money,
  utcTimestamp,
  type MerchantWorkspaceId,
} from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspaceId: MerchantWorkspaceId = internalId('usage-ws-1', 'MerchantWorkspace');
const rangeStart = utcTimestamp('2026-10-01T00:00:00Z');
const rangeEnd = utcTimestamp('2026-10-31T00:00:00Z');
const computedAt = utcTimestamp('2026-10-31T00:05:00Z');

let seq = 0;
function event(overrides: Partial<UsageEvent> = {}): UsageEvent {
  seq += 1;
  return {
    usageEventId: internalId(`usage-event-${seq}`, 'UsageEvent'),
    merchantWorkspaceId: workspaceId,
    module: 'conversation.ai_reply',
    logicalOperationRef: `op-${seq}`,
    providerType: 'openai',
    providerOperation: 'chat.completion',
    quantity: 100n,
    unit: usageUnit('token'),
    rateCardVersion: rateCardVersion('rc-v1'),
    estimatedFlag: false,
    reconciliationState: reconciliationState('SETTLED'),
    occurredAt: utcTimestamp('2026-10-15T10:00:00Z'),
    ...overrides,
  };
}

function summarize(events: readonly UsageEvent[]) {
  return summarizeUsageEvents({ merchantWorkspaceId: workspaceId, events, rangeStart, rangeEnd, computedAt });
}

const cases: ReadonlyArray<{ readonly id: string; readonly run: () => void }> = [
  {
    id: 'UNSUM-01-EMPTY-EVENTS-PRODUCES-ZERO-TOTAL-AND-NO-MODULE-ROWS',
    run: () => {
      const summary = summarize([]);
      assert(
        summary.totalEventCount === 0 && summary.byModule.length === 0,
        'no events must summarize to a real zero, not an absent/undefined total',
      );
    },
  },
  {
    id: 'UNSUM-02-SAME-MODULE-SAME-CURRENCY-COSTS-SUM-CORRECTLY',
    run: () => {
      const summary = summarize([
        event({ providerCost: money(150n, 'USD') }),
        event({ providerCost: money(250n, 'USD') }),
      ]);
      assert(summary.totalEventCount === 2, 'total event count must reflect every event');
      assert(summary.byModule.length === 1, 'identical module strings must collapse into exactly one row');
      const row = summary.byModule[0]!;
      assert(row.eventCount === 2, 'the module row must count both events');
      assert(
        row.knownCostByCurrency.length === 1 &&
          row.knownCostByCurrency[0]!.currency === isoCurrencyCode('USD') &&
          row.knownCostByCurrency[0]!.amountMinor === 400n,
        'same-currency known costs for one module must sum via addMoney, never silently drop a value',
      );
      assert(row.unknownCostEventCount === 0, 'every event here had a known cost');
    },
  },
  {
    id: 'UNSUM-03-DIFFERENT-CURRENCIES-NEVER-MERGE-INTO-ONE-TOTAL',
    run: () => {
      const summary = summarize([
        event({ providerCost: money(100n, 'USD') }),
        event({ providerCost: money(100n, 'EUR') }),
      ]);
      const row = summary.byModule[0]!;
      assert(
        row.knownCostByCurrency.length === 2,
        'USD and EUR costs for the same module must never collapse into one meaningless cross-currency total',
      );
      const byCurrency = new Map(row.knownCostByCurrency.map((m) => [m.currency, m.amountMinor]));
      assert(byCurrency.get(isoCurrencyCode('USD')) === 100n && byCurrency.get(isoCurrencyCode('EUR')) === 100n,
        'each currency must retain its own exact amount, untouched by the other');
    },
  },
  {
    id: 'UNSUM-04-MISSING-PROVIDER-COST-COUNTS-AS-UNKNOWN-NEVER-A-SILENT-ZERO',
    run: () => {
      const summary = summarize([event(), event({ providerCost: money(500n, 'USD') })]);
      const row = summary.byModule[0]!;
      assert(row.unknownCostEventCount === 1, 'an event with no providerCost must be counted as unknown, never folded into the known total');
      assert(
        row.knownCostByCurrency.length === 1 && row.knownCostByCurrency[0]!.amountMinor === 500n,
        'the known-cost total must reflect only the event that actually carried a cost (P0-006: unknown cost is never silently zero)',
      );
    },
  },
  {
    id: 'UNSUM-05-DISTINCT-MODULES-PRODUCE-SEPARATE-SORTED-ROWS',
    run: () => {
      const summary = summarize([
        event({ module: 'zeta.module' }),
        event({ module: 'alpha.module' }),
        event({ module: 'alpha.module' }),
      ]);
      assert(summary.byModule.length === 2, 'two distinct module strings must produce two separate rows, never merged');
      assert(
        summary.byModule[0]!.module === 'alpha.module' && summary.byModule[1]!.module === 'zeta.module',
        'module rows must be deterministically sorted, independent of input order',
      );
      assert(summary.byModule[0]!.eventCount === 2 && summary.byModule[1]!.eventCount === 1, 'per-module counts must stay isolated per module');
    },
  },
  {
    id: 'UNSUM-06-RESULT-IS-A-FROZEN-NON-AUTHORITY-READ-ONLY-VIEW',
    run: () => {
      const summary = summarize([event({ providerCost: money(10n, 'USD') })]);
      assert(Object.isFrozen(summary), 'the summary itself must be frozen');
      assert(Object.isFrozen(summary.byModule), 'the byModule array must be frozen');
      assert(Object.isFrozen(summary.byModule[0]!.knownCostByCurrency), 'per-module currency arrays must be frozen');
    },
  },
  {
    id: 'UNSUM-07-RANGE-AND-COMPUTED-AT-ARE-CARRIED-THROUGH-FAITHFULLY',
    run: () => {
      const summary = summarize([]);
      assert(
        summary.merchantWorkspaceId === workspaceId &&
          summary.rangeStart === rangeStart &&
          summary.rangeEnd === rangeEnd &&
          summary.computedAt === computedAt,
        'the summary must faithfully carry the exact workspace/range/computedAt it was given, never substitute its own',
      );
    },
  },
];

function main() {
  for (const testCase of cases) {
    testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} usage summary projection scenarios`);
}

main();
