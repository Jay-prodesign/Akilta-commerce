import { createCustomerIdentityLinkStore, type CustomerIdentityLinkQueryExecutor } from '../../apps/api/src/customer-identity-link-store';
import {
  createIdempotencyLedgerStore,
  type IdempotencyLedgerQueryExecutor,
  type IdempotencyLedgerReadOutcome,
  type IdempotencyLedgerStore,
  type IdempotencyLedgerWriteOutcome,
} from '../../apps/api/src/idempotency-ledger-store';
import { customerIdentityLinkIdempotencyKey, type CustomerIdentityLinkIdempotencyKey } from '../../packages/authz/src';
import { internalId, type CustomerIdentityId, type MerchantWorkspaceId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const customerIdentityId: CustomerIdentityId = internalId('xcid-store-identity-1', 'CustomerIdentity');
const workspaceId: MerchantWorkspaceId = internalId('xcid-store-ws-1', 'MerchantWorkspace');
const key: CustomerIdentityLinkIdempotencyKey = customerIdentityLinkIdempotencyKey('xcid-store-idem-1');

function fakeLedger(overrides: Partial<IdempotencyLedgerStore> = {}): IdempotencyLedgerStore {
  return {
    tryGet: (): Promise<IdempotencyLedgerReadOutcome> => Promise.resolve({ status: 'NOT_FOUND' }),
    record: (): Promise<IdempotencyLedgerWriteOutcome> => Promise.resolve({ status: 'RECORDED' }),
    ...overrides,
  };
}

// A genuine in-memory simulation of the real `idempotency_records` table (same INSERT/conflict/SELECT
// semantics as idempotency-ledger-store.ts's own SQL), used by the real-round-trip test so it proves
// actual scoping behavior end-to-end rather than a mocked single-call assertion.
function statefulLedgerExecutor(): IdempotencyLedgerQueryExecutor {
  const rows = new Map<string, string>();
  function rowKey(params: readonly unknown[]): string {
    return JSON.stringify([params[0], params[1], params[2]]);
  }
  return {
    query: (sql, params) => {
      if (sql.includes('INSERT INTO idempotency_records')) {
        const rkey = rowKey(params);
        if (rows.has(rkey)) return Promise.resolve({ rows: [] });
        const snapshot = String(params[3]);
        rows.set(rkey, snapshot);
        return Promise.resolve({ rows: [{ result_snapshot: snapshot }] });
      }
      const rkey = rowKey(params);
      return Promise.resolve({ rows: rows.has(rkey) ? [{ result_snapshot: rows.get(rkey) }] : [] });
    },
  };
}

function fakeExecutor(initialRow: Record<string, unknown> | null): CustomerIdentityLinkQueryExecutor {
  let row = initialRow;
  return {
    query(sql, params) {
      if (sql.startsWith('SELECT')) return Promise.resolve({ rows: row ? [row] : [] });
      if (sql.includes('INSERT INTO customer_identity_link_events')) return Promise.resolve({ rows: [] });
      const [newCustomerId, newGeneration, , , expectedGeneration] = params;
      if (row === null || Number(row.link_generation) !== Number(expectedGeneration)) return Promise.resolve({ rows: [] });
      row = { customer_id: newCustomerId, link_generation: newGeneration };
      return Promise.resolve({ rows: [row] });
    },
  };
}

const cases: ReadonlyArray<{ readonly id: string; readonly run: () => Promise<void> }> = [
  {
    id: 'XCID-01-LINK-ON-UNLINKED-IDENTITY-APPLIES',
    run: async () => {
      const store = createCustomerIdentityLinkStore(fakeExecutor({ customer_id: null, link_generation: 0 }), fakeLedger());
      const result = await store.applyTransition(
        {
          customerIdentityId,
          merchantWorkspaceId: workspaceId,
          operation: 'LINK',
          targetCustomerId: internalId('cust-1', 'Customer'),
          expectedGeneration: 0,
          idempotencyKey: key,
        },
        'system:test-actor',
      );
      assert(result.status === 'APPLIED', 'a LINK against a currently-unlinked identity must apply');
      assert(
        result.status === 'APPLIED' && result.resultingRecord.customerId === 'cust-1' && result.resultingRecord.generation === 1,
        'the resulting record must carry the real target customer id and an advanced generation',
      );
    },
  },
  {
    id: 'XCID-02-RELINK-ON-LINKED-IDENTITY-CHANGES-TARGET',
    run: async () => {
      const store = createCustomerIdentityLinkStore(fakeExecutor({ customer_id: 'cust-old', link_generation: 3 }), fakeLedger());
      const result = await store.applyTransition(
        {
          customerIdentityId,
          merchantWorkspaceId: workspaceId,
          operation: 'RELINK',
          targetCustomerId: internalId('cust-new', 'Customer'),
          expectedGeneration: 3,
          idempotencyKey: key,
        },
        'system:test-actor',
      );
      assert(
        result.status === 'APPLIED' && result.resultingRecord.customerId === 'cust-new' && result.resultingRecord.generation === 4,
        'a RELINK must overwrite the prior pointer and advance the generation',
      );
    },
  },
  {
    id: 'XCID-03-UNLINK-ON-LINKED-IDENTITY-CLEARS-POINTER',
    run: async () => {
      const store = createCustomerIdentityLinkStore(fakeExecutor({ customer_id: 'cust-old', link_generation: 1 }), fakeLedger());
      const result = await store.applyTransition(
        { customerIdentityId, merchantWorkspaceId: workspaceId, operation: 'UNLINK', expectedGeneration: 1, idempotencyKey: key },
        'system:test-actor',
      );
      assert(
        result.status === 'APPLIED' && result.resultingRecord.customerId === undefined && result.resultingRecord.generation === 2,
        'an UNLINK must clear the pointer to a real absence, never a fabricated placeholder id',
      );
    },
  },
  {
    id: 'XCID-04-LINK-ON-ALREADY-LINKED-IDENTITY-DENIES-NEVER-WRITES',
    run: async () => {
      let writeAttempted = false;
      const store = createCustomerIdentityLinkStore(
        {
          query: (sql) => {
            if (sql.startsWith('SELECT')) return Promise.resolve({ rows: [{ customer_id: 'cust-existing', link_generation: 0 }] });
            writeAttempted = true;
            return Promise.resolve({ rows: [] });
          },
        },
        fakeLedger(),
      );
      const result = await store.applyTransition(
        {
          customerIdentityId,
          merchantWorkspaceId: workspaceId,
          operation: 'LINK',
          targetCustomerId: internalId('cust-new', 'Customer'),
          expectedGeneration: 0,
          idempotencyKey: key,
        },
        'system:test-actor',
      );
      assert(result.status === 'DENIED' && result.reason === 'ALREADY_LINKED', 'LINK on an already-linked identity must be denied, directing the caller to RELINK');
      assert(!writeAttempted, 'a denied transition must never reach a write');
    },
  },
  {
    id: 'XCID-05-RELINK-ON-UNLINKED-IDENTITY-DENIES-NOT-LINKED',
    run: async () => {
      const store = createCustomerIdentityLinkStore(fakeExecutor({ customer_id: null, link_generation: 0 }), fakeLedger());
      const result = await store.applyTransition(
        {
          customerIdentityId,
          merchantWorkspaceId: workspaceId,
          operation: 'RELINK',
          targetCustomerId: internalId('cust-new', 'Customer'),
          expectedGeneration: 0,
          idempotencyKey: key,
        },
        'system:test-actor',
      );
      assert(result.status === 'DENIED' && result.reason === 'NOT_LINKED', 'RELINK on an unlinked identity must be denied as NOT_LINKED');
    },
  },
  {
    id: 'XCID-06-LINK-WITHOUT-TARGET-CUSTOMER-DENIES',
    run: async () => {
      const store = createCustomerIdentityLinkStore(fakeExecutor({ customer_id: null, link_generation: 0 }), fakeLedger());
      const result = await store.applyTransition(
        { customerIdentityId, merchantWorkspaceId: workspaceId, operation: 'LINK', expectedGeneration: 0, idempotencyKey: key },
        'system:test-actor',
      );
      assert(result.status === 'DENIED' && result.reason === 'MISSING_TARGET_CUSTOMER', 'LINK with no target customer must be denied');
    },
  },
  {
    id: 'XCID-07-STALE-EXPECTED-GENERATION-RETURNS-CONFLICT',
    run: async () => {
      const store = createCustomerIdentityLinkStore(fakeExecutor({ customer_id: null, link_generation: 5 }), fakeLedger());
      const result = await store.applyTransition(
        {
          customerIdentityId,
          merchantWorkspaceId: workspaceId,
          operation: 'LINK',
          targetCustomerId: internalId('cust-1', 'Customer'),
          expectedGeneration: 0,
          idempotencyKey: key,
        },
        'system:test-actor',
      );
      assert(result.status === 'CONFLICT' && result.reason === 'STALE_EXPECTED_GENERATION', 'a stale expected generation must conflict, never silently overwrite');
    },
  },
  {
    id: 'XCID-08-CONCURRENT-RACE-LOSER-GETS-RACE-LOST',
    run: async () => {
      let selectCount = 0;
      const store = createCustomerIdentityLinkStore(
        {
          query: (sql) => {
            if (sql.startsWith('SELECT')) {
              selectCount += 1;
              return Promise.resolve({ rows: [{ customer_id: null, link_generation: 0 }] });
            }
            // Simulate another request already having advanced the generation between read and write.
            return Promise.resolve({ rows: [] });
          },
        },
        fakeLedger(),
      );
      const result = await store.applyTransition(
        {
          customerIdentityId,
          merchantWorkspaceId: workspaceId,
          operation: 'LINK',
          targetCustomerId: internalId('cust-1', 'Customer'),
          expectedGeneration: 0,
          idempotencyKey: key,
        },
        'system:test-actor',
      );
      assert(selectCount === 1, 'sanity: exactly one read should have occurred');
      assert(result.status === 'RACE_LOST', 'a CAS write that matches zero rows must report RACE_LOST, never a silent success');
    },
  },
  {
    id: 'XCID-09-MISSING-IDENTITY-WITH-NO-PRIOR-APPLICATION-RETURNS-NO-EXISTING-IDENTITY',
    run: async () => {
      const store = createCustomerIdentityLinkStore(fakeExecutor(null), fakeLedger());
      const result = await store.applyTransition(
        {
          customerIdentityId,
          merchantWorkspaceId: workspaceId,
          operation: 'LINK',
          targetCustomerId: internalId('cust-1', 'Customer'),
          expectedGeneration: 0,
          idempotencyKey: key,
        },
        'system:test-actor',
      );
      assert(result.status === 'NO_EXISTING_IDENTITY', 'a missing customer_identities row must be a real NO_EXISTING_IDENTITY, not a fabricated link');
    },
  },
  {
    id: 'XCID-10-IDEMPOTENT-RETRY-REPLAYS-WITHOUT-REACHING-THE-DATABASE-WRITE',
    run: async () => {
      const ledger = fakeLedger({
        tryGet: () => Promise.resolve({ status: 'FOUND', resultSnapshot: { customerId: 'cust-1', generation: 1 } }),
      });
      let writeAttempted = false;
      const store = createCustomerIdentityLinkStore(
        {
          query: (sql) => {
            if (sql.startsWith('SELECT')) return Promise.resolve({ rows: [{ customer_id: 'cust-drifted', link_generation: 9 }] });
            writeAttempted = true;
            return Promise.resolve({ rows: [] });
          },
        },
        ledger,
      );
      const result = await store.applyTransition(
        {
          customerIdentityId,
          merchantWorkspaceId: workspaceId,
          operation: 'LINK',
          targetCustomerId: internalId('cust-ignored', 'Customer'),
          expectedGeneration: 0,
          idempotencyKey: key,
        },
        'system:test-actor',
      );
      assert(
        result.status === 'ALREADY_APPLIED' && result.resultingRecord.generation === 1 && result.resultingRecord.customerId === 'cust-1',
        'a retried request with a previously-applied idempotency key must replay the original outcome verbatim, even against a drifted current row',
      );
      assert(!writeAttempted, 'a replayed idempotent retry must never attempt a database write');
    },
  },
  {
    id: 'XCID-11-READ-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const store = createCustomerIdentityLinkStore({ query: () => Promise.reject(new Error('connection lost')) }, fakeLedger());
      const result = await store.applyTransition(
        {
          customerIdentityId,
          merchantWorkspaceId: workspaceId,
          operation: 'LINK',
          targetCustomerId: internalId('cust-1', 'Customer'),
          expectedGeneration: 0,
          idempotencyKey: key,
        },
        'system:test-actor',
      );
      assert(result.status === 'STORE_ERROR', 'a read failure must fail closed as STORE_ERROR');
    },
  },
  {
    id: 'XCID-12-AUDIT-WRITE-FAILURE-STILL-REPORTS-THE-REAL-APPLIED-STATE',
    run: async () => {
      const store = createCustomerIdentityLinkStore(
        {
          query: (sql) => {
            if (sql.startsWith('SELECT')) return Promise.resolve({ rows: [{ customer_id: null, link_generation: 0 }] });
            if (sql.includes('INSERT INTO customer_identity_link_events')) throw new Error('simulated audit insert failure');
            return Promise.resolve({ rows: [{ customer_id: 'cust-1', link_generation: 1 }] });
          },
        },
        fakeLedger(),
      );
      const result = await store.applyTransition(
        {
          customerIdentityId,
          merchantWorkspaceId: workspaceId,
          operation: 'LINK',
          targetCustomerId: internalId('cust-1', 'Customer'),
          expectedGeneration: 0,
          idempotencyKey: key,
        },
        'system:test-actor',
      );
      assert(
        result.status === 'AUDIT_WRITE_FAILED' && result.resultingRecord.generation === 1 && result.ledgerWriteFailed === false,
        'an audit-write failure must never be reported as a plain STORE_ERROR — the authoritative CAS update already succeeded and must be surfaced as such, with an explicit warning, and must never misreport the (successful) ledger write as having also failed',
      );
    },
  },
  {
    id: 'XCID-13-GET-CURRENT-FOUND-NOT-FOUND-AND-STORE-ERROR',
    run: async () => {
      const found = await createCustomerIdentityLinkStore(fakeExecutor({ customer_id: 'cust-1', link_generation: 2 }), fakeLedger()).getCurrent(
        customerIdentityId,
        workspaceId,
      );
      assert(found.status === 'FOUND' && found.record.generation === 2, 'getCurrent must return the real current record when one exists');

      const notFound = await createCustomerIdentityLinkStore(fakeExecutor(null), fakeLedger()).getCurrent(customerIdentityId, workspaceId);
      assert(notFound.status === 'NOT_FOUND', 'getCurrent must return NOT_FOUND for a missing row, never a fabricated default');

      const storeError = await createCustomerIdentityLinkStore({ query: () => Promise.reject(new Error('down')) }, fakeLedger()).getCurrent(
        customerIdentityId,
        workspaceId,
      );
      assert(storeError.status === 'STORE_ERROR', 'getCurrent must fail closed on a real read failure');
    },
  },
  {
    id: 'XCID-14-LEDGER-READ-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const store = createCustomerIdentityLinkStore(
        fakeExecutor({ customer_id: null, link_generation: 0 }),
        fakeLedger({ tryGet: () => Promise.resolve({ status: 'STORE_ERROR' }) }),
      );
      const result = await store.applyTransition(
        {
          customerIdentityId,
          merchantWorkspaceId: workspaceId,
          operation: 'LINK',
          targetCustomerId: internalId('cust-1', 'Customer'),
          expectedGeneration: 0,
          idempotencyKey: key,
        },
        'system:test-actor',
      );
      assert(result.status === 'STORE_ERROR', 'a ledger read failure must fail closed as STORE_ERROR');
    },
  },
  {
    id: 'XCID-15-LEDGER-WRITE-FAILURE-STILL-REPORTS-LEDGER-WRITE-FAILED-NOT-A-PLAIN-STORE-ERROR',
    run: async () => {
      const store = createCustomerIdentityLinkStore(
        fakeExecutor({ customer_id: null, link_generation: 0 }),
        fakeLedger({ record: () => Promise.resolve({ status: 'STORE_ERROR' }) }),
      );
      const result = await store.applyTransition(
        {
          customerIdentityId,
          merchantWorkspaceId: workspaceId,
          operation: 'LINK',
          targetCustomerId: internalId('cust-1', 'Customer'),
          expectedGeneration: 0,
          idempotencyKey: key,
        },
        'system:test-actor',
      );
      assert(
        result.status === 'LEDGER_WRITE_FAILED' && result.resultingRecord.customerId === 'cust-1' && result.resultingRecord.generation === 1,
        'a ledger write failure after a successful CAS update must never be reported as a plain STORE_ERROR — the transition itself was really applied',
      );
    },
  },
  {
    id: 'XCID-16-LEDGER-ALREADY-RECORDED-STILL-REPORTS-THIS-REQUESTS-OWN-REAL-CAS-RESULT-NOT-SOME-OTHER-ENTRYS',
    run: async () => {
      // Same reasoning as conversation-ownership-store.ts: this store's own CAS UPDATE has already
      // uniquely mutated the row by the time ledger.record() runs, so an ALREADY_RECORDED outcome can
      // only mean idempotency-key reuse across an unrelated transition — this request's own real,
      // fresher outcome must still be what gets reported, never the other entry's snapshot.
      const store = createCustomerIdentityLinkStore(
        fakeExecutor({ customer_id: null, link_generation: 0 }),
        fakeLedger({
          record: () => Promise.resolve({ status: 'ALREADY_RECORDED', resultSnapshot: { customerId: 'cust-unrelated', generation: 9 } }),
        }),
      );
      const result = await store.applyTransition(
        {
          customerIdentityId,
          merchantWorkspaceId: workspaceId,
          operation: 'LINK',
          targetCustomerId: internalId('cust-1', 'Customer'),
          expectedGeneration: 0,
          idempotencyKey: key,
        },
        'system:test-actor',
      );
      assert(
        result.status === 'LEDGER_WRITE_FAILED' && result.resultingRecord.customerId === 'cust-1' && result.resultingRecord.generation === 1,
        "an ALREADY_RECORDED ledger outcome must report this request's own real resultingRecord (cust-1/generation 1), never the other, unrelated ledger entry's snapshot (cust-unrelated/generation 9)",
      );
    },
  },
  {
    id: 'XCID-17-MALFORMED-LEDGER-SNAPSHOT-ON-REPLAY-FAILS-CLOSED-AS-STORE-ERROR',
    run: async () => {
      const store = createCustomerIdentityLinkStore(
        fakeExecutor(null),
        fakeLedger({ tryGet: () => Promise.resolve({ status: 'FOUND', resultSnapshot: { generation: 'not-a-number' } }) }),
      );
      const result = await store.applyTransition(
        {
          customerIdentityId,
          merchantWorkspaceId: workspaceId,
          operation: 'LINK',
          targetCustomerId: internalId('cust-1', 'Customer'),
          expectedGeneration: 0,
          idempotencyKey: key,
        },
        'system:test-actor',
      );
      assert(result.status === 'STORE_ERROR', 'a malformed/corrupted ledger snapshot on replay must fail closed as STORE_ERROR, never throw uncaught');
    },
  },
  {
    id: 'XCID-18-BOTH-LEDGER-AND-AUDIT-WRITE-FAILURES-ARE-BOTH-REPORTED-NEITHER-SILENTLY-DROPPED',
    run: async () => {
      const store = createCustomerIdentityLinkStore(
        {
          query: (sql) => {
            if (sql.startsWith('SELECT')) return Promise.resolve({ rows: [{ customer_id: null, link_generation: 0 }] });
            if (sql.includes('INSERT INTO customer_identity_link_events')) throw new Error('simulated audit insert failure');
            return Promise.resolve({ rows: [{ customer_id: 'cust-1', link_generation: 1 }] });
          },
        },
        fakeLedger({ record: () => Promise.resolve({ status: 'STORE_ERROR' }) }),
      );
      const result = await store.applyTransition(
        {
          customerIdentityId,
          merchantWorkspaceId: workspaceId,
          operation: 'LINK',
          targetCustomerId: internalId('cust-1', 'Customer'),
          expectedGeneration: 0,
          idempotencyKey: key,
        },
        'system:test-actor',
      );
      assert(
        result.status === 'AUDIT_WRITE_FAILED' && result.ledgerWriteFailed === true,
        'when the ledger write AND the audit insert both fail in the same request, the outcome must still be AUDIT_WRITE_FAILED with ledgerWriteFailed:true — the ledger failure must never be silently overwritten by the later audit-insert failure',
      );
    },
  },
  {
    id: 'XCID-19-REAL-LEDGER-ROUND-TRIP-SCOPES-BY-IDENTITY-AND-REPLAYS-CORRECTLY',
    run: async () => {
      const identityA: CustomerIdentityId = internalId('xcid-store-identity-real-A', 'CustomerIdentity');
      const identityB: CustomerIdentityId = internalId('xcid-store-identity-real-B', 'CustomerIdentity');
      const sharedKey = customerIdentityLinkIdempotencyKey('shared-raw-key');
      const ledger = createIdempotencyLedgerStore(statefulLedgerExecutor());

      const storeA = createCustomerIdentityLinkStore(fakeExecutor({ customer_id: null, link_generation: 0 }), ledger);
      const firstForA = await storeA.applyTransition(
        {
          customerIdentityId: identityA,
          merchantWorkspaceId: workspaceId,
          operation: 'LINK',
          targetCustomerId: internalId('cust-a', 'Customer'),
          expectedGeneration: 0,
          idempotencyKey: sharedKey,
        },
        'system:test-actor',
      );
      assert(firstForA.status === 'APPLIED', 'first transition for identity A with a fresh key must apply');

      const storeB = createCustomerIdentityLinkStore(fakeExecutor({ customer_id: null, link_generation: 0 }), ledger);
      const firstForB = await storeB.applyTransition(
        {
          customerIdentityId: identityB,
          merchantWorkspaceId: workspaceId,
          operation: 'LINK',
          targetCustomerId: internalId('cust-b', 'Customer'),
          expectedGeneration: 0,
          idempotencyKey: sharedKey,
        },
        'system:test-actor',
      );
      assert(
        firstForB.status === 'APPLIED',
        'identity B reusing the SAME raw key as identity A must never be treated as a replay — real cross-identity non-collision',
      );
      assert(
        firstForB.status === 'APPLIED' && firstForA.status === 'APPLIED' && firstForB.resultingRecord.customerId !== firstForA.resultingRecord.customerId,
        'identity A and B must each get their own real, distinct link outcome — not share one via a collided ledger key',
      );

      const retryForA = await storeA.applyTransition(
        {
          customerIdentityId: identityA,
          merchantWorkspaceId: workspaceId,
          operation: 'LINK',
          targetCustomerId: internalId('cust-a-ignored', 'Customer'),
          expectedGeneration: 5,
          idempotencyKey: sharedKey,
        },
        'system:test-actor',
      );
      assert(
        retryForA.status === 'ALREADY_APPLIED' &&
          firstForA.status === 'APPLIED' &&
          retryForA.resultingRecord.generation === firstForA.resultingRecord.generation &&
          retryForA.resultingRecord.customerId === firstForA.resultingRecord.customerId,
        'retrying identity A with the same key (even with a now-stale expectedGeneration) must replay its own real first outcome — real same-identity idempotency',
      );
    },
  },
  {
    id: 'XCID-20-REUSING-THE-SAME-RAW-KEY-ACROSS-LINK-AND-RELINK-ON-THE-SAME-IDENTITY-NEVER-COLLIDES',
    run: async () => {
      // Regression for an independent-review-adjacent self-review finding: CUSTOMER_IDENTITY_LINK_OPERATION_KEY
      // is one constant shared by LINK/RELINK/UNLINK, so `operation` must be folded into scopedLedgerKey
      // itself — otherwise a caller reusing the same raw key across two different operations on the
      // same identity would incorrectly replay the first operation's result instead of executing the
      // second for real.
      const sharedKey = customerIdentityLinkIdempotencyKey('shared-key-across-operations');
      const ledger = createIdempotencyLedgerStore(statefulLedgerExecutor());
      const executor = fakeExecutor({ customer_id: null, link_generation: 0 });
      const store = createCustomerIdentityLinkStore(executor, ledger);

      const linkResult = await store.applyTransition(
        {
          customerIdentityId,
          merchantWorkspaceId: workspaceId,
          operation: 'LINK',
          targetCustomerId: internalId('cust-first', 'Customer'),
          expectedGeneration: 0,
          idempotencyKey: sharedKey,
        },
        'system:test-actor',
      );
      assert(linkResult.status === 'APPLIED' && linkResult.resultingRecord.customerId === 'cust-first' && linkResult.resultingRecord.generation === 1, 'the LINK must really apply');

      const relinkResult = await store.applyTransition(
        {
          customerIdentityId,
          merchantWorkspaceId: workspaceId,
          operation: 'RELINK',
          targetCustomerId: internalId('cust-second', 'Customer'),
          expectedGeneration: 1,
          idempotencyKey: sharedKey,
        },
        'system:test-actor',
      );
      assert(
        relinkResult.status === 'APPLIED' &&
          relinkResult.resultingRecord.customerId === 'cust-second' &&
          relinkResult.resultingRecord.generation === 2,
        'a RELINK reusing the exact same raw idempotency key as the prior LINK must still really apply (APPLIED, cust-second, generation 2) — never replay the LINK\'s cached outcome as if the RELINK were a duplicate of it',
      );
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} customer identity link store (adapter) scenarios`);
}

void main();
