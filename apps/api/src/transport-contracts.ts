import type { ErrorCode } from '../../../packages/domain/src/errors';
import type {
  ActionId,
  ActionPlanId,
  CorrelationId,
  EventId,
  IdempotencyKey,
  IntegrationId,
  MerchantWorkspaceId,
  RequestId,
  RunId,
} from '../../../packages/domain/src/ids';
import type { ProviderTimestamp, UtcTimestamp } from '../../../packages/domain/src/time';
import type { Permission } from '../../../packages/authz/src/permissions';

export const API_CONTRACT_VERSION = 'v1' as const;
export type ApiContractVersion = typeof API_CONTRACT_VERSION;

export const REQUIRED_ACTIONS = [
  'VERIFY_CUSTOMER',
  'REQUEST_APPROVAL',
  'RECONNECT_PROVIDER',
  'RETRY_LATER',
  'CONTACT_SUPPORT',
  'NONE',
] as const;
export type RequiredAction = (typeof REQUIRED_ACTIONS)[number];

/** Requested target only; the server resolver must authorize it before use. */
export interface ClientRequestedWorkspaceTarget {
  readonly requestedMerchantWorkspaceId?: MerchantWorkspaceId;
}

export const PUBLIC_ERROR_LOCALES = ['tr', 'en'] as const;
export type PublicErrorLocale = (typeof PUBLIC_ERROR_LOCALES)[number];

export const PUBLIC_FIELD_ERROR_CODES = [
  'REQUIRED',
  'INVALID',
  'UNSUPPORTED',
  'TOO_LONG',
  'OUT_OF_RANGE',
] as const;
export type PublicFieldErrorCode = (typeof PUBLIC_FIELD_ERROR_CODES)[number];

const PUBLIC_ERROR_MESSAGES: Readonly<Record<PublicErrorLocale, Readonly<Record<RequiredAction, string>>>> = Object.freeze({
  tr: Object.freeze({
    VERIFY_CUSTOMER: 'Devam etmek için müşteri doğrulaması gerekiyor.',
    REQUEST_APPROVAL: 'Bu işlem için onay gerekiyor.',
    RECONNECT_PROVIDER: 'Bağlantının yeniden doğrulanması gerekiyor.',
    RETRY_LATER: 'İşlem şu anda tamamlanamadı. Lütfen daha sonra tekrar deneyin.',
    CONTACT_SUPPORT: 'İşlem tamamlanamadı. Destek gerekebilir.',
    NONE: 'İşlem tamamlanamadı.',
  }),
  en: Object.freeze({
    VERIFY_CUSTOMER: 'Customer verification is required to continue.',
    REQUEST_APPROVAL: 'Approval is required for this action.',
    RECONNECT_PROVIDER: 'The connection needs to be verified again.',
    RETRY_LATER: 'The action could not be completed right now. Please try again later.',
    CONTACT_SUPPORT: 'The action could not be completed. Support may be required.',
    NONE: 'The action could not be completed.',
  }),
});

export interface SafeHttpErrorInput {
  readonly code: ErrorCode;
  readonly requestId: RequestId;
  readonly retryable: boolean;
  readonly requiredAction: RequiredAction;
  readonly locale?: PublicErrorLocale;
  /** Bounded symbolic validation codes only; no caller-supplied field names or error text. */
  readonly fieldErrors?: readonly PublicFieldErrorCode[];
}

export interface SafeHttpErrorEnvelope {
  readonly code: ErrorCode;
  readonly message: string;
  readonly requestId: RequestId;
  readonly retryable: boolean;
  readonly requiredAction: RequiredAction;
  readonly fieldErrors?: readonly PublicFieldErrorCode[];
}

function assertPublicFieldErrors(value: readonly PublicFieldErrorCode[]): void {
  const allowed = new Set<string>(PUBLIC_FIELD_ERROR_CODES);
  for (const code of value as readonly unknown[]) {
    if (typeof code !== 'string' || !allowed.has(code)) {
      throw new Error('Public field errors must use bounded symbolic codes');
    }
  }
}

/**
 * Public HTTP error text is safe by construction: callers provide codes/metadata, never response text.
 * Extra runtime properties (for example a raw exception or token-bearing `message`) are ignored.
 */
