import { ERROR_CODES, internalId, localeTag, operationalStatus, utcTimestamp } from '../../packages/domain/src';
import { ERROR_DESCRIPTORS, METRIC_NAMES, assertValidLookup, type StructuredLogRecord, type MetricPoint } from '../../packages/events/src';
import { revalidateBeforeDispatch } from '../../apps/api/src/dispatch-safety';
import { AtomicQuotaLedger } from '../../packages/events/src/quota-ledger';

const now = utcTimestamp('2026-08-07T18:50:00Z');
const ws = internalId('ws-obs', 'MerchantWorkspace');
const run = internalId('run-obs', 'Run');
const corr = internalId('corr-obs', 'Correlation');
const jobIdForCorrelation = internalId('job-obs', 'Job');

const record: StructuredLogRecord = {
  occurredAt: now,
  severity: 'INFO',
  eventName: 'grounded_response.completed',
  merchantWorkspaceId: ws,
  runId: run,
  jobId: jobIdForCorrelation,
  correlationId: corr,
  resultCode: 'SEND_CANDIDATE_READY',
  providerType: 'AI',
  providerOperation: 'generate_response',
  safeDetailRef: 'eval:run-obs',
};

const metricPoint: MetricPoint = {
  name: 'job_dispatch_denied_count',
  value: 1,
  occurredAt: now,
  merchantWorkspaceId: ws,
  jobId: jobIdForCorrelation,
};

let emptyLookupRejected = false;
try { assertValidLookup({ merchantWorkspaceId: ws }); } catch { emptyLookupRejected = true; }
let runLookupAccepted = true;
try { assertValidLookup({ merchantWorkspaceId: ws, runId: run }); } catch { runLookupAccepted = false; }

const json = JSON.stringify(record);
const forbiddenFieldNames = ['rawPayload', 'messageText', 'customerEmail', 'customerPhone', 'accessToken', 'secret'];
const noForbiddenFields = forbiddenFieldNames.every((field) => !json.includes(field));
const allDescriptors = ERROR_CODES.every((code) => ERROR_DESCRIPTORS[code]?.code === code);
const webhookSecurity = ERROR_DESCRIPTORS.WEBHOOK_INVALID.securitySeverity;
const providerTimeoutRetry = ERROR_DESCRIPTORS.PROVIDER_TIMEOUT.retryable;

// RUN-1 CR-V1 Continuous Execution Contract, RUN-2: Job/Run/outbox/quota/
// dispatch-safety correlation + safe error taxonomy extension.
const jobMetricsPresent = ['job_dispatch_attempt_count', 'job_dispatch_denied_count', 'outbox_delivery_count', 'outbox_replay_prevented_count', 'quota_reservation_denied_count']
  .every((name) => (METRIC_NAMES as readonly string[]).includes(name));
const metricJson = JSON.stringify(metricPoint);
const metricNoForbiddenFields = forbiddenFieldNames.every((field) => !metricJson.includes(field));

const dispatchDenied = revalidateBeforeDispatch({
  actionName: 'unregistered.action.does_not_exist',
  requestedMaturity: 'READ',
  executionContext: {
    actorUserId: internalId('user-obs', 'User'),
    actorOrganizationId: internalId('org-obs', 'Organization'),
    actorOrganizationType: 'STANDALONE_MERCHANT',
    membershipId: internalId('membership-obs', 'Membership'),
    membershipStatus: operationalStatus('ACTIVE'),
    activeMerchantWorkspaceId: ws,
    permissionSnapshotRef: 'perm-snapshot-obs',
    permissionGrants: [],
    assuranceLevel: 'STANDARD',
    channel: 'web',
    requestId: internalId('request-obs', 'Request'),
    runId: run,
    locale: localeTag('tr-TR'),
    occurredAt: now,
  },
  target: { owningOrganizationId: internalId('org-obs', 'Organization'), merchantWorkspaceId: ws, resourceType: 'conversation', resourceId: 'conv-obs' },
  actionPlanId: internalId('plan-obs', 'ActionPlan'),
  payloadHash: 'sha256:obs',
  merchantWorkspaceId: ws,
  now,
  environment: 'STAGING',
  configVersion: 'cfg-1',
  releaseFlagEnabled: true,
  switches: [],
});
const dispatchDeniedHasCode = dispatchDenied.decision === 'DENY' && dispatchDenied.code === 'DISPATCH_REVALIDATION_DENIED';

const ledger = new AtomicQuotaLedger();
const quotaDenied = ledger.reserveAtomic({
  quotaReservationId: internalId('qr-obs', 'QuotaReservation'),
  merchantWorkspaceId: ws,
  budgetKey: 'obs.budget',
  amount: 1n,
  now,
});
const quotaDeniedHasCode = quotaDenied.decision === 'DENY' && quotaDenied.code === 'QUOTA_RESERVATION_DENIED';

const scenarios = [
  { id: 'P0-021-ERROR-DESCRIPTOR-COVERAGE', actual: allDescriptors, expected: true },
  { id: 'TM-14-LOG-SHAPE-NO-RAW-PII-SECRET-FIELDS', actual: noForbiddenFields, expected: true },
  { id: 'P0-021-RUN-LOOKUP-REQUIRES-KEY', actual: emptyLookupRejected, expected: true },
  { id: 'P0-021-RUN-LOOKUP-ACCEPTS-RUN', actual: runLookupAccepted, expected: true },
  { id: 'TM-05-WEBHOOK-INVALID-SECURITY-HIGH', actual: webhookSecurity, expected: 'HIGH' },
  { id: 'P0-021-PROVIDER-TIMEOUT-RETRYABLE', actual: providerTimeoutRetry, expected: true },
  { id: 'RUN2-JOB-CORRELATION-METRICS-PRESENT', actual: jobMetricsPresent, expected: true },
  { id: 'RUN2-METRIC-POINT-NO-FORBIDDEN-FIELDS', actual: metricNoForbiddenFields, expected: true },
  { id: 'RUN2-DISPATCH-DENIAL-CARRIES-ERROR-TAXONOMY-CODE', actual: dispatchDeniedHasCode, expected: true },
  { id: 'RUN2-QUOTA-DENIAL-CARRIES-ERROR-TAXONOMY-CODE', actual: quotaDeniedHasCode, expected: true },
] as const;

const failures = scenarios.filter((s) => s.actual !== s.expected);
if (failures.length) {
  for (const failure of failures) console.error('FAIL', failure);
  throw new Error(`${failures.length}/${scenarios.length} observability scenarios failed`);
}
console.log(`PASS ${scenarios.length}/${scenarios.length}`);
for (const scenario of scenarios) console.log(`PASS ${scenario.id}`);
