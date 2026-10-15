import {
  customerIdentityLinkIdempotencyKey,
  resolveCustomerIdentityLinkTransition,
  type CustomerIdentityLinkIdempotencyKey,
  type CustomerIdentityLinkRecord,
  type CustomerIdentityLinkRequest,
} from '../../packages/authz/src';
import { internalId, type MerchantWorkspaceId } from '../../packages/domain/src';
import type { CustomerId, CustomerIdentityId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const identityId: CustomerIdentityId = internalId('xcid-identity-1', 'CustomerIdentity');
const otherIdentityId: CustomerIdentityId = internalId('xcid-identity-2', 'CustomerIdentity');
const workspaceId: MerchantWorkspaceId = internalId('xcid-workspace-1', 'MerchantWorkspace');
const otherWorkspaceId: MerchantWorkspaceId = internalId('xcid-workspace-2', 'MerchantWorkspace');
const customerId: CustomerId = internalId('xcid-customer-1', 'Customer');
const otherCustomerId: CustomerId = internalId('xcid-customer-2', 'Customer');

const noPriorApplications: ReadonlyMap<CustomerIdentityLinkIdempotencyKey, CustomerIdentityLinkRecord> = new Map();

function record(customerIdOverride: CustomerId | undefined, generation = 0): CustomerIdentityLinkRecord {
  return {
    ownerCustomerIdentityId: identityId,
    ownerMerchantWorkspaceId: workspaceId,
    ...(customerIdOverride !== undefined ? { customerId: customerIdOverride } : {}),
    generation,
  };
}

function request(overrides: Partial<CustomerIdentityLinkRequest> = {}): CustomerIdentityLinkRequest {
  return {
    customerIdentityId: identityId,
    merchantWorkspaceId: workspaceId,
    operation: 'LINK',
    targetCustomerId: customerId,
    expectedGeneration: 0,
    idempotencyKey: customerIdentityLinkIdempotencyKey('xcid-op-1'),
    ...overrides,
  };
}

function requestWithoutTarget(
  overrides: Partial<Omit<CustomerIdentityLinkRequest, 'targetCustomerId'>> = {},
): CustomerIdentityLinkRequest {
  return {
    customerIdentityId: identityId,
    merchantWorkspaceId: workspaceId,
    operation: 'LINK',
    expectedGeneration: 0,
    idempotencyKey: customerIdentityLinkIdempotencyKey('xcid-op-1'),
    ...overrides,
  };
}

const cases: Array<{ id: string; run: () => void }> = [
  {
    id: 'XCID-01-LINK-ANONYMOUS-TO-KNOWN-CUSTOMER-APPLIES',
    run: () => {
      const result = resolveCustomerIdentityLinkTransition(request(), record(undefined, 0), noPriorApplications);
      assert(
        result.status === 'APPLIED' && result.resultingRecord.customerId === customerId && result.resultingRecord.generation === 1,
        'LINK against a currently-unlinked identity must apply and advance the generation by exactly one',
      );
    },
  },
  {
    id: 'XCID-02-LINK-OVER-AN-EXISTING-LINK-DENIES-ALREADY-LINKED-NOT-A-SILENT-MERGE',
    run: () => {
      const result = resolveCustomerIdentityLinkTransition(request(), record(otherCustomerId, 0), noPriorApplications);
      assert(
        result.status === 'DENIED' && result.reason === 'ALREADY_LINKED',
        'LINK must never silently overwrite an already-linked identity — a best-guess similarity match cannot merge through this entry point',
      );
    },
  },
  {
    id: 'XCID-03-RELINK-TO-A-DIFFERENT-CUSTOMER-APPLIES-AS-AN-EXPLICIT-CORRECTION',
    run: () => {
      const result = resolveCustomerIdentityLinkTransition(
        request({ operation: 'RELINK', targetCustomerId: otherCustomerId, expectedGeneration: 1 }),
        record(customerId, 1),
        noPriorApplications,
      );
      assert(
        result.status === 'APPLIED' && result.resultingRecord.customerId === otherCustomerId && result.resultingRecord.generation === 2,
        'RELINK must be the explicit, separately-audited correction path and must apply when currently linked',
      );
    },
  },
  {
    id: 'XCID-04-RELINK-WHEN-NOT-LINKED-DENIES-NOT-LINKED',
    run: () => {
      const result = resolveCustomerIdentityLinkTransition(
        request({ operation: 'RELINK', targetCustomerId: customerId }),
        record(undefined, 0),
        noPriorApplications,
      );
      assert(
        result.status === 'DENIED' && result.reason === 'NOT_LINKED',
        'RELINK against a currently-unlinked identity must deny — LINK is the correct operation for a first-time link',
      );
    },
  },
  {
    id: 'XCID-05-UNLINK-REVERSES-AN-EXISTING-LINK',
    run: () => {
      const result = resolveCustomerIdentityLinkTransition(
        request({ operation: 'UNLINK', expectedGeneration: 1 }),
        record(customerId, 1),
        noPriorApplications,
      );
      assert(
        result.status === 'APPLIED' && result.resultingRecord.customerId === undefined && result.resultingRecord.generation === 2,
        'UNLINK must clear the customerId pointer and advance the generation — this is the reversibility half of reversible lineage',
      );
    },
  },
  {
    id: 'XCID-06-UNLINK-WHEN-ALREADY-UNLINKED-DENIES-NOT-LINKED',
    run: () => {
      const result = resolveCustomerIdentityLinkTransition(
        request({ operation: 'UNLINK' }),
        record(undefined, 0),
        noPriorApplications,
      );
      assert(result.status === 'DENIED' && result.reason === 'NOT_LINKED', 'UNLINK against an already-unlinked identity must deny');
    },
  },
  {
    id: 'XCID-07-LINK-WITHOUT-A-TARGET-CUSTOMER-DENIES-MISSING-TARGET-CUSTOMER',
    run: () => {
      const result = resolveCustomerIdentityLinkTransition(
        requestWithoutTarget(),
        record(undefined, 0),
        noPriorApplications,
      );
      assert(
        result.status === 'DENIED' && result.reason === 'MISSING_TARGET_CUSTOMER',
        'LINK must require an explicit target customer id',
      );
    },
  },
  {
    id: 'XCID-08-A-REVERSAL-CAN-RESTORE-A-PRIOR-CUSTOMER-VIA-RELINK',
    run: () => {
      // Demonstrates "reversible": unlink then relink back to the original customer is a normal,
      // equally CAS-gated operation — no special "undo" primitive is needed.
      const unlinked = resolveCustomerIdentityLinkTransition(
        request({ operation: 'UNLINK', expectedGeneration: 0, idempotencyKey: customerIdentityLinkIdempotencyKey('undo-step-1') }),
        record(customerId, 0),
        noPriorApplications,
      );
      assert(unlinked.status === 'APPLIED', 'the unlink step of a reversal must apply');
      const relinked = resolveCustomerIdentityLinkTransition(
        request({ operation: 'LINK', targetCustomerId: customerId, expectedGeneration: 1, idempotencyKey: customerIdentityLinkIdempotencyKey('undo-step-2') }),
        unlinked.status === 'APPLIED' ? unlinked.resultingRecord : record(customerId, 0),
        noPriorApplications,
      );
      assert(
        relinked.status === 'APPLIED' && relinked.resultingRecord.customerId === customerId && relinked.resultingRecord.generation === 2,
        'relinking back to the original customer id after an unlink must succeed as an ordinary CAS-gated operation',
      );
    },
  },
  {
    id: 'XCID-09-CONCURRENT-COMPETING-RELINKS-ONE-WINS-OTHER-CONFLICTS',
    run: () => {
      const base = record(customerId, 0);
      const first = resolveCustomerIdentityLinkTransition(
        request({ operation: 'RELINK', targetCustomerId: otherCustomerId, idempotencyKey: customerIdentityLinkIdempotencyKey('writer-a') }),
        base,
        noPriorApplications,
      );
      assert(first.status === 'APPLIED', 'the first writer against the then-current generation must succeed');

      const second = resolveCustomerIdentityLinkTransition(
        request({ operation: 'RELINK', targetCustomerId: customerId, expectedGeneration: 0, idempotencyKey: customerIdentityLinkIdempotencyKey('writer-b') }),
        first.status === 'APPLIED' ? first.resultingRecord : base,
        noPriorApplications,
      );
      assert(
        second.status === 'CONFLICT' && second.reason === 'STALE_EXPECTED_GENERATION',
        'the losing concurrent writer must receive an explicit CONFLICT against the now-stale base record, never silently overwrite the winner',
      );
    },
  },
  {
    id: 'XCID-10-RETRY-WITH-SAME-IDEMPOTENCY-KEY-REPLAYS-PRIOR-OUTCOME',
    run: () => {
      const key = customerIdentityLinkIdempotencyKey('retry-key-1');
      const applied: CustomerIdentityLinkRecord = {
        ownerCustomerIdentityId: identityId,
        ownerMerchantWorkspaceId: workspaceId,
        customerId,
        generation: 1,
      };
      const ledger: ReadonlyMap<CustomerIdentityLinkIdempotencyKey, CustomerIdentityLinkRecord> = new Map([[key, applied]]);
      const driftedCurrent = record(otherCustomerId, 9);
      const retry = resolveCustomerIdentityLinkTransition(
        request({ expectedGeneration: 0, idempotencyKey: key }),
        driftedCurrent,
        ledger,
      );
      assert(
        retry.status === 'ALREADY_APPLIED' && retry.resultingRecord.customerId === customerId && retry.resultingRecord.generation === 1,
        'a retried request with a previously-applied idempotency key must replay the original outcome verbatim, even against a drifted current record',
      );
    },
  },
  {
    id: 'XCID-11-SCOPE-MISMATCH-ON-WRONG-IDENTITY-DENIES-FAIL-CLOSED',
    run: () => {
      const result = resolveCustomerIdentityLinkTransition(
        request({ customerIdentityId: otherIdentityId }),
        record(undefined, 0),
        noPriorApplications,
      );
      assert(result.status === 'DENIED' && result.reason === 'SCOPE_MISMATCH', 'a request scoped to a different identity must deny');
    },
  },
  {
    id: 'XCID-12-SCOPE-MISMATCH-ON-WRONG-WORKSPACE-DENIES-CROSS-TENANT-FAIL-CLOSED',
    run: () => {
      const result = resolveCustomerIdentityLinkTransition(
        request({ merchantWorkspaceId: otherWorkspaceId }),
        record(undefined, 0),
        noPriorApplications,
      );
      assert(
        result.status === 'DENIED' && result.reason === 'SCOPE_MISMATCH',
        'a request scoped to a different workspace must deny — cross-tenant linking fails closed',
      );
    },
  },
  {
    id: 'XCID-13-STALE-EXPECTED-GENERATION-ON-OTHERWISE-VALID-RELINK-CONFLICTS',
    run: () => {
      const result = resolveCustomerIdentityLinkTransition(
        request({ operation: 'RELINK', targetCustomerId: otherCustomerId, expectedGeneration: 0 }),
        record(customerId, 3),
        noPriorApplications,
      );
      assert(
        result.status === 'CONFLICT' && result.reason === 'STALE_EXPECTED_GENERATION',
        'a valid operation with a stale expectedGeneration must still fail closed as CONFLICT',
      );
    },
  },
  {
    id: 'XCID-14-RELINK-TO-THE-SAME-CUSTOMER-STILL-ADVANCES-GENERATION',
    run: () => {
      const result = resolveCustomerIdentityLinkTransition(
        request({ operation: 'RELINK', targetCustomerId: customerId, expectedGeneration: 1 }),
        record(customerId, 1),
        noPriorApplications,
      );
      assert(
        result.status === 'APPLIED' && result.resultingRecord.customerId === customerId && result.resultingRecord.generation === 2,
        'a RELINK confirming the same customer id must still advance the generation — the lineage event itself is what is recorded',
      );
    },
  },
];

function main() {
  for (const testCase of cases) {
    testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} customer identity link transition scenarios`);
}

main();
