import type { MerchantWorkspaceId } from '../../../packages/domain/src';

/**
 * Durable idempotency ledger adapter — the building block for closing a D-090 Invariant #2 gap
 * disclosed repeatedly this session: every mutation route built so far (`conversation-handoff-
 * route.ts`, `message-draft-route.ts`, `customer-identity-link-route.ts`) accepts an injected
 * `ReadonlyMap` of already-applied idempotency keys that nothing has ever actually populated, so a
 * genuine HTTP retry has never replayed — it attempts a fresh mutation every time.
 *
 * NOT YET WIRED to any route as of this commit — this file introduces the adapter, its migration,
 * and its own adversarial tests only. Retrofitting each of the three routes above to read/write
 * through this store instead of their injected `ReadonlyMap` parameter is the immediately-following
 * unit, done one route at a time with its own tests/review/commit rather than in one combined change.
 * Until that lands for a given route, that route's idempotent-retry behavior remains exactly as
 * disclosed in its own doc comment: not functional end-to-end.
 *
 * Deliberately generic and record-shape-agnostic: this table/adapter has no opinion on what a
 * `ConversationOwnershipRecord` or a `MessageDraftRecord` looks like. Each call site serializes its
 * own typed record to a plain JSON-safe object before calling `record()`, and deserializes it back
 * (via that type's own constructors — e.g. `internalId(...)`, `utcTimestamp(...)` — never a bare type
 * assertion) after calling `tryGet()`. This keeps the ledger itself simple and means a future mutation
 * route never needs a new migration just to get durable idempotency.
 *
 * `operationKey` scopes the ledger per logical operation (e.g. `'conversation.handoff'`), so the same
 * `merchantWorkspaceId`+`idempotencyKey` pair can never collide across unrelated operations even if a
 * caller reuses a key string. Scoping by `merchantWorkspaceId` is mandatory here (not optional, unlike
 * the caller-supplied key alone) — this is the actual fix for the cross-tenant collision risk
 * `customer-identity-link-route.ts`'s own idempotency key composition already works around at the
 * call-site level; this table makes that discipline structural for every future caller instead of
 * relying on each route remembering to compose its own scoped key string.
 */

export interface IdempotencyLedgerQueryExecutor {
  query(sql: string, params: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

export type IdempotencyLedgerReadOutcome =
  | { readonly status: 'FOUND'; readonly resultSnapshot: Readonly<Record<string, unknown>> }
  | { readonly status: 'NOT_FOUND' }
  | { readonly status: 'STORE_ERROR' };

export type IdempotencyLedgerWriteOutcome =
  | { readonly status: 'RECORDED' }
  | { readonly status: 'ALREADY_RECORDED'; readonly resultSnapshot: Readonly<Record<string, unknown>> }
  | { readonly status: 'STORE_ERROR' };

const SELECT_RECORD =
  'SELECT result_snapshot FROM idempotency_records WHERE operation_key = $1 AND merchant_workspace_id = $2 AND idempotency_key = $3';

const INSERT_RECORD = `
  INSERT INTO idempotency_records (operation_key, merchant_workspace_id, idempotency_key, result_snapshot, created_at)
  VALUES ($1, $2, $3, $4, now())
  ON CONFLICT (operation_key, merchant_workspace_id, idempotency_key) DO NOTHING
  RETURNING result_snapshot
`;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseSnapshot(raw: unknown): Readonly<Record<string, unknown>> {
  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (isPlainRecord(parsed)) return parsed;
  throw new Error('idempotency_records.result_snapshot did not parse to a plain object');
}

export interface IdempotencyLedgerStore {
  tryGet(
    operationKey: string,
    merchantWorkspaceId: MerchantWorkspaceId,
    idempotencyKey: string,
  ): Promise<IdempotencyLedgerReadOutcome>;
  /**
   * Records a new outcome. A concurrent writer that already recorded the same
   * (operationKey, merchantWorkspaceId, idempotencyKey) wins the race deterministically — this
   * returns `ALREADY_RECORDED` with *that* writer's snapshot rather than an error, so the caller can
   * treat it exactly like any other replay rather than a failure.
   */
  record(
    operationKey: string,
    merchantWorkspaceId: MerchantWorkspaceId,
    idempotencyKey: string,
    resultSnapshot: Readonly<Record<string, unknown>>,
  ): Promise<IdempotencyLedgerWriteOutcome>;
}

export function createIdempotencyLedgerStore(executor: IdempotencyLedgerQueryExecutor): IdempotencyLedgerStore {
  return {
    async tryGet(operationKey, merchantWorkspaceId, idempotencyKey) {
      try {
        const result = await executor.query(SELECT_RECORD, [operationKey, merchantWorkspaceId, idempotencyKey]);
        const row = result.rows[0];
        if (!row) return { status: 'NOT_FOUND' };
        return { status: 'FOUND', resultSnapshot: parseSnapshot(row.result_snapshot) };
      } catch {
        return { status: 'STORE_ERROR' };
      }
    },
    async record(operationKey, merchantWorkspaceId, idempotencyKey, resultSnapshot) {
      try {
        const insertResult = await executor.query(INSERT_RECORD, [
          operationKey,
          merchantWorkspaceId,
          idempotencyKey,
          JSON.stringify(resultSnapshot),
        ]);
        if (insertResult.rows.length > 0) {
          return { status: 'RECORDED' };
        }
      } catch {
        return { status: 'STORE_ERROR' };
      }

      try {
        const existing = await executor.query(SELECT_RECORD, [operationKey, merchantWorkspaceId, idempotencyKey]);
        const row = existing.rows[0];
        if (!row) return { status: 'STORE_ERROR' };
        return { status: 'ALREADY_RECORDED', resultSnapshot: parseSnapshot(row.result_snapshot) };
      } catch {
        return { status: 'STORE_ERROR' };
      }
    },
  };
}
