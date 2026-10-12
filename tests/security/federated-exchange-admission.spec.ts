import {
  evaluateFederatedExchangeAdmission,
  federatedExchangeAudience,
  federatedExchangeNonce,
  federatedExchangePurpose,
  type FederatedExchangeEnvelope,
  type FederatedExchangeNonce,
  type FederatedExchangePolicy,
} from '../../packages/authz/src';
import { utcTimestamp, type UtcTimestamp } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const now: UtcTimestamp = utcTimestamp('2026-10-12T00:00:00Z');
const issuedAt: UtcTimestamp = utcTimestamp('2026-10-11T23:55:00Z');
const freshExpiresAt: UtcTimestamp = utcTimestamp('2026-10-12T00:05:00Z');
const pastExpiresAt: UtcTimestamp = utcTimestamp('2026-10-11T23:59:00Z');

const policy: FederatedExchangePolicy = {
  expectedAudience: federatedExchangeAudience('commerce-session-exchange'),
  expectedPurpose: federatedExchangePurpose('session-link'),
  expectedVersion: '1',
};

function baseEnvelope(overrides: Partial<FederatedExchangeEnvelope> = {}): FederatedExchangeEnvelope {
  return {
    audience: policy.expectedAudience,
    purpose: policy.expectedPurpose,
    version: policy.expectedVersion,
    nonce: federatedExchangeNonce('xsess-01-nonce-1'),
    issuedAt,
    expiresAt: freshExpiresAt,
    ...overrides,
  };
}

const noConsumedNonces: ReadonlySet<FederatedExchangeNonce> = new Set();

const cases: Array<{ id: string; run: () => void }> = [
  {
    id: 'XSESS-01-VALID-ENVELOPE-ADMITTED',
    run: () => {
      const result = evaluateFederatedExchangeAdmission(baseEnvelope(), policy, noConsumedNonces, now);
      assert(result.status === 'ADMITTED', 'a fresh, matching, unconsumed envelope must be admitted');
    },
  },
  {
    id: 'XSESS-01-WRONG-AUDIENCE-DENIES',
    run: () => {
      const envelope = baseEnvelope({ audience: federatedExchangeAudience('some-other-audience') });
      const result = evaluateFederatedExchangeAdmission(envelope, policy, noConsumedNonces, now);
      assert(result.status === 'DENIED' && result.reason === 'WRONG_AUDIENCE', 'a mismatched audience must deny with WRONG_AUDIENCE');
    },
  },
  {
    id: 'XSESS-01-WRONG-PURPOSE-DENIES',
    run: () => {
      const envelope = baseEnvelope({ purpose: federatedExchangePurpose('some-other-purpose') });
      const result = evaluateFederatedExchangeAdmission(envelope, policy, noConsumedNonces, now);
      assert(result.status === 'DENIED' && result.reason === 'WRONG_PURPOSE', 'a mismatched purpose must deny with WRONG_PURPOSE');
    },
  },
  {
    id: 'XSESS-01-WRONG-VERSION-DENIES',
    run: () => {
      const envelope = baseEnvelope({ version: '2' });
      const result = evaluateFederatedExchangeAdmission(envelope, policy, noConsumedNonces, now);
      assert(result.status === 'DENIED' && result.reason === 'WRONG_VERSION', 'a mismatched version must deny with WRONG_VERSION');
    },
  },
  {
    id: 'XSESS-01-EXPIRED-DENIES',
    run: () => {
      const envelope = baseEnvelope({ expiresAt: pastExpiresAt });
      const result = evaluateFederatedExchangeAdmission(envelope, policy, noConsumedNonces, now);
      assert(result.status === 'DENIED' && result.reason === 'EXPIRED', 'an envelope past its expiresAt must deny with EXPIRED');
    },
  },
  {
    id: 'XSESS-01-EXPIRES-AT-EXACTLY-NOW-DENIES',
    run: () => {
      const envelope = baseEnvelope({ expiresAt: now });
      const result = evaluateFederatedExchangeAdmission(envelope, policy, noConsumedNonces, now);
      assert(
        result.status === 'DENIED' && result.reason === 'EXPIRED',
        'an envelope expiring exactly at now must deny, never be treated as still fresh',
      );
    },
  },
  {
    id: 'XSESS-01-REPLAYED-NONCE-DENIES',
    run: () => {
      const envelope = baseEnvelope();
      const consumedNonces: ReadonlySet<FederatedExchangeNonce> = new Set([envelope.nonce]);
      const result = evaluateFederatedExchangeAdmission(envelope, policy, consumedNonces, now);
      assert(result.status === 'DENIED' && result.reason === 'NONCE_REPLAYED', 'a nonce already present in consumedNonces must deny with NONCE_REPLAYED');
    },
  },
  {
    id: 'XSESS-01-UNRELATED-CONSUMED-NONCE-DOES-NOT-FENCE-A-FRESH-NONCE',
    run: () => {
      const envelope = baseEnvelope({ nonce: federatedExchangeNonce('xsess-01-nonce-fresh') });
      const consumedNonces: ReadonlySet<FederatedExchangeNonce> = new Set([federatedExchangeNonce('xsess-01-nonce-other')]);
      const result = evaluateFederatedExchangeAdmission(envelope, policy, consumedNonces, now);
      assert(result.status === 'ADMITTED', 'an unrelated consumed nonce must not deny a distinct fresh nonce');
    },
  },
  {
    id: 'XSESS-01-WRONG-AUDIENCE-TAKES-PRECEDENCE-OVER-EXPIRY-AND-REPLAY',
    run: () => {
      // A structurally wrong envelope must be rejected for that reason even when it is also
      // expired and also reuses a consumed nonce, per the function's documented precedence order.
      const envelope = baseEnvelope({
        audience: federatedExchangeAudience('some-other-audience'),
        expiresAt: pastExpiresAt,
      });
      const consumedNonces: ReadonlySet<FederatedExchangeNonce> = new Set([envelope.nonce]);
      const result = evaluateFederatedExchangeAdmission(envelope, policy, consumedNonces, now);
      assert(result.status === 'DENIED' && result.reason === 'WRONG_AUDIENCE', 'audience mismatch must be reported before expiry or replay');
    },
  },
  {
    id: 'XSESS-01-EXPIRED-TAKES-PRECEDENCE-OVER-REPLAY',
    run: () => {
      const envelope = baseEnvelope({ expiresAt: pastExpiresAt });
      const consumedNonces: ReadonlySet<FederatedExchangeNonce> = new Set([envelope.nonce]);
      const result = evaluateFederatedExchangeAdmission(envelope, policy, consumedNonces, now);
      assert(result.status === 'DENIED' && result.reason === 'EXPIRED', 'expiry must be reported before replay when both are true');
    },
  },
];

function main() {
  for (const testCase of cases) {
    testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} federated exchange admission scenarios`);
}

main();
