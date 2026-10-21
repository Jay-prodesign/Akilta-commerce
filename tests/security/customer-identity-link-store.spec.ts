import { createCustomerIdentityLinkStore, type CustomerIdentityLinkQueryExecutor } from '../../apps/api/src/customer-identity-link-store';
import {
  customerIdentityLinkIdempotencyKey,
  type CustomerIdentityLinkIdempotencyKey,
  type CustomerIdentityLinkRecord,
} from '../../packages/authz/src';
import { internalId, type CustomerIdentityId, type MerchantWorkspaceId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const customerIdentityId: CustomerIdentityId = internalId('xcid-store-identity-1', 'CustomerIdentity');
const workspaceId: MerchantWorkspaceId = internalId('xcid-store-ws-1', 'MerchantWorkspace');
const key: CustomerIdentityLinkIdempotencyKey = customerIdentityLinkIdempotencyKey('xcid-store-idem-1');

function emptyMap(): ReadonlyMap<CustomerIdentityLinkIdempotencyKey, CustomerIdentityLinkRecord> {
  return new Map();
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
      const store = createCustomerIdentityLinkStore(fakeExecutor({ customer_id: null, link_generation: 0 }));
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
        emptyMap(),
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
      const store = createCustomerIdentityLinkStore(fakeExecutor({ customer_id: 'cust-old', link_generation: 3 }));
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
        emptyMap(),
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
      const store = createCustomerIdentityLinkStore(fakeExecutor({ customer_id: 'cust-old', link_generation: 1 }));
      const result = await store.applyTransition(
        { customerIdentityId, merchantWorkspaceId: workspaceId, operation: 'UNLINK', expectedGeneration: 1, idempotencyKey: key },
        'system:test-actor',
        emptyMap(),
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
      const store = createCustomerIdentityLinkStore({
        query: (sql) => {
          if (sql.startsWith('SELECT')) return Promise.resolve({ rows: [{ customer_id: 'cust-existing', link_generation: 0 }] });
          writeAttempted = true;
          return Promise.resolve({ rows: [] });
        },
      });
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
        emptyMap(),
      );
      assert(result.status === 'DENIED' && result.reason === 'ALREADY_LINKED', 'LINK on an already-linked identity must be denied, directing the caller to RELINK');
      assert(!writeAttempted, 'a denied transition must never reach a write');
    },
  },
  {
    id: 'XCID-05-RELINK-ON-UNLINKED-IDENTITY-DENIES-NOT-LINKED',
    run: async () => {
      const store = createCustomerIdentityLinkStore(fakeExecutor({ customer_id: null, link_generation: 0 }));
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
        emptyMap(),
      );
      assert(result.status === 'DENIED' && result.reason === 'NOT_LINKED', 'RELINK on an unlinked identity must be denied as NOT_LINKED');
    },
  },
  {
    id: 'XCID-06-LINK-WITHOUT-TARGET-CUSTOMER-DENIES',
    run: async () => {
      const store = createCustomerIdentityLinkStore(fakeExecutor({ customer_id: null, link_generation: 0 }));
      const result = await store.applyTransition(
        { customerIdentityId, merchantWorkspaceId: workspaceId, operation: 'LINK', expectedGeneration: 0, idempotencyKey: key },
        'system:test-actor',
        emptyMap(),
      );
      assert(result.status === 'DENIED' && result.reason === 'MISSING_TARGET_CUSTOMER', 'LINK with no target customer must be denied');
    },
  },
  {
    id: 'XCID-07-STALE-EXPECTED-GENERATION-RETURNS-CONFLICT',
    run: async () => {
      const store = createCustomerIdentityLinkStore(fakeExecutor({ customer_id: null, link_generation: 5 }));
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
        emptyMap(),
      );
      assert(result.status === 'CONFLICT' && result.reason === 'STALE_EXPECTED_GENERATION', 'a stale expected generation must conflict, never silently overwrite');
    },
  },
  {
    id: 'XCID-08-CONCURRENT-RACE-LOSER-GETS-RACE-LOST',
    run: async () => {
      let selectCount = 0;
      const store = createCustomerIdentityLinkStore({
        query: (sql) => {
          if (sql.startsWith('SELECT')) {
            selectCount += 1;
            return Promise.resolve({ rows: [{ customer_id: null, link_generation: 0 }] });
          }
          // Simulate another request already having advanced the generation between read and write.
          return Promise.resolve({ rows: [] });
        },
      });
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
        emptyMap(),
      );
      assert(selectCount === 1, 'sanity: exactly one read should have occurred');
      assert(result.status === 'RACE_LOST', 'a CAS write that matches zero rows must report RACE_LOST, never a silent success');
    },
  },
  {
    id: 'XCID-09-MISSING-IDENTITY-WITH-NO-PRIOR-APPLICATION-RETURNS-NO-EXISTING-IDENTITY',
    run: async () => {
      const store = createCustomerIdentityLinkStore(fakeExecutor(null));
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
        emptyMap(),
      );
      assert(result.status === 'NO_EXISTING_IDENTITY', 'a missing customer_identities row must be a real NO_EXISTING_IDENTITY, not a fabricated link');
    },
  },
  {
    id: 'XCID-10-IDEMPOTENT-RETRY-REPLAYS-WITHOUT-REACHING-THE-DATABASE-WRITE',
    run: async () => {
      const applied: CustomerIdentityLinkRecord = {
        ownerCustomerIdentityId: customerIdentityId,
        ownerMerchantWorkspaceId: workspaceId,
        customerId: internalId('cust-1', 'Customer'),
        generation: 1,
      };
      const ledger: ReadonlyMap<CustomerIdentityLinkIdempotencyKey, CustomerIdentityLinkRecord> = new Map([[key, applied]]);
      let writeAttempted = false;
      const store = createCustomerIdentityLinkStore({
        query: (sql) => {
          if (sql.startsWith('SELECT')) return Promise.resolve({ rows: [{ customer_id: 'cust-drifted', link_generation: 9 }] });
          writeAttempted = true;
          return Promise.resolve({ rows: [] });
        },
      });
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
        ledger,
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
      const store = createCustomerIdentityLinkStore({ query: () => Promise.reject(new Error('connection lost')) });
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
        emptyMap(),
      );
      assert(result.status === 'STORE_ERROR', 'a read failure must fail closed as STORE_ERROR');
    },
  },
  {
    id: 'XCID-12-AUDIT-WRITE-FAILURE-STILL-REPORTS-THE-REAL-APPLIED-STATE',
    run: async () => {
      const store = createCustomerIdentityLinkStore({
        query: (sql) => {
          if (sql.startsWith('SELECT')) return Promise.resolve({ rows: [{ customer_id: null, link_generation: 0 }] });
          if (sql.includes('INSERT INTO customer_identity_link_events')) throw new Error('simulated audit insert failure');
          return Promise.resolve({ rows: [{ customer_id: 'cust-1', link_generation: 1 }] });
        },
      });
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
        emptyMap(),
      );
      assert(
        result.status === 'AUDIT_WRITE_FAILED' && result.resultingRecord.generation === 1,
        'an audit-write failure must never be reported as a plain STORE_ERROR — the authoritative CAS update already succeeded and must be surfaced as such, with an explicit warning',
      );
    },
  },
  {
    id: 'XCID-13-GET-CURRENT-FOUND-NOT-FOUND-AND-STORE-ERROR',
    run: async () => {
      const found = await createCustomerIdentityLinkStore(fakeExecutor({ customer_id: 'cust-1', link_generation: 2 })).getCurrent(
        customerIdentityId,
        workspaceId,
      );
      assert(found.status === 'FOUND' && found.record.generation === 2, 'getCurrent must return the real current record when one exists');

      const notFound = await createCustomerIdentityLinkStore(fakeExecutor(null)).getCurrent(customerIdentityId, workspaceId);
      assert(notFound.status === 'NOT_FOUND', 'getCurrent must return NOT_FOUND for a missing row, never a fabricated default');

      const storeError = await createCustomerIdentityLinkStore({ query: () => Promise.reject(new Error('down')) }).getCurrent(
        customerIdentityId,
        workspaceId,
      );
      assert(storeError.status === 'STORE_ERROR', 'getCurrent must fail closed on a real read failure');
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
