import {
  resolveSessionLinkTransition,
  sessionLinkIdempotencyKey,
  type SessionLinkAuthoritativeRecord,
  type SessionLinkIdempotencyKey,
  type SessionLinkTransitionRequest,
} from '../../packages/authz/src';
import { externalId, internalId } from '../../packages/domain/src';
import type { CommercePrincipalId, ExternalCommerceSessionLinkRef } from '../../packages/authz/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const principalId: CommercePrincipalId = internalId('xsess-06-principal-1', 'User');
const otherPrincipalId: CommercePrincipalId = internalId('xsess-06-principal-2', 'User');
const linkRef: ExternalCommerceSessionLinkRef = externalId('xsess-06-link-1', 'CommerceSessionLink');
const otherLinkRef: ExternalCommerceSessionLinkRef = externalId('xsess-06-link-2', 'CommerceSessionLink');

const noPriorApplications: ReadonlyMap<SessionLinkIdempotencyKey, SessionLinkAuthoritativeRecord> = new Map();

function freshRecord(generation = 1, revoked = false): SessionLinkAuthoritativeRecord {
  return {
    ownerPrincipalId: principalId,
    ownerLinkRef: linkRef,
    state: { generation, revoked },
  };
}

function relinkRequest(
  overrides: Partial<SessionLinkTransitionRequest> = {},
): SessionLinkTransitionRequest {
  return {
    principalId,
    linkRef,
    operation: 'RELINK',
    expectedGeneration: 1,
    idempotencyKey: sessionLinkIdempotencyKey('xsess-06-op-1'),
    ...overrides,
  };
}

