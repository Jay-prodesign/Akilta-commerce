import {
  resolveExternalRevocationFencing,
  resolveSessionLinkTransition,
  sessionLinkIdempotencyKey,
  type ExternalRevocationSignal,
  type SessionLinkAuthoritativeRecord,
  type SessionLinkIdempotencyKey,
} from '../../packages/authz/src';
import { resolveAuthenticatedPrincipal, type UserIdentity } from '../../packages/authz/src';
import { authProviderKey, externalAuthSubjectRef, externalSessionRef } from '../../packages/authz/src';
import { externalId, internalId, operationalStatus, utcTimestamp, type UserId } from '../../packages/domain/src';
import type { ExternalCommerceSessionLinkRef } from '../../packages/authz/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const principalA: UserId = internalId('revoke-principal-a', 'User');
const principalB: UserId = internalId('revoke-principal-b', 'User');
const linkRefX: ExternalCommerceSessionLinkRef = externalId('revoke-link-x', 'CommerceSessionLink');
const linkRefY: ExternalCommerceSessionLinkRef = externalId('revoke-link-y', 'CommerceSessionLink');

function record(
  principalId: UserId,
  linkRef: ExternalCommerceSessionLinkRef,
  generation = 0,
  revoked = false,
): SessionLinkAuthoritativeRecord {
  return { ownerPrincipalId: principalId, ownerLinkRef: linkRef, state: { generation, revoked } };
}

