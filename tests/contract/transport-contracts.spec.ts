import { internalId, idempotencyKey } from '../../packages/domain/src/ids';
import { providerTimestamp, utcTimestamp } from '../../packages/domain/src/time';
import {
  API_CONTRACT_VERSION,
  PUBLIC_FIELD_ERROR_CODES,
  CONTROL_CENTER_OPERATIONS,
  actionResponseEnvelope,
  opaqueCursor,
  safeHttpErrorEnvelope,
  transportOperation,
  validateClientAuthorityPayload,
  validateDecodedCursorScope,
  type AsyncEventEnvelope,
} from '../../apps/api/src/transport-contracts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectThrow(run: () => void, message: string): void {
  let threw = false;
  try { run(); } catch { threw = true; }
  assert(threw, message);
}

const workspaceId = internalId('ws-1', 'MerchantWorkspace');
const actionId = internalId('act-1', 'Action');
const actionPlanId = internalId('plan-1', 'ActionPlan');
const requestId = internalId('req-1', 'Request');

const cases: Array<[string, () => void]> = [
  ['IF-CONTRACT-VERSION-V1', () => assert(API_CONTRACT_VERSION === 'v1', 'contract version drifted')],
  ['IF-ROUTE-REGISTRY-UNIQUE', () => {
    const keys = new Set<string>();
    const methodPaths = new Set<string>();
    for (const operation of CONTROL_CENTER_OPERATIONS) {
      assert(!keys.has(operation.key), `duplicate operation key ${operation.key}`);
      assert(!methodPaths.has(`${operation.method} ${operation.path}`), `duplicate route ${operation.method} ${operation.path}`);
      keys.add(operation.key); methodPaths.add(`${operation.method} ${operation.path}`);
    }
  }],
  ['IF-ALL-ROUTES-REQUIRE-SERVER-WORKSPACE-AUTHORITY', () => assert(CONTROL_CENTER_OPERATIONS.every((item) => item.serverResolvedWorkspaceRequired), 'client workspace became authority')],
  ['IF-EXTERNAL-EFFECT-REQUIRES-IDEMPOTENCY', () => {
    const external = CONTROL_CENTER_OPERATIONS.filter((item) => item.effect === 'EXTERNAL_EFFECT');
    assert(external.length > 0 && external.every((item) => item.idempotencyRequired), 'external effect lacks idempotency requirement');
  }],
  ['IF-MESSAGE-SEND-REGISTERED-AS-EXTERNAL', () => {
    const send = transportOperation('message.send');
    assert(send?.effect === 'EXTERNAL_EFFECT' && send.minimumPermission === 'conversation:respond', 'message send transport contract unsafe');
  }],
  ['IF-REQUESTED-WORKSPACE-TARGET-IS-ALLOWED-NOT-AUTHORITY', () => {
    const result = validateClientAuthorityPayload({ requestedMerchantWorkspaceId: workspaceId, reason: 'support' });
    assert(result.ok, 'requested workspace target incorrectly rejected');
  }],
  ['IF-CLIENT-PERMISSION-INJECTION-DENIED', () => {
    const result = validateClientAuthorityPayload({ permissions: ['security:manage'] });
    assert(!result.ok && result.rejectedPath === '$.permissions', 'permission injection accepted');
  }],
  ['IF-NESTED-APPROVAL-CAPABILITY-INJECTION-DENIED', () => {
    const result = validateClientAuthorityPayload({ payload: { meta: { providerCapability: 'AVAILABLE' } } });
    assert(!result.ok && result.rejectedPath?.endsWith('.providerCapability'), 'provider capability injection accepted');
  }],
  ['IF-CREDENTIAL-INJECTION-DENIED', () => {
    const result = validateClientAuthorityPayload({ settings: [{ accessToken: 'secret-value' }] });
    assert(!result.ok && result.rejectedPath === '$.settings[0].accessToken', 'credential injection accepted');
  }],
  ['IF-SAFE-ERROR-ENVELOPE-IS-IMMUTABLE', () => {
    const envelope = safeHttpErrorEnvelope({ code: 'AUTH_PERMISSION_DENIED', requestId, retryable: false, requiredAction: 'NONE', fieldErrors: ['INVALID'] });
    assert(Object.isFrozen(envelope) && Object.isFrozen(envelope.fieldErrors), 'safe error envelope mutable');
  }],
  ['IF-SAFE-ERROR-IGNORES-CALLER-MESSAGE-TEXT', () => {
    const envelope = safeHttpErrorEnvelope({
      code: 'AUTH_PERMISSION_DENIED', requestId, retryable: false, requiredAction: 'NONE', locale: 'en',
      message: 'accessToken=super-secret-raw-exception',
    } as Parameters<typeof safeHttpErrorEnvelope>[0] & { message: string });
    assert(envelope.message === 'The action could not be completed.', 'caller message became public response text');
    assert(!envelope.message.includes('secret') && !envelope.message.includes('accessToken'), 'caller secret leaked into public message');
  }],
  ['IF-SAFE-ERROR-LOCALIZES-FROM-FIXED-CATALOG', () => {
    const tr = safeHttpErrorEnvelope({ code: 'AUTH_APPROVAL_REQUIRED', requestId, retryable: false, requiredAction: 'REQUEST_APPROVAL', locale: 'tr' });
    const en = safeHttpErrorEnvelope({ code: 'AUTH_APPROVAL_REQUIRED', requestId, retryable: false, requiredAction: 'REQUEST_APPROVAL', locale: 'en' });
    assert(tr.message === 'Bu işlem için onay gerekiyor.' && en.message === 'Approval is required for this action.', 'fixed safe locale catalog drifted');
  }],
  ['IF-PUBLIC-FIELD-ERRORS-ARE-BOUNDED-CODES', () => {
    assert(PUBLIC_FIELD_ERROR_CODES.includes('INVALID'), 'bounded field code catalog missing');
    expectThrow(() => safeHttpErrorEnvelope({ code: 'AUTH_PERMISSION_DENIED', requestId, retryable: false, requiredAction: 'NONE', fieldErrors: ['rawException=secret'] }), 'arbitrary field-error text accepted');
  }],
  ['IF-OPAQUE-CURSOR-REJECTS-EMPTY', () => expectThrow(() => opaqueCursor('  '), 'empty cursor accepted')],
  ['IF-CURSOR-SCOPE-VALID-SAME-WORKSPACE-QUERY', () => {
    const result = validateDecodedCursorScope(
      { merchantWorkspaceId: workspaceId, queryScopeRef: 'conversation.list:v1:filter-a', positionRef: 'position-2', integrityState: 'VERIFIED' },
      { merchantWorkspaceId: workspaceId, queryScopeRef: 'conversation.list:v1:filter-a' },
    );
    assert(result.ok && result.positionRef === 'position-2', 'valid cursor scope rejected');
  }],
  ['IF-CURSOR-INTEGRITY-MUST-BE-VERIFIED', () => {
    const result = validateDecodedCursorScope(
      { merchantWorkspaceId: workspaceId, queryScopeRef: 'conversation.list:v1:filter-a', positionRef: 'position-2', integrityState: 'UNVERIFIED' },
      { merchantWorkspaceId: workspaceId, queryScopeRef: 'conversation.list:v1:filter-a' },
    );
    assert(!result.ok && result.reason === 'CURSOR_INTEGRITY_UNVERIFIED', 'unverified cursor accepted');
  }],
  ['IF-CURSOR-CANNOT-CROSS-WORKSPACE', () => {
    const otherWorkspaceId = internalId('ws-2', 'MerchantWorkspace');
    const result = validateDecodedCursorScope(
      { merchantWorkspaceId: otherWorkspaceId, queryScopeRef: 'conversation.list:v1:filter-a', positionRef: 'position-2', integrityState: 'VERIFIED' },
      { merchantWorkspaceId: workspaceId, queryScopeRef: 'conversation.list:v1:filter-a' },
    );
    assert(!result.ok && result.reason === 'CURSOR_WORKSPACE_MISMATCH', 'cross-workspace cursor accepted');
  }],
  ['IF-CURSOR-CANNOT-CHANGE-QUERY-SCOPE', () => {
    const result = validateDecodedCursorScope(
      { merchantWorkspaceId: workspaceId, queryScopeRef: 'conversation.list:v1:filter-b', positionRef: 'position-2', integrityState: 'VERIFIED' },
      { merchantWorkspaceId: workspaceId, queryScopeRef: 'conversation.list:v1:filter-a' },
    );
    assert(!result.ok && result.reason === 'CURSOR_QUERY_SCOPE_MISMATCH', 'cursor crossed query scope');
  }],
  ['IF-CURSOR-EMPTY-POSITION-FAILS-CLOSED', () => {
    const result = validateDecodedCursorScope(
      { merchantWorkspaceId: workspaceId, queryScopeRef: 'conversation.list:v1:filter-a', positionRef: '  ', integrityState: 'VERIFIED' },
      { merchantWorkspaceId: workspaceId, queryScopeRef: 'conversation.list:v1:filter-a' },
    );
    assert(!result.ok && result.reason === 'CURSOR_POSITION_INVALID', 'empty decoded cursor position accepted');
  }],
  ['IF-ASYNC-ENVELOPE-ALLOWS-MISSING-SOURCE-TIMESTAMP-BUT-REQUIRES-OBSERVED-AT', () => {
    const envelope: AsyncEventEnvelope = {
      schemaVersion: '1', eventId: internalId('event-1', 'OperationalEvent'), merchantWorkspaceId: workspaceId,
      source: 'INTERNAL', observedAt: utcTimestamp('2026-08-10T09:00:00.000Z'),
      correlationId: internalId('corr-1', 'Correlation'), idempotencyKey: idempotencyKey('idem-1'), payloadType: 'TEST', payload: Object.freeze({ ref: 'safe' }),
    };
    assert(envelope.sourceTimestamp === undefined && envelope.observedAt.length > 0, 'source timestamp semantics regressed');
  }],
  ['IF-ASYNC-ENVELOPE-PRESERVES-PROVIDER-SOURCE-TIMESTAMP-WHEN-EVIDENCED', () => {
    const envelope: AsyncEventEnvelope = {
      schemaVersion: '1', eventId: internalId('event-2', 'OperationalEvent'), merchantWorkspaceId: workspaceId,
      source: 'PROVIDER', sourceTimestamp: providerTimestamp('provider-ts'), observedAt: utcTimestamp('2026-08-10T09:00:00.000Z'),
      correlationId: internalId('corr-2', 'Correlation'), idempotencyKey: idempotencyKey('idem-2'), payloadType: 'TEST', payload: Object.freeze({ ref: 'safe' }),
    };
    assert(envelope.sourceTimestamp === 'provider-ts', 'provider timestamp not preserved');
  }],
  ['IF-SUCCEEDED-CANNOT-HIDE-POSTREAD-MISMATCH', () => expectThrow(() => actionResponseEnvelope({ actionId, actionPlanId, status: 'SUCCEEDED', postReadState: 'VERIFIED_MISMATCH', warnings: [] }), 'post-read mismatch exposed as success')],
  ['IF-SUCCEEDED-VERIFIED-MATCH-IS-VALID', () => {
    const result = actionResponseEnvelope({ actionId, actionPlanId, status: 'SUCCEEDED', resultRef: 'result-1', postReadState: 'VERIFIED_MATCH', warnings: [] });
    assert(result.status === 'SUCCEEDED' && result.postReadState === 'VERIFIED_MATCH' && Object.isFrozen(result.warnings), 'verified success invalid');
  }],
];

for (const [name, run] of cases) { run(); console.log(`PASS ${name}`); }
console.log(`PASS ${cases.length}/${cases.length} transport contract scenarios`);