const cases: Array<{ id: string; run: () => void }> = [
  {
    id: 'XSESS-06-MATCHING-CAS-APPLIES-AND-ADVANCES-GENERATION-BY-EXACTLY-ONE',
    run: () => {
      const result = resolveSessionLinkTransition(relinkRequest(), freshRecord(1), noPriorApplications);
      assert(result.status === 'APPLIED', 'a request whose expectedGeneration matches current must be applied');
      assert(
        result.status === 'APPLIED' && result.resultingRecord.state.generation === 2,
        'a successful transition must advance the generation by exactly one, never more',
      );
    },
  },
  {
    id: 'XSESS-06-CONCURRENT-COMPETING-WRITERS-ONE-WINS-OTHER-GETS-EXPLICIT-CONFLICT',
    run: () => {
      // Two concurrent RELINK attempts both read generation 1 before either commits.
      const first = resolveSessionLinkTransition(
        relinkRequest({ idempotencyKey: sessionLinkIdempotencyKey('writer-a') }),
        freshRecord(1),
        noPriorApplications,
      );
      assert(first.status === 'APPLIED', 'the first writer to commit against the then-current generation must succeed');
      assert(
        first.status === 'APPLIED' && first.resultingRecord.state.generation === 2,
        'the first writer must advance the generation by exactly one',
      );

      // The second writer's CAS precondition was read before the first committed, so it is now stale.
      const second = resolveSessionLinkTransition(
        relinkRequest({ idempotencyKey: sessionLinkIdempotencyKey('writer-b'), expectedGeneration: 1 }),
        first.status === 'APPLIED' ? first.resultingRecord : freshRecord(),
        noPriorApplications,
      );
      assert(
        second.status === 'CONFLICT' && second.reason === 'STALE_EXPECTED_GENERATION',
        'the losing concurrent writer must receive an explicit CONFLICT, never be silently applied or silently dropped',
      );
    },
  },
  {
    id: 'XSESS-06-RETRY-WITH-SAME-IDEMPOTENCY-KEY-REPLAYS-PRIOR-OUTCOME-NOT-A-SECOND-ADVANCE',
    run: () => {
      const key = sessionLinkIdempotencyKey('retry-key-1');
      const applied: SessionLinkAuthoritativeRecord = {
        ownerPrincipalId: principalId,
        ownerLinkRef: linkRef,
        state: { generation: 2, revoked: false },
      };
      const ledgerAfterFirstApply: ReadonlyMap<SessionLinkIdempotencyKey, SessionLinkAuthoritativeRecord> = new Map([
        [key, applied],
      ]);
      // The retry arrives after the record has moved further still (e.g. a later unrelated op) —
      // replay must still return the ORIGINAL applied outcome, not reconsider against current state.
      const driftedCurrent: SessionLinkAuthoritativeRecord = {
        ownerPrincipalId: principalId,
        ownerLinkRef: linkRef,
        state: { generation: 5, revoked: false },
      };
      const retry = resolveSessionLinkTransition(
        relinkRequest({ idempotencyKey: key, expectedGeneration: 1 }),
        driftedCurrent,
        ledgerAfterFirstApply,
      );
      assert(
        retry.status === 'ALREADY_APPLIED' && retry.resultingRecord.state.generation === 2,
        'a retried request with a previously-applied idempotency key must replay the original outcome verbatim, never re-advance or re-evaluate against drifted current state',
      );
    },
  },
  {
    id: 'XSESS-06-REVOCATION-IS-NOT-REVERSED-BY-A-DELAYED-OPERATION-WITH-CORRECT-CAS',
    run: () => {
      const revokedRecord: SessionLinkAuthoritativeRecord = {
        ownerPrincipalId: principalId,
        ownerLinkRef: linkRef,
        state: { generation: 3, revoked: true },
      };
      // This request's expectedGeneration is exactly correct (3) — it is not stale by CAS terms —
      // yet it must still be denied, because revocation is sticky and must never be undone by retry.
      const result = resolveSessionLinkTransition(
        relinkRequest({ expectedGeneration: 3, idempotencyKey: sessionLinkIdempotencyKey('post-revoke-relink') }),
        revokedRecord,
        noPriorApplications,
      );
      assert(
        result.status === 'DENIED' && result.reason === 'ALREADY_REVOKED',
        'a revoked link must deny further operations even when the caller technically has the exact current generation',
      );
    },
  },
  {
    id: 'XSESS-06-STALE-COPIED-CLAIM-AGAINST-REVOKED-STATE-ALSO-DENIES-NOT-CONFLICT',
    run: () => {
      const revokedRecord: SessionLinkAuthoritativeRecord = {
        ownerPrincipalId: principalId,
        ownerLinkRef: linkRef,
        state: { generation: 3, revoked: true },
      };
      const staleClaim = resolveSessionLinkTransition(
        relinkRequest({ expectedGeneration: 1, idempotencyKey: sessionLinkIdempotencyKey('ancient-copied-claim') }),
        revokedRecord,
        noPriorApplications,
      );
      assert(
        staleClaim.status === 'DENIED' && staleClaim.reason === 'ALREADY_REVOKED',
        'revocation must be reported as the reason even for a long-stale claim, not conflated with a generic CONFLICT that invites retrying',
      );
    },
  },
  {
    id: 'XSESS-06-SCOPE-MISMATCH-DENIES-NOT-CONFLATED-WITH-A-DIFFERENT-PRINCIPALS-RECORD',
    run: () => {
      const wrongPrincipalRequest = relinkRequest({ principalId: otherPrincipalId, expectedGeneration: 1 });
      const result = resolveSessionLinkTransition(wrongPrincipalRequest, freshRecord(1), noPriorApplications);
      assert(
        result.status === 'DENIED' && result.reason === 'SCOPE_MISMATCH',
        'a request scoped to a different principal than the record it is evaluated against must deny, never apply by coincidentally matching generation',
      );
    },
  },
  {
    id: 'XSESS-06-SCOPE-MISMATCH-ON-LINK-REF-ALSO-DENIES',
    run: () => {
      const wrongLinkRequest = relinkRequest({ linkRef: otherLinkRef, expectedGeneration: 1 });
      const result = resolveSessionLinkTransition(wrongLinkRequest, freshRecord(1), noPriorApplications);
      assert(
        result.status === 'DENIED' && result.reason === 'SCOPE_MISMATCH',
        'a request scoped to a different external link ref than the record it is evaluated against must deny',
      );
    },
  },
  {
    id: 'XSESS-06-UNLINK-ADVANCES-GENERATION-AND-SETS-REVOKED',
    run: () => {
      const unlinkRequest = relinkRequest({ operation: 'UNLINK', expectedGeneration: 4 });
      const result = resolveSessionLinkTransition(unlinkRequest, freshRecord(4, false), noPriorApplications);
      assert(
        result.status === 'APPLIED' &&
          result.resultingRecord.state.generation === 5 &&
          result.resultingRecord.state.revoked === true,
        'UNLINK must advance the generation by exactly one and set revoked true in the same transition',
      );
    },
  },
  {
    id: 'XSESS-06-OUT-OF-ORDER-DUPLICATE-WITH-DISTINCT-KEY-STILL-FAILS-CLOSED-NOT-LAST-WRITE-WINS',
    run: () => {
      // A duplicated network send of an earlier operation (different idempotency key than the
      // original, e.g. a naive client retry that regenerated its key) arrives after the record has
      // already moved on. It must fail closed as a fresh CONFLICT, never silently re-apply as if its
      // (now stale) expectedGeneration were still current — this is the "never last-write-wins by
      // wall-clock" invariant: arrival order never substitutes for the CAS precondition.
      const movedOn = freshRecord(7);
      const duplicate = resolveSessionLinkTransition(
        relinkRequest({ expectedGeneration: 3, idempotencyKey: sessionLinkIdempotencyKey('late-duplicate-send') }),
        movedOn,
        noPriorApplications,
      );
      assert(
        duplicate.status === 'CONFLICT' && duplicate.reason === 'STALE_EXPECTED_GENERATION',
        'an out-of-order duplicate arriving after the record has advanced must fail closed as CONFLICT',
      );
    },
  },
];

function main() {
  for (const testCase of cases) {
    testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} commerce session link transition scenarios`);
}

main();