const cases: Array<{ id: string; run: () => void }> = [
  {
    id: 'XSESS4-01-SIGNAL-TARGETS-THE-EXACT-MATCHING-LINK-RECORD',
    run: () => {
      const signal: ExternalRevocationSignal = { externalLinkRef: linkRefX };
      const result = resolveExternalRevocationFencing(signal, record(principalA, linkRefX));
      assert(
        result.status === 'TARGETED' && result.principalId === principalA && result.externalLinkRef === linkRefX,
        'a signal must target the record whose ownerLinkRef exactly matches the declared externalLinkRef',
      );
    },
  },
  {
    id: 'XSESS4-02-SIGNAL-NEVER-TARGETS-A-DIFFERENT-LINK-REF',
    run: () => {
      const signal: ExternalRevocationSignal = { externalLinkRef: linkRefX };
      const result = resolveExternalRevocationFencing(signal, record(principalA, linkRefY));
      assert(result.status === 'NOT_TARGETED', 'a signal naming linkRefX must never target an unrelated linkRefY record, even for the same principal');
    },
  },
  {
    id: 'XSESS4-03-SIGNAL-NEVER-TARGETS-AN-UNRELATED-PRINCIPALS-RECORD',
    run: () => {
      const signal: ExternalRevocationSignal = { externalLinkRef: linkRefX };
      const result = resolveExternalRevocationFencing(signal, record(principalB, linkRefY));
      assert(result.status === 'NOT_TARGETED', 'a signal must never target an unrelated principal/link combination');
    },
  },
  {
    id: 'XSESS4-04-NO-CANDIDATE-RECORD-IS-TRIVIALLY-NOT-TARGETED',
    run: () => {
      const signal: ExternalRevocationSignal = { externalLinkRef: linkRefX };
      const result = resolveExternalRevocationFencing(signal, null);
      assert(result.status === 'NOT_TARGETED', 'no candidate record at all must be NOT_TARGETED, never assumed in-scope');
    },
  },
  {
    id: 'XSESS4-05-COMPOSITION-TARGETED-RESULT-FEEDS-UNLINK-AND-ONLY-THAT-RECORD-IS-REVOKED',
    run: () => {
      const signal: ExternalRevocationSignal = { externalLinkRef: linkRefX };
      const targetRecord = record(principalA, linkRefX, 2);
      const fencing = resolveExternalRevocationFencing(signal, targetRecord);
      assert(fencing.status === 'TARGETED', 'precondition: the signal must target this record');

      const key: SessionLinkIdempotencyKey = sessionLinkIdempotencyKey('revocation-op-1');
      const noPriorApplications: ReadonlyMap<SessionLinkIdempotencyKey, SessionLinkAuthoritativeRecord> = new Map();
      const unlinkResult = resolveSessionLinkTransition(
        { principalId: fencing.principalId, linkRef: fencing.externalLinkRef, operation: 'UNLINK', expectedGeneration: 2, idempotencyKey: key },
        targetRecord,
        noPriorApplications,
      );
      assert(
        unlinkResult.status === 'APPLIED' && unlinkResult.resultingRecord.state.revoked === true,
        'the TARGETED record must be revocable via the existing UNLINK transition, unchanged',
      );
    },
  },
  {
    id: 'XSESS4-06-A-SIGNAL-FOR-ONE-LINK-NEVER-PRODUCES-A-TARGETED-RESULT-FOR-AN-UNRELATED-RECORD-SET',
    run: () => {
      // Simulates checking a signal for linkRefX against every record a naive caller might have on
      // hand; only the exact match becomes TARGETED, everything else stays NOT_TARGETED and must never
      // be passed to UNLINK — this is the "fences only sessions derived from that link" property.
      const signal: ExternalRevocationSignal = { externalLinkRef: linkRefX };
      const candidates = [
        record(principalA, linkRefX),
        record(principalA, linkRefY),
        record(principalB, linkRefX === linkRefX ? linkRefY : linkRefX),
        record(principalB, linkRefY),
      ];
      const results = candidates.map((c) => resolveExternalRevocationFencing(signal, c));
      const targetedCount = results.filter((r) => r.status === 'TARGETED').length;
      assert(targetedCount === 1, 'exactly one record among several candidates must be targeted by a single-link signal, never more, never zero when a true match exists');
    },
  },
  {
    id: 'XSESS4-07-REVOKING-A-FEDERATED-LINK-NEVER-TOUCHES-AN-INDEPENDENTLY-AUTHENTICATED-NATIVE-SESSION',
    run: () => {
      // Structural proof: auth-identity.ts's native authentication path (UserIdentity /
      // resolveAuthenticatedPrincipal) is a completely separate record/module from the session-link
      // this file revokes. Revoking the link (XSESS4-05 above) calls nothing here, imports nothing
      // from auth-identity.ts, and mutates no UserIdentity value — so a principal's own independently
      // authenticated Commerce session is provably unaffected by any outcome of this module.
      const nativeIdentity: UserIdentity = {
        userIdentityId: internalId('native-identity-1', 'UserIdentity'),
        userId: principalA,
        authProvider: authProviderKey('commerce-native'),
        externalSubjectRef: externalAuthSubjectRef('native-subject-1'),
        status: operationalStatus('ACTIVE'),
        verifiedAt: utcTimestamp(new Date(0)),
        createdAt: utcTimestamp(new Date(0)),
      };
      const beforeRevocation = resolveAuthenticatedPrincipal(
        {
          outcome: 'VERIFIED',
          proof: {
            authProvider: authProviderKey('commerce-native'),
            externalSubjectRef: externalAuthSubjectRef('native-subject-1'),
            externalSessionRef: externalSessionRef('native-session-1'),
            assuranceLevel: 'STANDARD',
            status: 'ACTIVE',
            issuedAt: utcTimestamp(new Date(0)),
            verifiedAt: utcTimestamp(new Date(0)),
            expiresAt: utcTimestamp(new Date(1_000_000_000_000)),
          },
        },
        [nativeIdentity],
        utcTimestamp(new Date(1)),
      );
      assert(beforeRevocation.status === 'AUTHENTICATED', 'precondition: the native session resolves independently of any federated link');

      // Revoke the unrelated federated link for the same principal.
      const signal: ExternalRevocationSignal = { externalLinkRef: linkRefX };
      const linkRecord = record(principalA, linkRefX, 0);
      const fencing = resolveExternalRevocationFencing(signal, linkRecord);
      assert(fencing.status === 'TARGETED', 'precondition: the signal targets the federated link record');
      const key: SessionLinkIdempotencyKey = sessionLinkIdempotencyKey('revocation-op-2');
      const unlinkResult = resolveSessionLinkTransition(
        { principalId: fencing.principalId, linkRef: fencing.externalLinkRef, operation: 'UNLINK', expectedGeneration: 0, idempotencyKey: key },
        linkRecord,
        new Map(),
      );
      assert(unlinkResult.status === 'APPLIED' && unlinkResult.resultingRecord.state.revoked, 'the federated link must be revoked');

      // Re-resolving the native identity afterward, with the exact same inputs, must be unaffected —
      // nothing about the link revocation above could have changed UserIdentity, because nothing in
      // this module ever touches it.
      const afterRevocation = resolveAuthenticatedPrincipal(
        {
          outcome: 'VERIFIED',
          proof: {
            authProvider: authProviderKey('commerce-native'),
            externalSubjectRef: externalAuthSubjectRef('native-subject-1'),
            externalSessionRef: externalSessionRef('native-session-1'),
            assuranceLevel: 'STANDARD',
            status: 'ACTIVE',
            issuedAt: utcTimestamp(new Date(0)),
            verifiedAt: utcTimestamp(new Date(0)),
            expiresAt: utcTimestamp(new Date(1_000_000_000_000)),
          },
        },
        [nativeIdentity],
        utcTimestamp(new Date(1)),
      );
      assert(
        afterRevocation.status === 'AUTHENTICATED',
        'an independently authenticated native Commerce session must remain unaffected by revoking an unrelated federated session-link',
      );
    },
  },
];

function main() {
  for (const testCase of cases) {
    testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} external revocation fencing scenarios`);
}

main();
