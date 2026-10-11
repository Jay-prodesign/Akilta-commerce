import {
  evaluateWorkspaceContextCurrentness,
  resolveWorkspaceContextSnapshot,
  type ContextPrincipalId,
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
];

function main() {
  for (const testCase of cases) {
    testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} workspace context generation scenarios`);
}

main();