export function safeHttpErrorEnvelope(input: SafeHttpErrorInput): SafeHttpErrorEnvelope {
  const locale = input.locale ?? 'tr';
  const fieldErrors = input.fieldErrors;
  if (fieldErrors !== undefined) assertPublicFieldErrors(fieldErrors);
  return Object.freeze({
    code: input.code,
    message: PUBLIC_ERROR_MESSAGES[locale][input.requiredAction],
    requestId: input.requestId,
    retryable: input.retryable,
    requiredAction: input.requiredAction,
    ...(fieldErrors !== undefined ? { fieldErrors: Object.freeze([...fieldErrors]) } : {}),
  });
}

export type HttpMethod = 'GET' | 'POST';
export type TransportEffect = 'READ_ONLY' | 'INTERNAL_STATE_CHANGE' | 'EXTERNAL_EFFECT';

export interface TransportOperationDefinition {
  readonly key: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly minimumPermission: Permission;
  readonly effect: TransportEffect;
  readonly idempotencyRequired: boolean;
  readonly serverResolvedWorkspaceRequired: true;
}

export const CONTROL_CENTER_OPERATIONS = Object.freeze([
  { key: 'workspace.readiness', method: 'GET', path: '/v1/workspaces/{workspace}/readiness', minimumPermission: 'merchant:read', effect: 'READ_ONLY', idempotencyRequired: false, serverResolvedWorkspaceRequired: true },
  { key: 'integration.list', method: 'GET', path: '/v1/integrations', minimumPermission: 'integration:read', effect: 'READ_ONLY', idempotencyRequired: false, serverResolvedWorkspaceRequired: true },
  { key: 'integration.capabilities', method: 'GET', path: '/v1/integrations/{id}/capabilities', minimumPermission: 'integration:read', effect: 'READ_ONLY', idempotencyRequired: false, serverResolvedWorkspaceRequired: true },
  { key: 'conversation.list', method: 'GET', path: '/v1/conversations', minimumPermission: 'conversation:read', effect: 'READ_ONLY', idempotencyRequired: false, serverResolvedWorkspaceRequired: true },
  { key: 'conversation.get', method: 'GET', path: '/v1/conversations/{id}', minimumPermission: 'conversation:read', effect: 'READ_ONLY', idempotencyRequired: false, serverResolvedWorkspaceRequired: true },
  { key: 'customer.context', method: 'GET', path: '/v1/customers/{id}/context', minimumPermission: 'customer:read', effect: 'READ_ONLY', idempotencyRequired: false, serverResolvedWorkspaceRequired: true },
  { key: 'rule.list', method: 'GET', path: '/v1/rules', minimumPermission: 'merchant_rule:read', effect: 'READ_ONLY', idempotencyRequired: false, serverResolvedWorkspaceRequired: true },
  { key: 'rule.get', method: 'GET', path: '/v1/rules/{id}', minimumPermission: 'merchant_rule:read', effect: 'READ_ONLY', idempotencyRequired: false, serverResolvedWorkspaceRequired: true },
  { key: 'approval.list', method: 'GET', path: '/v1/approvals', minimumPermission: 'approval:approve', effect: 'READ_ONLY', idempotencyRequired: false, serverResolvedWorkspaceRequired: true },
  { key: 'approval.get', method: 'GET', path: '/v1/approvals/{id}', minimumPermission: 'approval:approve', effect: 'READ_ONLY', idempotencyRequired: false, serverResolvedWorkspaceRequired: true },
  { key: 'audit.run', method: 'GET', path: '/v1/audit/runs/{run_id}', minimumPermission: 'security:audit_read', effect: 'READ_ONLY', idempotencyRequired: false, serverResolvedWorkspaceRequired: true },
  { key: 'usage.summary', method: 'GET', path: '/v1/usage/summary', minimumPermission: 'analytics:read', effect: 'READ_ONLY', idempotencyRequired: false, serverResolvedWorkspaceRequired: true },
  { key: 'conversation.handoff', method: 'POST', path: '/v1/conversations/{id}/handoff', minimumPermission: 'conversation:assign', effect: 'INTERNAL_STATE_CHANGE', idempotencyRequired: true, serverResolvedWorkspaceRequired: true },
  { key: 'conversation.return_to_ai', method: 'POST', path: '/v1/conversations/{id}/return-to-ai', minimumPermission: 'conversation:assign', effect: 'INTERNAL_STATE_CHANGE', idempotencyRequired: true, serverResolvedWorkspaceRequired: true },
  { key: 'message.draft', method: 'POST', path: '/v1/conversations/{id}/messages/draft', minimumPermission: 'conversation:respond', effect: 'INTERNAL_STATE_CHANGE', idempotencyRequired: true, serverResolvedWorkspaceRequired: true },
  { key: 'message.send', method: 'POST', path: '/v1/conversations/{id}/messages/send', minimumPermission: 'conversation:respond', effect: 'EXTERNAL_EFFECT', idempotencyRequired: true, serverResolvedWorkspaceRequired: true },
  { key: 'rule.candidate', method: 'POST', path: '/v1/rules/candidates', minimumPermission: 'merchant_rule:create', effect: 'INTERNAL_STATE_CHANGE', idempotencyRequired: true, serverResolvedWorkspaceRequired: true },
  { key: 'rule.activate', method: 'POST', path: '/v1/rules/{id}/versions/{version}/activate', minimumPermission: 'merchant_rule:activate', effect: 'INTERNAL_STATE_CHANGE', idempotencyRequired: true, serverResolvedWorkspaceRequired: true },
  { key: 'rule.rollback', method: 'POST', path: '/v1/rules/{id}/rollback', minimumPermission: 'merchant_rule:rollback', effect: 'INTERNAL_STATE_CHANGE', idempotencyRequired: true, serverResolvedWorkspaceRequired: true },
  { key: 'approval.decision', method: 'POST', path: '/v1/approvals/{id}/decision', minimumPermission: 'approval:approve', effect: 'INTERNAL_STATE_CHANGE', idempotencyRequired: true, serverResolvedWorkspaceRequired: true },
  { key: 'integration.reverify', method: 'POST', path: '/v1/integrations/{id}/reverify', minimumPermission: 'integration:read', effect: 'INTERNAL_STATE_CHANGE', idempotencyRequired: true, serverResolvedWorkspaceRequired: true },
] satisfies readonly TransportOperationDefinition[]);

