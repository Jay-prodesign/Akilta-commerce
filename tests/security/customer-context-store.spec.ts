import { createCustomerContextStore, type CustomerContextQueryExecutor } from '../../apps/api/src/customer-context-store';
import { internalId, type CustomerId, type MerchantWorkspaceId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const customerId: CustomerId = internalId('cust-ctx-1', 'Customer');
const workspaceId: MerchantWorkspaceId = internalId('cust-ctx-ws-1', 'MerchantWorkspace');

function executor(
  customerRows: readonly Record<string, unknown>[],
  identityRows: readonly Record<string, unknown>[] = [],
): CustomerContextQueryExecutor {
  return {
    query: (sql) => {
      if (sql.startsWith('SELECT customer_id')) return Promise.resolve({ rows: customerRows });
      return Promise.resolve({ rows: identityRows });
    },
  };
}

const cases: ReadonlyArray<{ readonly id: string; readonly run: () => Promise<void> }> = [
  {
    id: 'CCTX-01-FOUND-CUSTOMER-WITH-IDENTITIES-MAPS-CORRECTLY',
    run: async () => {
      const store = createCustomerContextStore(
        executor(
          [{ customer_id: 'cust-ctx-1', safe_display_name: 'A. Merchant Customer', status: 'ACTIVE' }],
          [
            { channel_type: 'whatsapp', verification_level: 'CV2', verification_expires_at: '2026-12-01T00:00:00.000Z', status: 'ACTIVE' },
            { channel_type: 'web', verification_level: 'CV0', verification_expires_at: null, status: 'ACTIVE' },
          ],
        ),
      );
      const result = await store.readContext(customerId, workspaceId);
      assert(result.status === 'FOUND', 'a customer with rows must be found');
      assert(
        result.status === 'FOUND' &&
          result.context.safeDisplayName === 'A. Merchant Customer' &&
          result.context.identities.length === 2 &&
          result.context.identities[0]!.verificationLevel === 'CV2' &&
          result.context.identities[0]!.verificationExpiresAt !== undefined &&
          result.context.identities[1]!.verificationExpiresAt === undefined,
        'the customer record and both identities must map with their real fields, including an absent expiry staying absent (never a fabricated date)',
      );
    },
  },
  {
    id: 'CCTX-02-NEVER-EXPOSES-RAW-IDENTIFIER-OR-EVIDENCE-FIELDS',
    run: async () => {
      const store = createCustomerContextStore(
        executor(
          [{ customer_id: 'cust-ctx-1', safe_display_name: 'A', status: 'ACTIVE' }],
          [
            {
              channel_type: 'whatsapp',
              verification_level: 'CV1',
              verification_expires_at: null,
              status: 'ACTIVE',
              normalized_identifier_ref: '+15551234567',
              match_evidence_ref: 'secret-evidence-blob',
            },
          ],
        ),
      );
      const result = await store.readContext(customerId, workspaceId);
      assert(result.status === 'FOUND', 'sanity: the read must succeed');
      const identity = result.status === 'FOUND' ? result.context.identities[0] : undefined;
      assert(
        identity !== undefined && !('normalizedIdentifierRef' in identity) && !('matchEvidenceRef' in identity),
        'the adapter must only ever project channelType/verificationLevel/verificationExpiresAt/status, never raw identifier or evidence-ref fields, even if the row carries them',
      );
    },
  },
  {
    id: 'CCTX-03-NOT-FOUND-WHEN-NO-CUSTOMER-ROW',
    run: async () => {
      const store = createCustomerContextStore(executor([]));
      const result = await store.readContext(customerId, workspaceId);
      assert(result.status === 'NOT_FOUND', 'a missing customer row must be NOT_FOUND, never a fabricated empty context');
    },
  },
  {
    id: 'CCTX-04-READ-FAILURE-RETURNS-STORE-ERROR',
    run: async () => {
      const store = createCustomerContextStore({ query: () => Promise.reject(new Error('connection lost')) });
      const result = await store.readContext(customerId, workspaceId);
      assert(result.status === 'STORE_ERROR', 'a query failure must fail closed as STORE_ERROR');
    },
  },
  {
    id: 'CCTX-06-VERIFICATION-EXPIRES-AT-AS-A-DATE-OBJECT-IS-NOT-SILENTLY-DROPPED',
    run: async () => {
      // A real `pg` driver parses timestamptz columns into native Date instances, not strings.
      const store = createCustomerContextStore(
        executor(
          [{ customer_id: 'cust-ctx-1', safe_display_name: 'A', status: 'ACTIVE' }],
          [{ channel_type: 'whatsapp', verification_level: 'CV2', verification_expires_at: new Date('2026-12-01T00:00:00.000Z'), status: 'ACTIVE' }],
        ),
      );
      const result = await store.readContext(customerId, workspaceId);
      assert(
        result.status === 'FOUND' && result.context.identities[0]!.verificationExpiresAt === '2026-12-01T00:00:00.000Z',
        'a real Date-typed verification_expires_at column value must map to a real expiry, never be silently dropped as if absent',
      );
    },
  },
  {
    id: 'CCTX-05-CUSTOMER-WITH-NO-IDENTITIES-STILL-FOUND-WITH-EMPTY-ARRAY',
    run: async () => {
      const store = createCustomerContextStore(executor([{ customer_id: 'cust-ctx-1', safe_display_name: null, status: 'ACTIVE' }], []));
      const result = await store.readContext(customerId, workspaceId);
      assert(
        result.status === 'FOUND' && result.context.identities.length === 0 && result.context.safeDisplayName === undefined,
        'zero identity rows and a null display name must map to a real empty array/absent field, never an error',
      );
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} customer context store (adapter) scenarios`);
}

void main();
