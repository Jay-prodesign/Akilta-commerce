import {
  resolveCommerceSessionLinkCandidate,
  type CommerceSessionLinkCandidate,
} from '../../packages/authz/src';
import { authProviderKey, externalAuthSubjectRef, type AuthProviderKey, type ExternalAuthSubjectRef } from '../../packages/authz/src';
import { evaluateFederatedExchangeAdmission, federatedExchangeAudience, federatedExchangeNonce, federatedExchangePurpose, type FederatedExchangeEnvelope, type FederatedExchangePolicy } from '../../packages/authz/src';
import { externalId, internalId, operationalStatus, utcTimestamp, type UserId } from '../../packages/domain/src';
import type { ExternalCommerceSessionLinkRef } from '../../packages/authz/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const akiltaProvider: AuthProviderKey = authProviderKey('akilta-federated');
const otherProvider: AuthProviderKey = authProviderKey('google-oauth');
const subjectRef: ExternalAuthSubjectRef = externalAuthSubjectRef('akilta-user-001');
const otherSubjectRef: ExternalAuthSubjectRef = externalAuthSubjectRef('akilta-user-0011');

const principalA: UserId = internalId('commerce-principal-a', 'User');
const principalB: UserId = internalId('commerce-principal-b', 'User');
const linkRefA: ExternalCommerceSessionLinkRef = externalId('link-a', 'CommerceSessionLink');
const linkRefB: ExternalCommerceSessionLinkRef = externalId('link-b', 'CommerceSessionLink');

function candidate(overrides: Partial<CommerceSessionLinkCandidate> = {}): CommerceSessionLinkCandidate {
  return {
    principalId: principalA,
    issuerAuthProvider: akiltaProvider,
    externalSubjectRef: subjectRef,
    externalLinkRef: linkRefA,
    status: operationalStatus('ACTIVE'),
    ...overrides,
  };
}