const FORBIDDEN_CLIENT_AUTHORITY_KEYS = new Set([
  'actorUserId',
  'actorOrganizationId',
  'merchantWorkspaceId',
  'permissions',
  'permissionSnapshot',
  'approval',
  'approvalRef',
  'approvalStatus',
  'providerCapability',
  'capabilityAuthority',
  'sessionAssuranceLevel',
  'credential',
  'credentials',
  'accessToken',
  'refreshToken',
  'secret',
  'secretRef',
]);

export interface ClientAuthorityPayloadValidation {
  readonly ok: boolean;
  readonly rejectedPath?: string;
}

export function validateClientAuthorityPayload(value: unknown, path = '$'): ClientAuthorityPayloadValidation {
  if (value === null || typeof value !== 'object') return Object.freeze({ ok: true });
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = validateClientAuthorityPayload(value[index], `${path}[${index}]`);
      if (!result.ok) return result;
    }
    return Object.freeze({ ok: true });
  }
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (FORBIDDEN_CLIENT_AUTHORITY_KEYS.has(key)) return Object.freeze({ ok: false, rejectedPath: nextPath });
    const result = validateClientAuthorityPayload(nested, nextPath);
    if (!result.ok) return result;
  }
  return Object.freeze({ ok: true });
}

export type OpaqueCursor = string & { readonly __opaqueCursor: 'TransportCursor' };
export function opaqueCursor(value: string): OpaqueCursor {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('Cursor must be non-empty');
  return value as OpaqueCursor;
}

/**
 * Server-decoded cursor state. External clients receive only OpaqueCursor; this structure
 * must be produced by the server cursor decode/integrity layer before scope validation.
 */
export interface ServerDecodedCursor {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly queryScopeRef: string;
  readonly positionRef: string;
  readonly integrityState: 'VERIFIED' | 'UNVERIFIED';
}

