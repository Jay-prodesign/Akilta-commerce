import {
  evaluateWorkspaceContextCurrentness,
  resolveWorkspaceContextSnapshot,
  resolveWorkspaceContextSwitch,
  workspaceContextIdempotencyKey,
  type ContextPrincipalId,
  type WorkspaceContextIdempotencyKey,
  type WorkspaceContextState,
} from '../../packages/authz/src';
import { internalId, type MerchantWorkspaceId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const principalId: ContextPrincipalId = internalId('xsess-05-principal-1', 'User');
const otherPrincipalId: ContextPrincipalId = internalId('xsess-05-principal-2', 'User');
const workspaceA: MerchantWorkspaceId = internalId('xsess-05-workspace-a', 'MerchantWorkspace');
const workspaceB: MerchantWorkspaceId = internalId('xsess-05-workspace-b', 'MerchantWorkspace');

const cases: Array<{ id: string; run: () => void }> = [
  {
    id: 'XSESS-05-CURRENT-GENERATION-CLAIM-READY',
    run: () => {
      const state = { merchantWorkspaceId: workspaceA, generation: 1 };
      const snapshot = resolveWorkspaceContextSnapshot(principalId, state);
      const result = evaluateWorkspaceContextCurrentness(snapshot.contextVersion, principalId, state);
      assert(result.status === 'READY', 'a claim matching the current workspace and generation must be ready');
    },
  },
  {
    id: 'XSESS-05-STALE-CLAIM-CANNOT-ACT-IN-OLD-WORKSPACE-AFTER-SWITCH',
    run: () => {
      const before = { merchantWorkspaceId: workspaceA, generation: 1 };
      const copiedClaim = resolveWorkspaceContextSnapshot(principalId, before).contextVersion;
      const afterSwitch = { merchantWorkspaceId: workspaceB, generation: 2 };
      const result = evaluateWorkspaceContextCurrentness(copiedClaim, principalId, afterSwitch);
      assert(
        result.status === 'DENIED' && result.reason === 'STALE_WORKSPACE_CONTEXT_REF',
        'a claim copied from the old workspace must deny against the switched-to workspace, never silently re-validate',
      );
    },
  },
  {
    id: 'XSESS-05-STALE-CLAIM-CANNOT-ACT-IN-NEW-WORKSPACE-BY-COPYING-ID',
    run: () => {
      // The caller learns/guesses the new workspace id but presents a version derived before the
      // switch actually happened (wrong generation for that workspace): copying the ID alone must
      // not be sufficient to act in the new workspace.
      const guessedNewWorkspaceButStaleGeneration = { merchantWorkspaceId: workspaceB, generation: 1 };
      const forgedClaim = resolveWorkspaceContextSnapshot(principalId, guessedNewWorkspaceButStaleGeneration).contextVersion;
      const actualCurrent = { merchantWorkspaceId: workspaceB, generation: 2 };
      const result = evaluateWorkspaceContextCurrentness(forgedClaim, principalId, actualCurrent);
      assert(
        result.status === 'DENIED' && result.reason === 'STALE_WORKSPACE_CONTEXT_REF',
        'copying the new workspace id with a non-current generation must still deny',
      );
    },
  },
  {
    id: 'XSESS-05-SWITCH-BACK-TO-SAME-WORKSPACE-BUMPS-GENERATION',
    run: () => {
      // Switching A -> B -> A again must still invalidate a claim copied from the first visit to A,
      // because the workspace id alone (without the generation) is not evidence of currentness.
      const firstVisitToA = { merchantWorkspaceId: workspaceA, generation: 1 };
      const copiedClaim = resolveWorkspaceContextSnapshot(principalId, firstVisitToA).contextVersion;
      const secondVisitToA = { merchantWorkspaceId: workspaceA, generation: 3 };
      const result = evaluateWorkspaceContextCurrentness(copiedClaim, principalId, secondVisitToA);
      assert(
        result.status === 'DENIED' && result.reason === 'STALE_WORKSPACE_CONTEXT_REF',
        'a claim from an earlier visit to the same workspace must deny once the generation has moved on',
      );
    },
  },
  {
    id: 'XSESS-05-UNRELATED-PRINCIPAL-NOISE-DENIES-NOT-FALLS-BACK',
    run: () => {
      const state = { merchantWorkspaceId: workspaceA, generation: 1 };
      const claimFromWrongPrincipal = resolveWorkspaceContextSnapshot(otherPrincipalId, state).contextVersion;
      const result = evaluateWorkspaceContextCurrentness(claimFromWrongPrincipal, principalId, state);
      assert(
        result.status === 'DENIED' && result.reason === 'STALE_WORKSPACE_CONTEXT_REF',
        'a claim scoped to a different principal must deny, not match by workspace/generation alone',
      );
    },
  },
  {
    id: 'XSESS-05-SNAPSHOT-DERIVATION-IS-DETERMINISTIC-AND-SCOPE-SENSITIVE',
    run: () => {
      const state = { merchantWorkspaceId: workspaceA, generation: 5 };
      const a = resolveWorkspaceContextSnapshot(principalId, state);
      const b = resolveWorkspaceContextSnapshot(principalId, state);
      assert(a.contextVersion === b.contextVersion, 'identical scope and state must yield an identical contextVersion');

      const differentGeneration = resolveWorkspaceContextSnapshot(principalId, { ...state, generation: 6 });
      assert(a.contextVersion !== differentGeneration.contextVersion, 'a generation change must change contextVersion');

      const differentWorkspace = resolveWorkspaceContextSnapshot(principalId, { ...state, merchantWorkspaceId: workspaceB });
      assert(a.contextVersion !== differentWorkspace.contextVersion, 'a workspace change must change contextVersion even at the same generation');
    },
  },
  {
    id: 'XSESS-05-SWITCH-WITH-MATCHING-CAS-ADVANCES-GENERATION-BY-EXACTLY-ONE',
    run: () => {
      const noPriorApplications: ReadonlyMap<WorkspaceContextIdempotencyKey, WorkspaceContextState> = new Map();
      const current = { merchantWorkspaceId: workspaceA, generation: 1 };
      const result = resolveWorkspaceContextSwitch(
        {
          principalId,
          expectedGeneration: 1,
          targetMerchantWorkspaceId: workspaceB,
          idempotencyKey: workspaceContextIdempotencyKey('switch-op-1'),
        },
        current,
        noPriorApplications,
      );
      assert(
        result.status === 'APPLIED' && result.resultingState.generation === 2 && result.resultingState.merchantWorkspaceId === workspaceB,
        'a switch whose expectedGeneration matches current must apply, advancing the generation by exactly one and repointing to the new workspace',
      );
    },
  },
  {
    id: 'XSESS-05-SWITCH-BACK-TO-SAME-WORKSPACE-STILL-ADVANCES-GENERATION',
    run: () => {
      const noPriorApplications: ReadonlyMap<WorkspaceContextIdempotencyKey, WorkspaceContextState> = new Map();
      const current = { merchantWorkspaceId: workspaceA, generation: 2 };
      const result = resolveWorkspaceContextSwitch(
        {
          principalId,
          expectedGeneration: 2,
          targetMerchantWorkspaceId: workspaceA,
          idempotencyKey: workspaceContextIdempotencyKey('switch-op-2'),
        },
        current,
        noPriorApplications,
      );
      assert(
        result.status === 'APPLIED' && result.resultingState.generation === 3,
        'switching back to the same workspace id must still advance the generation — workspace id alone is never evidence of currentness',
      );
    },
  },
  {
    id: 'XSESS-05-CONCURRENT-COMPETING-SWITCHES-ONE-WINS-OTHER-CONFLICTS',
    run: () => {
      const noPriorApplications: ReadonlyMap<WorkspaceContextIdempotencyKey, WorkspaceContextState> = new Map();
      const base = { merchantWorkspaceId: workspaceA, generation: 1 };
      const first = resolveWorkspaceContextSwitch(
        {
          principalId,
          expectedGeneration: 1,
          targetMerchantWorkspaceId: workspaceB,
          idempotencyKey: workspaceContextIdempotencyKey('writer-a'),
        },
        base,
        noPriorApplications,
      );
      assert(first.status === 'APPLIED', 'the first writer against the then-current generation must succeed');

      const second = resolveWorkspaceContextSwitch(
        {
          principalId,
          expectedGeneration: 1,
          targetMerchantWorkspaceId: workspaceA,
          idempotencyKey: workspaceContextIdempotencyKey('writer-b'),
        },
        first.status === 'APPLIED' ? first.resultingState : base,
        noPriorApplications,
      );
      assert(
        second.status === 'CONFLICT' && second.reason === 'STALE_EXPECTED_GENERATION',
        'the losing concurrent writer must receive an explicit CONFLICT, never silently overwrite the winner',
      );
    },
  },
  {
    id: 'XSESS-05-RETRY-WITH-SAME-IDEMPOTENCY-KEY-REPLAYS-PRIOR-OUTCOME',
    run: () => {
      const key = workspaceContextIdempotencyKey('retry-key-1');
      const applied: WorkspaceContextState = { merchantWorkspaceId: workspaceB, generation: 2 };
      const ledger: ReadonlyMap<WorkspaceContextIdempotencyKey, WorkspaceContextState> = new Map([[key, applied]]);
      const driftedCurrent = { merchantWorkspaceId: workspaceB, generation: 9 };
      const retry = resolveWorkspaceContextSwitch(
        { principalId, expectedGeneration: 1, targetMerchantWorkspaceId: workspaceB, idempotencyKey: key },
        driftedCurrent,
        ledger,
      );
      assert(
        retry.status === 'ALREADY_APPLIED' && retry.resultingState.generation === 2,
        'a retried switch with a previously-applied idempotency key must replay the original outcome verbatim, never re-advance or re-evaluate against drifted current state',
      );
    },
  },
];

function main() {
  for (const testCase of cases) {
    testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} workspace context generation scenarios`);
}

main();
