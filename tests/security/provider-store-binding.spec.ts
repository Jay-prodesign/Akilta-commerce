import {
  authProviderKey,
  providerStoreBindingIdempotencyKey,
  resolveProviderStoreBindingTransition,
  type ProviderStoreBindingIdempotencyKey,
  type ProviderStoreBindingRecord,
  type ProviderStoreBindingRequest,
  type ExternalProviderStoreRef,
} from '../../packages/authz/src';
import { externalId, internalId, type MerchantWorkspaceId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const shopify = authProviderKey('shopify');
const otherProvider = authProviderKey('other-provider');
const storeRef: ExternalProviderStoreRef = externalId('shopify-store-1.myshopify.com', 'ProviderStore');
const otherStoreRef: ExternalProviderStoreRef = externalId('shopify-store-2.myshopify.com', 'ProviderStore');
const workspaceA: MerchantWorkspaceId = internalId('provider-binding-workspace-a', 'MerchantWorkspace');
const workspaceB: MerchantWorkspaceId = internalId('provider-binding-workspace-b', 'MerchantWorkspace');

const noPriorApplications: ReadonlyMap<ProviderStoreBindingIdempotencyKey, ProviderStoreBindingRecord> = new Map();

function bootstrapRequest(overrides: Partial<ProviderStoreBindingRequest> = {}): ProviderStoreBindingRequest {
  return {
    authProvider: shopify,
    externalStoreRef: storeRef,
    operation: 'BOOTSTRAP',
    expectedGeneration: 0,
    targetMerchantWorkspaceId: workspaceA,
    idempotencyKey: providerStoreBindingIdempotencyKey('op-1'),
    ...overrides,
  };
}

/** Builds a request with no `targetMerchantWorkspaceId` key at all (not merely set to undefined). */
function requestWithoutTarget(
  overrides: Partial<Omit<ProviderStoreBindingRequest, 'targetMerchantWorkspaceId'>> = {},
): ProviderStoreBindingRequest {
  const { targetMerchantWorkspaceId: _omit, ...base } = bootstrapRequest();
  return { ...base, ...overrides };
}

function liveRecord(generation = 1, merchantWorkspaceId: MerchantWorkspaceId = workspaceA): ProviderStoreBindingRecord {
  return {
    ownerAuthProvider: shopify,
    ownerExternalStoreRef: storeRef,
    state: { merchantWorkspaceId, generation, revoked: false },
  };
}

function revokedRecord(generation = 2, merchantWorkspaceId: MerchantWorkspaceId = workspaceA): ProviderStoreBindingRecord {
  return {
    ownerAuthProvider: shopify,
    ownerExternalStoreRef: storeRef,
    state: { merchantWorkspaceId, generation, revoked: true },
  };
}

const cases: Array<{ id: string; run: () => void }> = [
  {
    id: 'PSB-BOOTSTRAP-FIRST-INSTALL-APPLIES-AT-GENERATION-ONE',
    run: () => {
      const result = resolveProviderStoreBindingTransition(bootstrapRequest(), null, noPriorApplications);
      assert(
        result.status === 'APPLIED' &&
          result.resultingRecord.state.generation === 1 &&
          result.resultingRecord.state.merchantWorkspaceId === workspaceA &&
          result.resultingRecord.state.revoked === false,
        'a first-ever bootstrap against no existing record must apply at generation 1, bound exactly to the given target workspace',
      );
    },
  },
  {
    id: 'PSB-BOOTSTRAP-WITH-NONZERO-EXPECTED-GENERATION-AGAINST-NO-RECORD-CONFLICTS',
    run: () => {
      const result = resolveProviderStoreBindingTransition(
        bootstrapRequest({ expectedGeneration: 1 }),
        null,
        noPriorApplications,
      );
      assert(
        result.status === 'CONFLICT' && result.reason === 'STALE_EXPECTED_GENERATION',
        'a bootstrap that assumes a prior generation against a scope with no record yet must fail closed as CONFLICT, not silently succeed',
      );
    },
  },
  {
    id: 'PSB-BOOTSTRAP-MISSING-TARGET-WORKSPACE-DENIES',
    run: () => {
      const result = resolveProviderStoreBindingTransition(
        requestWithoutTarget(),
        null,
        noPriorApplications,
      );
      assert(
        result.status === 'DENIED' && result.reason === 'MISSING_TARGET_WORKSPACE',
        'a bootstrap with no explicit target workspace must deny — this function never infers one',
      );
    },
  },
  {
    id: 'PSB-NON-BOOTSTRAP-AGAINST-NO-RECORD-DENIES-NO-EXISTING-BINDING',
    run: () => {
      const result = resolveProviderStoreBindingTransition(
        bootstrapRequest({ operation: 'TRANSFER', targetMerchantWorkspaceId: workspaceB }),
        null,
        noPriorApplications,
      );
      assert(
        result.status === 'DENIED' && result.reason === 'NO_EXISTING_BINDING',
        'TRANSFER/UNINSTALL/REINSTALL against a scope with no record at all must deny, never be treated as an implicit bootstrap',
      );
    },
  },
  {
    id: 'PSB-BOOTSTRAP-OVER-EXISTING-LIVE-BINDING-DENIES-ALREADY-BOUND',
    run: () => {
      const result = resolveProviderStoreBindingTransition(
        bootstrapRequest({ expectedGeneration: 1 }),
        liveRecord(1),
        noPriorApplications,
      );
      assert(
        result.status === 'DENIED' && result.reason === 'ALREADY_BOUND',
        'bootstrapping over an already-bound scope must deny — TRANSFER is the correct operation for an existing binding',
      );
    },
  },
  {
    id: 'PSB-TRANSFER-TO-NEW-WORKSPACE-ADVANCES-GENERATION-AND-REPOINTS',
    run: () => {
      const result = resolveProviderStoreBindingTransition(
        bootstrapRequest({ operation: 'TRANSFER', expectedGeneration: 1, targetMerchantWorkspaceId: workspaceB }),
        liveRecord(1, workspaceA),
        noPriorApplications,
      );
      assert(
        result.status === 'APPLIED' &&
          result.resultingRecord.state.generation === 2 &&
          result.resultingRecord.state.merchantWorkspaceId === workspaceB,
        'a matching-CAS transfer must advance the generation by exactly one and repoint to the new target workspace',
      );
    },
  },
  {
    id: 'PSB-TRANSFER-MISSING-TARGET-WORKSPACE-DENIES',
    run: () => {
      const result = resolveProviderStoreBindingTransition(
        requestWithoutTarget({ operation: 'TRANSFER', expectedGeneration: 1 }),
        liveRecord(1),
        noPriorApplications,
      );
      assert(
        result.status === 'DENIED' && result.reason === 'MISSING_TARGET_WORKSPACE',
        'a transfer with no explicit target workspace must deny',
      );
    },
  },
  {
    id: 'PSB-CONCURRENT-COMPETING-TRANSFERS-ONE-WINS-OTHER-CONFLICTS',
    run: () => {
      const base = liveRecord(1, workspaceA);
      const first = resolveProviderStoreBindingTransition(
        bootstrapRequest({
          operation: 'TRANSFER',
          expectedGeneration: 1,
          targetMerchantWorkspaceId: workspaceB,
          idempotencyKey: providerStoreBindingIdempotencyKey('writer-a'),
        }),
        base,
        noPriorApplications,
      );
      assert(first.status === 'APPLIED', 'the first writer against the then-current generation must succeed');

      const second = resolveProviderStoreBindingTransition(
        bootstrapRequest({
          operation: 'TRANSFER',
          expectedGeneration: 1,
          targetMerchantWorkspaceId: workspaceA,
          idempotencyKey: providerStoreBindingIdempotencyKey('writer-b'),
        }),
        first.status === 'APPLIED' ? first.resultingRecord : base,
        noPriorApplications,
      );
      assert(
        second.status === 'CONFLICT' && second.reason === 'STALE_EXPECTED_GENERATION',
        'the losing concurrent writer must receive an explicit CONFLICT, never silently overwrite the winner',
      );
    },
  },
  {
    id: 'PSB-UNINSTALL-SETS-REVOKED-AND-PRESERVES-WORKSPACE-ID',
    run: () => {
      const result = resolveProviderStoreBindingTransition(
        requestWithoutTarget({ operation: 'UNINSTALL', expectedGeneration: 1 }),
        liveRecord(1, workspaceA),
        noPriorApplications,
      );
      assert(
        result.status === 'APPLIED' &&
          result.resultingRecord.state.revoked === true &&
          result.resultingRecord.state.generation === 2 &&
          result.resultingRecord.state.merchantWorkspaceId === workspaceA,
        'UNINSTALL must advance the generation, set revoked true, and preserve the underlying workspace id rather than discarding it',
      );
    },
  },
  {
    id: 'PSB-TRANSFER-ON-REVOKED-SCOPE-DENIES-ALREADY-REVOKED',
    run: () => {
      const result = resolveProviderStoreBindingTransition(
        bootstrapRequest({ operation: 'TRANSFER', expectedGeneration: 2, targetMerchantWorkspaceId: workspaceB }),
        revokedRecord(2),
        noPriorApplications,
      );
      assert(
        result.status === 'DENIED' && result.reason === 'ALREADY_REVOKED',
        'TRANSFER on a revoked scope must deny even with a technically-correct CAS precondition — revocation is sticky',
      );
    },
  },
  {
    id: 'PSB-UNINSTALL-ON-ALREADY-REVOKED-SCOPE-DENIES-ALREADY-REVOKED',
    run: () => {
      const result = resolveProviderStoreBindingTransition(
        requestWithoutTarget({ operation: 'UNINSTALL', expectedGeneration: 2 }),
        revokedRecord(2),
        noPriorApplications,
      );
      assert(
        result.status === 'DENIED' && result.reason === 'ALREADY_REVOKED',
        'a duplicate UNINSTALL on an already-revoked scope must deny, not silently no-op as success',
      );
    },
  },
  {
    id: 'PSB-REINSTALL-ON-REVOKED-WITH-CORRECT-CAS-APPLIES-NEW-GENERATION',
    run: () => {
      const result = resolveProviderStoreBindingTransition(
        bootstrapRequest({ operation: 'REINSTALL', expectedGeneration: 2, targetMerchantWorkspaceId: workspaceA }),
        revokedRecord(2, workspaceA),
        noPriorApplications,
      );
      assert(
        result.status === 'APPLIED' &&
          result.resultingRecord.state.generation === 3 &&
          result.resultingRecord.state.revoked === false,
        'REINSTALL is the one explicit, CAS-gated operation allowed to revive a revoked scope, and must advance the generation',
      );
    },
  },
  {
    id: 'PSB-REINSTALL-CAN-REPOINT-TO-A-DIFFERENT-WORKSPACE-ON-OWNERSHIP-CHANGE',
    run: () => {
      const result = resolveProviderStoreBindingTransition(
        bootstrapRequest({ operation: 'REINSTALL', expectedGeneration: 2, targetMerchantWorkspaceId: workspaceB }),
        revokedRecord(2, workspaceA),
        noPriorApplications,
      );
      assert(
        result.status === 'APPLIED' && result.resultingRecord.state.merchantWorkspaceId === workspaceB,
        'REINSTALL must support explicitly repointing to a new workspace, not just silently restoring the old one — it is a deliberate re-bind, not an undo',
      );
    },
  },
  {
    id: 'PSB-REINSTALL-WITH-STALE-CAS-CONFLICTS-NOT-APPLIED',
    run: () => {
      const result = resolveProviderStoreBindingTransition(
        bootstrapRequest({ operation: 'REINSTALL', expectedGeneration: 1, targetMerchantWorkspaceId: workspaceA }),
        revokedRecord(2, workspaceA),
        noPriorApplications,
      );
      assert(
        result.status === 'CONFLICT' && result.reason === 'STALE_EXPECTED_GENERATION',
        'a duplicate/delayed REINSTALL attempt with a stale CAS precondition must fail closed as CONFLICT',
      );
    },
  },
  {
    id: 'PSB-REINSTALL-ON-A-LIVE-NOT-REVOKED-SCOPE-DENIES-NOT-REVOKED',
    run: () => {
      const result = resolveProviderStoreBindingTransition(
        bootstrapRequest({ operation: 'REINSTALL', expectedGeneration: 1, targetMerchantWorkspaceId: workspaceA }),
        liveRecord(1),
        noPriorApplications,
      );
      assert(
        result.status === 'DENIED' && result.reason === 'NOT_REVOKED',
        'REINSTALL only makes sense against a revoked scope; against a live binding it must deny, not silently bump the generation',
      );
    },
  },
  {
    id: 'PSB-SCOPE-MISMATCH-ON-WRONG-PROVIDER-DENIES',
    run: () => {
      const result = resolveProviderStoreBindingTransition(
        bootstrapRequest({ authProvider: otherProvider, operation: 'TRANSFER', expectedGeneration: 1, targetMerchantWorkspaceId: workspaceB }),
        liveRecord(1),
        noPriorApplications,
      );
      assert(
        result.status === 'DENIED' && result.reason === 'SCOPE_MISMATCH',
        'a request scoped to a different auth provider than the record it is evaluated against must deny',
      );
    },
  },
  {
    id: 'PSB-SCOPE-MISMATCH-ON-WRONG-STORE-REF-DENIES-NOT-CROSS-STORE-LEAKAGE',
    run: () => {
      const result = resolveProviderStoreBindingTransition(
        bootstrapRequest({ externalStoreRef: otherStoreRef, operation: 'TRANSFER', expectedGeneration: 1, targetMerchantWorkspaceId: workspaceB }),
        liveRecord(1),
        noPriorApplications,
      );
      assert(
        result.status === 'DENIED' && result.reason === 'SCOPE_MISMATCH',
        'a request scoped to a different store ref must deny — two stores must never share or cross-affect each other\'s binding record',
      );
    },
  },
  {
    id: 'PSB-RETRY-WITH-SAME-IDEMPOTENCY-KEY-REPLAYS-PRIOR-OUTCOME-NOT-A-SECOND-ADVANCE',
    run: () => {
      const key = providerStoreBindingIdempotencyKey('retry-key-1');
      const applied: ProviderStoreBindingRecord = {
        ownerAuthProvider: shopify,
        ownerExternalStoreRef: storeRef,
        state: { merchantWorkspaceId: workspaceB, generation: 2, revoked: false },
      };
      const ledgerAfterFirstApply: ReadonlyMap<ProviderStoreBindingIdempotencyKey, ProviderStoreBindingRecord> = new Map([
        [key, applied],
      ]);
      const driftedCurrent = liveRecord(5, workspaceB);
      const retry = resolveProviderStoreBindingTransition(
        bootstrapRequest({ operation: 'TRANSFER', expectedGeneration: 1, targetMerchantWorkspaceId: workspaceB, idempotencyKey: key }),
        driftedCurrent,
        ledgerAfterFirstApply,
      );
      assert(
        retry.status === 'ALREADY_APPLIED' && retry.resultingRecord.state.generation === 2,
        'a retried request with a previously-applied idempotency key must replay the original outcome verbatim, never re-advance or re-evaluate against drifted current state',
      );
    },
  },
];

function main() {
  for (const testCase of cases) {
    testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} provider store binding scenarios`);
}

main();