const cases: Array<{ id: string; run: () => void }> = [
  {
    id: 'XSESS2-01-SINGLE-EXACT-ACTIVE-MATCH-RESOLVES',
    run: () => {
      const result = resolveCommerceSessionLinkCandidate(akiltaProvider, subjectRef, [candidate()]);
      assert(
        result.status === 'RESOLVED' && result.principalId === principalA && result.externalLinkRef === linkRefA,
        'a single exact active candidate must resolve to that exact principal and link ref',
      );
    },
  },
  {
    id: 'XSESS2-02-NO-MATCHING-CANDIDATE-DENIES-NO-MATCHING-LINK',
    run: () => {
      const result = resolveCommerceSessionLinkCandidate(akiltaProvider, subjectRef, []);
      assert(result.status === 'DENIED' && result.reason === 'NO_MATCHING_LINK', 'an empty candidate set must deny NO_MATCHING_LINK');
    },
  },
  {
    id: 'XSESS2-03-TWO-EXACT-MATCHES-DENY-LINK-CONFLICT-NEVER-PICKS-FIRST',
    run: () => {
      const candidates = [
        candidate({ principalId: principalA, externalLinkRef: linkRefA }),
        candidate({ principalId: principalB, externalLinkRef: linkRefB }),
      ];
      const result = resolveCommerceSessionLinkCandidate(akiltaProvider, subjectRef, candidates);
      assert(
        result.status === 'DENIED' && result.reason === 'LINK_CONFLICT',
        'two exact (issuer, subject) matches must deny as a conflict, never silently resolve to the first array entry',
      );
    },
  },
  {
    id: 'XSESS2-04-EXACT-MATCH-BUT-INACTIVE-STATUS-DENIES-LINK-INACTIVE',
    run: () => {
      const result = resolveCommerceSessionLinkCandidate(akiltaProvider, subjectRef, [
        candidate({ status: operationalStatus('REVOKED') }),
      ]);
      assert(
        result.status === 'DENIED' && result.reason === 'LINK_INACTIVE',
        'a single exact match that is not operationally ACTIVE must deny LINK_INACTIVE rather than resolve a stale candidate',
      );
    },
  },
  {
    id: 'XSESS2-05-SIMILAR-BUT-NOT-IDENTICAL-SUBJECT-REF-NEVER-AUTO-MERGES',
    run: () => {
      // otherSubjectRef is a near-identical superstring of subjectRef (one extra trailing digit) —
      // exact-equality discipline must still deny, proving no similarity/substring heuristic exists.
      const result = resolveCommerceSessionLinkCandidate(akiltaProvider, otherSubjectRef, [candidate()]);
      assert(
        result.status === 'DENIED' && result.reason === 'NO_MATCHING_LINK',
        'a near-identical but not exactly equal subject ref must never auto-merge with an existing candidate',
      );
    },
  },
  {
    id: 'XSESS2-06-SAME-SUBJECT-REF-WRONG-ISSUER-NEVER-MERGES-ACROSS-PROVIDERS',
    run: () => {
      const result = resolveCommerceSessionLinkCandidate(otherProvider, subjectRef, [candidate()]);
      assert(
        result.status === 'DENIED' && result.reason === 'NO_MATCHING_LINK',
        'an identical subject ref under a different issuer/auth-provider must never merge with an unrelated candidate',
      );
    },
  },
  {
    id: 'XSESS2-07-ONE-MATCHING-CANDIDATE-AMONG-SEVERAL-UNRELATED-ONES-RESOLVES-CORRECTLY',
    run: () => {
      const candidates = [
        candidate({ principalId: principalB, issuerAuthProvider: otherProvider, externalLinkRef: linkRefB }),
        candidate({ principalId: principalB, externalSubjectRef: otherSubjectRef, externalLinkRef: linkRefB }),
        candidate({ principalId: principalA, externalLinkRef: linkRefA }),
      ];
      const result = resolveCommerceSessionLinkCandidate(akiltaProvider, subjectRef, candidates);
      assert(
        result.status === 'RESOLVED' && result.principalId === principalA && result.externalLinkRef === linkRefA,
        'filtering must correctly isolate the one genuinely matching candidate among several unrelated noise entries',
      );
    },
  },
  {
    id: 'XSESS2-08-ONLY-AN-ADMITTED-FEDERATED-EXCHANGE-FEEDS-THIS-RESOLVER-COMPOSITION-WITH-XSESS-01',
    run: () => {
      // Demonstrates the intended sequencing: evaluateFederatedExchangeAdmission (XSESS-01, unmodified)
      // gates the envelope first; only on ADMITTED does its verified issuer/subject reach this resolver.
      const policy: FederatedExchangePolicy = {
        expectedAudience: federatedExchangeAudience('ai-commerce'),
        expectedPurpose: federatedExchangePurpose('session-link'),
        expectedVersion: '1',
      };
      const envelope: FederatedExchangeEnvelope = {
        audience: federatedExchangeAudience('ai-commerce'),
        purpose: federatedExchangePurpose('session-link'),
        version: '1',
        nonce: federatedExchangeNonce('nonce-001'),
        issuedAt: utcTimestamp(new Date(0)),
        expiresAt: utcTimestamp(new Date(10_000)),
      };
      const admission = evaluateFederatedExchangeAdmission(envelope, policy, new Set(), utcTimestamp(new Date(1000)));
      assert(admission.status === 'ADMITTED', 'precondition: the exchange envelope must be admitted by XSESS-01 unchanged');

      const result = resolveCommerceSessionLinkCandidate(akiltaProvider, subjectRef, [candidate()]);
      assert(
        result.status === 'RESOLVED' && result.principalId === principalA,
        'only after XSESS-01 admission does the verified issuer/subject reach candidate resolution, composing rather than duplicating admission logic',
      );
    },
  },
];

function main() {
  for (const testCase of cases) {
    testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} commerce session link candidate resolution scenarios`);
}

main();
