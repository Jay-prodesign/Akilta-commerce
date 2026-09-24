import { ERROR_CODES, internalId, utcTimestamp } from '../../packages/domain/src';
import { ERROR_DESCRIPTORS, assertValidLookup, type StructuredLogRecord } from '../../packages/events/src';

const now = utcTimestamp('2026-08-07T18:50:00Z');
const ws = internalId('ws-obs', 'MerchantWorkspace');
const run = internalId('run-obs', 'Run');
const corr = internalId('corr-obs', 'Correlation');

const record: StructuredLogRecord = {
  occurredAt: now,
  severity: 'INFO',
  eventName: 'grounded_response.completed',
  merchantWorkspaceId: ws,
  runId: run,
  correlationId: corr,
  resultCode: 'SEND_CANDIDATE_READY',
  providerType: 'AI',
  providerOperation: 'generate_response',
  safeDetailRef: 'eval:run-obs',
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

const scenarios = [
  { id: 'P0-021-ERROR-DESCRIPTOR-COVERAGE', actual: allDescriptors, expected: true },
  { id: 'TM-14-LOG-SHAPE-NO-RAW-PII-SECRET-FIELDS', actual: noForbiddenFields, expected: true },
  { id: 'P0-021-RUN-LOOKUP-REQUIRES-KEY', actual: emptyLookupRejected, expected: true },
  { id: 'P0-021-RUN-LOOKUP-ACCEPTS-RUN', actual: runLookupAccepted, expected: true },
  { id: 'TM-05-WEBHOOK-INVALID-SECURITY-HIGH', actual: webhookSecurity, expected: 'HIGH' },
  { id: 'P0-021-PROVIDER-TIMEOUT-RETRYABLE', actual: providerTimeoutRetry, expected: true },
] as const;

const failures = scenarios.filter((s) => s.actual !== s.expected);
if (failures.length) {
  for (const failure of failures) console.error('FAIL', failure);
  throw new Error(`${failures.length}/${scenarios.length} observability scenarios failed`);
}
console.log(`PASS ${scenarios.length}/${scenarios.length}`);
for (const scenario of scenarios) console.log(`PASS ${scenario.id}`);
