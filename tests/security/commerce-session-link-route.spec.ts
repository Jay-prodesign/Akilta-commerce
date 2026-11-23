import {
  handleCommerceSessionLinkExchangeRequest,
  type CommerceSessionLinkExchangeHttpRequest,
} from '../../apps/api/src/commerce-session-link-route';
import type {
  CommerceSessionLinkCandidateReadOutcome,
  CommerceSessionLinkPersistOutcome,
  CommerceSessionLinkStore,
} from '../../apps/api/src/commerce-session-link-store';
import { authProviderKey, externalAuthSubjectRef, sessionLinkIdempotencyKey } from '../../packages/authz/src';
import { externalId, internalId, operationalStatus } from '../../packages/domain/src';

const akiltaProvider = authProviderKey('akilta');
const akiltaSubject = externalAuthSubjectRef('akilta-subject-1');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const principalId = internalId('session-route-principal-1', 'User');
const linkRef = externalId('session-route-link-1', 'CommerceSessionLink');

function fakeStore(overrides: Partial<CommerceSessionLinkStore> = {}): CommerceSessionLinkStore {
  return {
    findFederatedCandidates: (): Promise<CommerceSessionLinkCandidateReadOutcome> =>
      Promise.resolve({
        status: 'FOUND',
        candidates: [
          {
            principalId,
            issuerAuthProvider: akiltaProvider,
            externalSubjectRef: akiltaSubject,
            externalLinkRef: linkRef,
            status: operationalStatus('ACTIVE'),
          },
        ],
      }),
    applyTransition: (): Promise<CommerceSessionLinkPersistOutcome> =>
      Promise.resolve({
        status: 'APPLIED',
        resultingRecord: { ownerPrincipalId: principalId, ownerLinkRef: linkRef, state: { generation: 1, revoked: false } },
      }),
    ...overrides,
  };
}

function baseRequest(overrides: Partial<CommerceSessionLinkExchangeHttpRequest> = {}): CommerceSessionLinkExchangeHttpRequest {
  return {
    audience: 'ai-commerce',
    purpose: 'session-link-exchange',
    version: '1',
    nonce: 'nonce-1',
    issuedAt: '2026-11-23T12:00:00Z',
    expiresAt: '2026-11-23T12:10:00Z',
    authProvider: 'akilta',
    externalSubjectRef: 'akilta-subject-1',
    operation: 'RELINK',
    expectedGeneration: 0,
    idempotencyKey: 'exchange-idem-1',
    now: '2026-11-23T12:05:00Z',
    consumedNonces: new Set(),
    appliedIdempotencyKeys: new Map(),
    store: fakeStore(),
    ...overrides,
  };
}

