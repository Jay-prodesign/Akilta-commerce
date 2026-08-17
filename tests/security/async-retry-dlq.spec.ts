import { buildDeadLetterRecord, evaluateAsyncFailure, validateAsyncRetryPolicy, type AsyncRetryPolicy } from '../../packages/events/src/retry-policy';
import { validateAsyncEventTenantBinding, type AsyncEventEnvelope, type ServerResolvedAsyncIntegrationBinding } from '../../packages/events/src/async-envelope';
import { idempotencyKey, internalId, utcTimestamp } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const policy: AsyncRetryPolicy = {
  policyRef: 'policy:async-v1',
  maxAttempts: 3,
  maxRetryDelaySeconds: 60,
  retryExhaustionDisposition: 'QUARANTINE',
  rules: [
    { failureClass: 'RATE_LIMIT', disposition: 'RETRY', retryDelaySeconds: 30 },
    { failureClass: 'TIMEOUT', disposition: 'RETRY', retryDelaySeconds: 10 },
    { failureClass: 'SCHEMA_MISMATCH', disposition: 'QUARANTINE' },
    { failureClass: 'AUTHENTICITY_INVALID', disposition: 'FAIL_CLOSED' },
  ],
};

const envelope: AsyncEventEnvelope = {
  schemaVersion: '1',
  topic: 'ingress.events',
  eventId: internalId('evt-1', 'OperationalEvent'),
  merchantWorkspaceId: internalId('ws-a', 'MerchantWorkspace'),
  integrationId: internalId('int-a', 'Integration'),
  source: 'provider',
  sourceEventId: 'p-1',
  observedAt: utcTimestamp('2026-08-09T07:00:00Z'),
  correlationId: internalId('corr-1', 'Correlation'),
  idempotencyKey: idempotencyKey('idem-1'),
  payloadType: 'provider.event',
  safePayloadRef: 'safe-ref:evt-1',
};

const binding = { integrationId: envelope.integrationId!, merchantWorkspaceId: envelope.merchantWorkspaceId } as const;