export interface CursorScopeExpectation {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly queryScopeRef: string;
}

export const CURSOR_SCOPE_REJECTION_REASONS = [
  'CURSOR_INTEGRITY_UNVERIFIED',
  'CURSOR_WORKSPACE_MISMATCH',
  'CURSOR_QUERY_SCOPE_MISMATCH',
  'CURSOR_POSITION_INVALID',
] as const;
export type CursorScopeRejectionReason = (typeof CURSOR_SCOPE_REJECTION_REASONS)[number];

export type CursorScopeValidationResult =
  | Readonly<{ ok: true; positionRef: string }>
  | Readonly<{ ok: false; reason: CursorScopeRejectionReason }>;

/** Fail closed before a decoded pagination cursor can influence a tenant-scoped query. */
export function validateDecodedCursorScope(
  decoded: ServerDecodedCursor,
  expected: CursorScopeExpectation,
): CursorScopeValidationResult {
  if (decoded.integrityState !== 'VERIFIED') {
    return Object.freeze({ ok: false, reason: 'CURSOR_INTEGRITY_UNVERIFIED' });
  }
  if (decoded.merchantWorkspaceId !== expected.merchantWorkspaceId) {
    return Object.freeze({ ok: false, reason: 'CURSOR_WORKSPACE_MISMATCH' });
  }
  if (
    decoded.queryScopeRef.trim().length === 0 ||
    expected.queryScopeRef.trim().length === 0 ||
    decoded.queryScopeRef !== expected.queryScopeRef
  ) {
    return Object.freeze({ ok: false, reason: 'CURSOR_QUERY_SCOPE_MISMATCH' });
  }
  if (decoded.positionRef.trim().length === 0) {
    return Object.freeze({ ok: false, reason: 'CURSOR_POSITION_INVALID' });
  }
  return Object.freeze({ ok: true, positionRef: decoded.positionRef });
}

export interface AsyncEventEnvelope<Payload = Readonly<Record<string, unknown>>> {
  readonly schemaVersion: string;
  readonly eventId: EventId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly integrationId?: IntegrationId;
  readonly source: string;
  readonly sourceEventId?: string;
  readonly sourceTimestamp?: ProviderTimestamp;
  readonly observedAt: UtcTimestamp;
  readonly correlationId: CorrelationId;
  readonly causationEventId?: EventId;
  readonly idempotencyKey: IdempotencyKey;
  readonly priorityClass?: string;
  readonly payloadType: string;
  readonly payload: Payload;
}

export const ACTION_RESPONSE_STATUSES = [
  'PLANNED', 'APPROVAL_REQUIRED', 'AUTHORIZED', 'EXECUTING', 'SUCCEEDED', 'FAILED',
  'COMPENSATION_REQUIRED', 'COMPENSATED', 'BLOCKED',
] as const;
export type ActionResponseStatus = (typeof ACTION_RESPONSE_STATUSES)[number];

export const POST_READ_STATES = ['NOT_REQUIRED', 'PENDING', 'VERIFIED_MATCH', 'VERIFIED_MISMATCH', 'UNKNOWN'] as const;
export type PostReadState = (typeof POST_READ_STATES)[number];

export interface ActionResponseEnvelope {
  readonly actionId: ActionId;
  readonly actionPlanId: ActionPlanId;
  readonly status: ActionResponseStatus;
  readonly resultRef?: string;
  readonly providerRef?: string;
  readonly postReadState: PostReadState;
  readonly warnings: readonly string[];
  readonly nextSafeAction?: string;
  readonly runId?: RunId;
}

export function actionResponseEnvelope(input: ActionResponseEnvelope): ActionResponseEnvelope {
  if (input.status === 'SUCCEEDED' && input.postReadState !== 'NOT_REQUIRED' && input.postReadState !== 'VERIFIED_MATCH') {
    throw new Error('SUCCEEDED cannot be exposed before required post-read verification succeeds');
  }
  return Object.freeze({ ...input, warnings: Object.freeze([...input.warnings]) });
}

export function transportOperation(key: string): TransportOperationDefinition | undefined {
  return CONTROL_CENTER_OPERATIONS.find((operation) => operation.key === key);
}