const cases: ReadonlyArray<{ readonly id: string; readonly run: () => Promise<void> }> = [
  {
    id: 'CSL-ROUTE-01-AUTHORIZED-EXCHANGE-APPLIES-AND-RETURNS-200',
    run: async () => {
      const result = await handleCommerceSessionLinkExchangeRequest(baseRequest());
      assert(result.httpStatus === 200, 'an admitted exchange resolving to an active candidate must apply and return 200');
      assert(
        result.httpStatus === 200 && result.body.generation === 1 && result.body.replay === false,
        'the response must report the real resulting generation and a real (non-replay) applied flag',
      );
    },
  },
  {
    id: 'CSL-ROUTE-02-WRONG-AUDIENCE-DENIES-401-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store = fakeStore({
        findFederatedCandidates: () => {
          storeCalled = true;
          return Promise.resolve({ status: 'FOUND', candidates: [] });
        },
      });
      const result = await handleCommerceSessionLinkExchangeRequest(baseRequest({ audience: 'wrong-audience', store }));
      assert(result.httpStatus === 401, 'a wrong-audience envelope must be denied before any candidate lookup');
      assert(
        result.httpStatus === 401 && result.body.code === 'EXCHANGE_NOT_ADMITTED' && result.body.reason === 'WRONG_AUDIENCE',
        'the exact admission-denial reason must be reported, not a generic error',
      );
      assert(!storeCalled, 'admission must fail closed before the session-link store is ever queried');
    },
  },
  {
    id: 'CSL-ROUTE-03-EXPIRED-ENVELOPE-DENIES-401',
    run: async () => {
      const result = await handleCommerceSessionLinkExchangeRequest(baseRequest({ now: '2026-11-23T13:00:00Z' }));
      assert(
        result.httpStatus === 401 && result.body.code === 'EXCHANGE_NOT_ADMITTED' && result.body.reason === 'EXPIRED',
        'an envelope past its own expiresAt must be denied as EXPIRED',
      );
    },
  },
  {
    id: 'CSL-ROUTE-04-REPLAYED-NONCE-DENIES-401',
    run: async () => {
      const result = await handleCommerceSessionLinkExchangeRequest(baseRequest({ consumedNonces: new Set(['nonce-1']) }));
      assert(
        result.httpStatus === 401 && result.body.code === 'EXCHANGE_NOT_ADMITTED' && result.body.reason === 'NONCE_REPLAYED',
        'a nonce already present in consumedNonces must be denied as NONCE_REPLAYED',
      );
    },
  },
  {
    id: 'CSL-ROUTE-05-NO-MATCHING-CANDIDATE-DENIES-401-NO-ACTIVE-SESSION-LINK',
    run: async () => {
      const store = fakeStore({ findFederatedCandidates: () => Promise.resolve({ status: 'FOUND', candidates: [] }) });
      const result = await handleCommerceSessionLinkExchangeRequest(baseRequest({ store }));
      assert(
        result.httpStatus === 401 && result.body.code === 'NO_ACTIVE_SESSION_LINK' && result.body.reason === 'NO_MATCHING_LINK',
        'an admitted exchange with no matching candidate row must be denied as NO_ACTIVE_SESSION_LINK, never a fabricated success',
      );
    },
  },
  {
    id: 'CSL-ROUTE-06-INACTIVE-CANDIDATE-DENIES-401-NO-ACTIVE-SESSION-LINK',
    run: async () => {
      const store = fakeStore({
        findFederatedCandidates: () =>
          Promise.resolve({
            status: 'FOUND',
            candidates: [
              {
                principalId,
                issuerAuthProvider: akiltaProvider,
                externalSubjectRef: akiltaSubject,
                externalLinkRef: linkRef,
                status: operationalStatus('REVOKED'),
              },
            ],
          }),
      });
      const result = await handleCommerceSessionLinkExchangeRequest(baseRequest({ store }));
      assert(
        result.httpStatus === 401 && result.body.code === 'NO_ACTIVE_SESSION_LINK' && result.body.reason === 'LINK_INACTIVE',
        'a revoked/inactive candidate must be denied as LINK_INACTIVE, never silently resurrected',
      );
    },
  },
  {
    id: 'CSL-ROUTE-07-MULTIPLE-MATCHING-CANDIDATES-DENIES-409-SESSION-LINK-CONFLICT',
    run: async () => {
      const duplicate = {
        principalId,
        issuerAuthProvider: akiltaProvider,
        externalSubjectRef: akiltaSubject,
        externalLinkRef: linkRef,
        status: operationalStatus('ACTIVE'),
      };
      const store = fakeStore({ findFederatedCandidates: () => Promise.resolve({ status: 'FOUND', candidates: [duplicate, duplicate] }) });
      const result = await handleCommerceSessionLinkExchangeRequest(baseRequest({ store }));
      assert(
        result.httpStatus === 409 && result.body.code === 'SESSION_LINK_CONFLICT' && result.body.reason === 'LINK_CONFLICT',
        'more than one exact candidate match must be a 409 conflict, never resolved by array order',
      );
    },
  },
  {
    id: 'CSL-ROUTE-08-CANDIDATE-READ-STORE-ERROR-RETURNS-RETRYABLE-500',
    run: async () => {
      const store = fakeStore({ findFederatedCandidates: () => Promise.resolve({ status: 'STORE_ERROR' }) });
      const result = await handleCommerceSessionLinkExchangeRequest(baseRequest({ store }));
      assert(
        result.httpStatus === 500 && result.body.code === 'INTERNAL_UNEXPECTED' && result.body.retryable === true,
        'a candidate-lookup store failure must surface as a retryable 500, never a false 401/200',
      );
    },
  },
  {
    id: 'CSL-ROUTE-09-STALE-EXPECTED-GENERATION-RETURNS-409-SESSION-LINK-CONFLICT',
    run: async () => {
      const store = fakeStore({ applyTransition: () => Promise.resolve({ status: 'CONFLICT', reason: 'STALE_EXPECTED_GENERATION' }) });
      const result = await handleCommerceSessionLinkExchangeRequest(baseRequest({ store }));
      assert(
        result.httpStatus === 409 && result.body.code === 'SESSION_LINK_CONFLICT' && result.body.reason === 'STALE_EXPECTED_GENERATION',
        'a stale expectedGeneration must surface as a 409 conflict, never a silent overwrite',
      );
    },
  },
  {
    id: 'CSL-ROUTE-10-ALREADY-REVOKED-TRANSITION-RETURNS-409-SESSION-LINK-INVALID-TRANSITION',
    run: async () => {
      const store = fakeStore({ applyTransition: () => Promise.resolve({ status: 'DENIED', reason: 'ALREADY_REVOKED' }) });
      const result = await handleCommerceSessionLinkExchangeRequest(baseRequest({ store }));
      assert(
        result.httpStatus === 409 && result.body.code === 'SESSION_LINK_INVALID_TRANSITION' && result.body.reason === 'ALREADY_REVOKED',
        'a transition against an already-revoked link must surface its exact reason, never silently reactivate',
      );
    },
  },
  {
    id: 'CSL-ROUTE-10B-IDEMPOTENCY-KEY-REUSED-FOR-DIFFERENT-SCOPE-RETURNS-409-NEVER-THE-OTHER-SCOPES-RECORD',
    run: async () => {
      const store = fakeStore({
        applyTransition: () => Promise.resolve({ status: 'DENIED', reason: 'IDEMPOTENCY_KEY_REUSED_FOR_DIFFERENT_SCOPE' }),
      });
      const result = await handleCommerceSessionLinkExchangeRequest(baseRequest({ store }));
      assert(
        result.httpStatus === 409 &&
          result.body.code === 'SESSION_LINK_INVALID_TRANSITION' &&
          result.body.reason === 'IDEMPOTENCY_KEY_REUSED_FOR_DIFFERENT_SCOPE',
        'an idempotency key collision across different session-link scopes must surface as an explicit 409, never leak the other scope\'s resulting record over HTTP',
      );
    },
  },
  {
    id: 'CSL-ROUTE-11-RACE-LOST-RETURNS-409-SESSION-LINK-CONFLICT',
    run: async () => {
      const store = fakeStore({ applyTransition: () => Promise.resolve({ status: 'RACE_LOST' }) });
      const result = await handleCommerceSessionLinkExchangeRequest(baseRequest({ store }));
      assert(
        result.httpStatus === 409 && result.body.code === 'SESSION_LINK_CONFLICT' && result.body.reason === 'RACE_LOST',
        'a lost database-level race must surface as a 409 conflict, never a silent success',
      );
    },
  },
  {
    id: 'CSL-ROUTE-12-TRANSITION-STORE-ERROR-RETURNS-RETRYABLE-500',
    run: async () => {
      const store = fakeStore({ applyTransition: () => Promise.resolve({ status: 'STORE_ERROR' }) });
      const result = await handleCommerceSessionLinkExchangeRequest(baseRequest({ store }));
      assert(
        result.httpStatus === 500 && result.body.code === 'INTERNAL_UNEXPECTED' && result.body.retryable === true,
        'a transition store failure must surface as a retryable 500, never a false 409/200',
      );
    },
  },
  {
    id: 'CSL-ROUTE-13-REPLAYED-IDEMPOTENCY-KEY-RETURNS-200-WITH-REPLAY-TRUE',
    run: async () => {
      const store = fakeStore({
        applyTransition: () =>
          Promise.resolve({
            status: 'ALREADY_APPLIED',
            resultingRecord: { ownerPrincipalId: principalId, ownerLinkRef: linkRef, state: { generation: 1, revoked: false } },
          }),
      });
      const result = await handleCommerceSessionLinkExchangeRequest(baseRequest({ store }));
      assert(
        result.httpStatus === 200 && result.body.replay === true,
        'a replayed idempotency key must still return 200 flagged as a real replay',
      );
    },
  },
  {
    id: 'CSL-ROUTE-14-INJECTED-APPLIED-IDEMPOTENCY-KEYS-ARE-ACTUALLY-THREADED-TO-THE-STORE',
    run: async () => {
      // Regression: the route must not silently drop the caller-injected appliedIdempotencyKeys map
      // (it is the one real prior-outcome lookup the store's own CAS decision function uses) in favor
      // of always passing a fresh empty Map.
      let receivedMap: unknown;
      const injectedMap = new Map([
        [
          sessionLinkIdempotencyKey('exchange-idem-1'),
          { ownerPrincipalId: principalId, ownerLinkRef: linkRef, state: { generation: 7, revoked: false } },
        ],
      ]);
      const store = fakeStore({
        applyTransition: (_request, appliedIdempotencyKeys) => {
          receivedMap = appliedIdempotencyKeys;
          return Promise.resolve({
            status: 'APPLIED',
            resultingRecord: { ownerPrincipalId: principalId, ownerLinkRef: linkRef, state: { generation: 1, revoked: false } },
          });
        },
      });
      await handleCommerceSessionLinkExchangeRequest(baseRequest({ store, appliedIdempotencyKeys: injectedMap }));
      assert(receivedMap === injectedMap, 'the exact injected appliedIdempotencyKeys map must reach the store\'s own applyTransition call, never replaced by a fresh empty Map');
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} commerce session-link exchange HTTP route scenarios`);
}

void main();
