import {
  evaluateSessionLinkCurrentness,
  resolveCommerceSessionLinkSnapshot,
  type CommercePrincipalId,
  type ExternalCommerceSessionLinkRef,
} from '../../packages/authz/src';
import { externalId, internalId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const principalId: CommercePrincipalId = internalId('xsess-principal-1', 'User');
const otherPrincipalId: CommercePrincipalId = internalId('xsess-principal-2', 'User');
const linkRef: ExternalCommerceSessionLinkRef = externalId('xsess-link-1', 'CommerceSessionLink');
const otherLinkRef: ExternalCommerceSessionLinkRef = externalId('xsess-link-2', 'CommerceSessionLink');

const cases: Array<{ id: string; run: () => void }> = [
  {
    id: 'XSESS-03-CURRENT-GENERATION-CLAIM-READY',
    run: () => {
      const state = { generation: 1, revoked: false };
      const snapshot = resolveCommerceSessionLinkSnapshot(principalId, linkRef, state);
      const result = evaluateSessionLinkCurrentness(snapshot.linkVersion, principalId, linkRef, state);
      assert(result.status === 'READY', 'a claim matching the current, non-revoked generation must be ready');
    },
  },
  {
    id: 'XSESS-03-STALE-GENERATION-AFTER-RELINK-DENIES',
    run: () => {
      const before = { generation: 1, revoked: false };
      const copiedClaim = resolveCommerceSessionLinkSnapshot(principalId, linkRef, before).linkVersion;
      const after = { generation: 2, revoked: false };
      const result = evaluateSessionLinkCurrentness(copiedClaim, principalId, linkRef, after);
      assert(
        result.status === 'DENIED' && result.reason === 'STALE_SESSION_LINK_REF',
        'a claim copied before a relink/rotation must deny as stale against the new generation, never silently re-validate',
      );
    },
  },
  {
    id: 'XSESS-03-REVOKED-DENIES-EVEN-WITH-OTHERWISE-MATCHING-CLAIM',
    run: () => {
      // Same generation number as a live link, but revoked: a cache/copy of this exact state must
      // still deny. This is the literal XSESS-03 requirement: revoke must beat a "permissive" copy.
      const revokedState = { generation: 3, revoked: true };
      const sameShapeClaim = resolveCommerceSessionLinkSnapshot(principalId, linkRef, revokedState).linkVersion;
      const result = evaluateSessionLinkCurrentness(sameShapeClaim, principalId, linkRef, revokedState);
      assert(
        result.status === 'DENIED' && result.reason === 'SESSION_LINK_REVOKED',
        'revocation denies unconditionally, not merely via a version mismatch that a lucky copy could pass',
      );
    },
  },
  {
    id: 'XSESS-03-UNRELATED-NOISE-DENIES-NOT-FALLS-BACK',
    run: () => {
      const state = { generation: 1, revoked: false };
      const claimFromWrongPrincipal = resolveCommerceSessionLinkSnapshot(otherPrincipalId, linkRef, state).linkVersion;
      const r1 = evaluateSessionLinkCurrentness(claimFromWrongPrincipal, principalId, linkRef, state);
      assert(r1.status === 'DENIED' && r1.reason === 'STALE_SESSION_LINK_REF', 'a claim scoped to a different principal must deny, not match by link ref alone');

      const claimFromWrongLink = resolveCommerceSessionLinkSnapshot(principalId, otherLinkRef, state).linkVersion;
      const r2 = evaluateSessionLinkCurrentness(claimFromWrongLink, principalId, linkRef, state);
      assert(r2.status === 'DENIED' && r2.reason === 'STALE_SESSION_LINK_REF', 'a claim scoped to a different external link ref must deny, not match by principal alone');
    },
  },
  {
    id: 'XSESS-03-SNAPSHOT-DERIVATION-IS-DETERMINISTIC-AND-SCOPE-SENSITIVE',
    run: () => {
      const state = { generation: 5, revoked: false };
      const a = resolveCommerceSessionLinkSnapshot(principalId, linkRef, state);
      const b = resolveCommerceSessionLinkSnapshot(principalId, linkRef, state);
      assert(a.linkVersion === b.linkVersion, 'identical scope and state must yield an identical linkVersion');

      const differentGeneration = resolveCommerceSessionLinkSnapshot(principalId, linkRef, { ...state, generation: 6 });
      assert(a.linkVersion !== differentGeneration.linkVersion, 'a generation change must change linkVersion');

      const differentRevoked = resolveCommerceSessionLinkSnapshot(principalId, linkRef, { ...state, revoked: true });
      assert(a.linkVersion !== differentRevoked.linkVersion, 'a revoked-state change must change linkVersion even at the same generation');
    },
  },
];

function main() {
  for (const testCase of cases) {
    testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} commerce session link scenarios`);
}

main();