const cases: Array<{ id: string; run: () => void }> = [
  { id: 'AR-01-POLICY-VALID', run: () => assert(validateAsyncRetryPolicy(policy).status === 'VALID', 'policy should validate') },
  { id: 'AR-02-BOUNDED-RETRY', run: () => {
    const r = evaluateAsyncFailure({ policy, attempt: 1, failureClass: 'RATE_LIMIT' });
    assert(r.decision === 'RETRY' && r.nextAttempt === 2 && r.retryDelaySeconds === 30, 'first rate limit should retry once');
  }},
  { id: 'AR-03-RETRY-EXHAUSTION-QUARANTINES', run: () => {
    const r = evaluateAsyncFailure({ policy, attempt: 3, failureClass: 'RATE_LIMIT' });
    assert(r.decision === 'QUARANTINE' && r.exhaustedRetry === true, 'max attempt must stop retry loop');
  }},
  { id: 'AR-04-EXPLICIT-QUARANTINE', run: () => {
    const r = evaluateAsyncFailure({ policy, attempt: 1, failureClass: 'SCHEMA_MISMATCH' });
    assert(r.decision === 'QUARANTINE' && r.exhaustedRetry === false, 'schema mismatch should follow explicit policy');
  }},
  { id: 'AR-05-EXPLICIT-FAIL-CLOSED', run: () => {
    const r = evaluateAsyncFailure({ policy, attempt: 1, failureClass: 'AUTHENTICITY_INVALID' });
    assert(r.decision === 'FAIL_CLOSED' && r.exhaustedRetry === false, 'authenticity invalid must not retry under this policy');
  }},
  { id: 'AR-06-MISSING-RULE-FAILS-CLOSED', run: () => {
    const r = evaluateAsyncFailure({ policy, attempt: 1, failureClass: 'UNKNOWN' });
    assert(r.decision === 'FAIL_CLOSED' && 'reason' in r && r.reason === 'NO_FAILURE_RULE', 'unclassified failure must not loop');
  }},
  { id: 'AR-07-INVALID-ATTEMPT-FAILS-CLOSED', run: () => {
    const r = evaluateAsyncFailure({ policy, attempt: 0, failureClass: 'TIMEOUT' });
    assert(r.decision === 'FAIL_CLOSED' && 'reason' in r && r.reason === 'INVALID_ATTEMPT', 'attempt 0 must fail closed');
  }},
  { id: 'AR-08-OVERLIMIT-DELAY-POLICY-INVALID', run: () => {
    const bad = { ...policy, rules: [{ failureClass: 'TIMEOUT' as const, disposition: 'RETRY' as const, retryDelaySeconds: 61 }] };
    const v = validateAsyncRetryPolicy(bad);
    assert(v.status === 'INVALID' && v.errors.some((e) => e.startsWith('RETRY_DELAY_EXCEEDS_POLICY')), 'delay over policy must fail');
  }},
  { id: 'AR-09-DLQ-PRESERVES-TENANT-EVENT-REFS', run: () => {
    const d = buildDeadLetterRecord({ envelope, serverResolvedIntegration: binding, failureClass: 'SCHEMA_MISMATCH', failedAttempt: 1, quarantinedAt: utcTimestamp('2026-08-09T07:01:00Z'), policyRef: policy.policyRef });
    assert(d?.merchantWorkspaceId === envelope.merchantWorkspaceId && d.originalEventId === envelope.eventId && d.originalTopic === envelope.topic, 'DLQ must preserve tenant/event refs');
  }},
  { id: 'AR-10-DLQ-USES-SAFE-REF-ONLY', run: () => {
    const d = buildDeadLetterRecord({ envelope, serverResolvedIntegration: binding, failureClass: 'SCHEMA_MISMATCH', failedAttempt: 1, quarantinedAt: utcTimestamp('2026-08-09T07:01:00Z'), policyRef: policy.policyRef });
    const encoded = JSON.stringify(d);
    assert(encoded.includes('safe-ref:evt-1') && !/rawPayload|accessToken|secretValue|authorizationHeader/i.test(encoded), 'DLQ contract must expose safe references only');
  }},
  { id: 'AR-11-EMPTY-SAFE-REF-REFUSED', run: () => {
    const d = buildDeadLetterRecord({ envelope: { ...envelope, safePayloadRef: '' }, serverResolvedIntegration: binding, failureClass: 'SCHEMA_MISMATCH', failedAttempt: 1, quarantinedAt: utcTimestamp('2026-08-09T07:01:00Z'), policyRef: policy.policyRef });
    assert(d === null, 'empty safe payload ref must be refused');
  }},
  { id: 'AR-12-NONRETRY-RULE-CANNOT-CARRY-DELAY', run: () => {
    const bad: AsyncRetryPolicy = { ...policy, rules: [{ failureClass: 'SCHEMA_MISMATCH', disposition: 'QUARANTINE', retryDelaySeconds: 1 }] };
    const v = validateAsyncRetryPolicy(bad);
    assert(v.status === 'INVALID' && v.errors.some((e) => e.startsWith('NON_RETRY_DELAY_FORBIDDEN')), 'quarantine rule cannot hide retry delay');
  }},
  { id: 'AR-13-INTEGRATION-BOUND-ENVELOPE-REQUIRES-CURRENT-BINDING', run: () => {
    const v = validateAsyncEventTenantBinding({ envelope });
    const d = buildDeadLetterRecord({ envelope, failureClass: 'SCHEMA_MISMATCH', failedAttempt: 1, quarantinedAt: utcTimestamp('2026-08-09T07:01:00Z'), policyRef: policy.policyRef });
    assert(v.status === 'INVALID' && v.reason === 'INTEGRATION_BINDING_REQUIRED' && d === null, 'integration-bound event must not be quarantined under unverified tenant binding');
  }},
  { id: 'AR-14-CROSS-WORKSPACE-INTEGRATION-BINDING-REFUSED', run: () => {
    const wrong: ServerResolvedAsyncIntegrationBinding = { integrationId: envelope.integrationId!, merchantWorkspaceId: internalId('ws-b', 'MerchantWorkspace') };
    const v = validateAsyncEventTenantBinding({ envelope, serverResolvedIntegration: wrong });
    const d = buildDeadLetterRecord({ envelope, serverResolvedIntegration: wrong, failureClass: 'SCHEMA_MISMATCH', failedAttempt: 1, quarantinedAt: utcTimestamp('2026-08-09T07:01:00Z'), policyRef: policy.policyRef });
    assert(v.status === 'INVALID' && v.reason === 'INTEGRATION_WORKSPACE_MISMATCH' && d === null, 'cross-workspace binding must fail closed');
  }},
  { id: 'AR-15-INTEGRATION-ID-MISMATCH-REFUSED', run: () => {
    const wrong: ServerResolvedAsyncIntegrationBinding = { integrationId: internalId('int-b', 'Integration'), merchantWorkspaceId: envelope.merchantWorkspaceId };
    const v = validateAsyncEventTenantBinding({ envelope, serverResolvedIntegration: wrong });
    const d = buildDeadLetterRecord({ envelope, serverResolvedIntegration: wrong, failureClass: 'SCHEMA_MISMATCH', failedAttempt: 1, quarantinedAt: utcTimestamp('2026-08-09T07:01:00Z'), policyRef: policy.policyRef });
    assert(v.status === 'INVALID' && v.reason === 'INTEGRATION_ID_MISMATCH' && d === null, 'wrong Integration ID must fail closed');
  }},
  { id: 'AR-16-INTEGRATIONLESS-INTERNAL-EVENT-NEEDS-NO-BINDING', run: () => {
    const { integrationId: _droppedIntegrationId, ...internalEnvelope } = envelope;
    const v = validateAsyncEventTenantBinding({ envelope: internalEnvelope });
    const d = buildDeadLetterRecord({ envelope: internalEnvelope, failureClass: 'SCHEMA_MISMATCH', failedAttempt: 1, quarantinedAt: utcTimestamp('2026-08-09T07:01:00Z'), policyRef: policy.policyRef });
    assert(v.status === 'VALID' && d !== null && d.integrationId === undefined, 'integrationless internal event should remain supported');
  }},
];

for (const testCase of cases) {
  testCase.run();
  console.log(`PASS ${testCase.id}`);
}
console.log(`PASS ${cases.length}/${cases.length} async retry/DLQ source scenarios`);
