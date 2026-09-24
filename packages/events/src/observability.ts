import type {
  CorrelationId,
  MerchantWorkspaceId,
  RequestId,
  RunId,
  UtcTimestamp,
} from '../../domain/src';
import type { ErrorCode, ErrorDescriptor } from '../../domain/src/errors';

export const LOG_SEVERITIES = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;
export type LogSeverity = (typeof LOG_SEVERITIES)[number];

/**
 * Intentionally has no raw text/payload/customer/contact fields. Any detailed data must live behind
 * a separately governed safe reference. This keeps normal operational logs PII/secret-minimized.
 */
export interface StructuredLogRecord {
  readonly occurredAt: UtcTimestamp;
  readonly severity: LogSeverity;
  readonly eventName: string;
  readonly merchantWorkspaceId?: MerchantWorkspaceId;
  readonly requestId?: RequestId;
  readonly runId?: RunId;
  readonly correlationId?: CorrelationId;
  readonly resultCode?: string;
  readonly errorCode?: ErrorCode;
  readonly providerType?: string;
  readonly providerOperation?: string;
  readonly actionName?: string;
  readonly safeDetailRef?: string;
}

export const METRIC_NAMES = [
  'inbound_event_count',
  'webhook_verification_failure_count',
  'duplicate_event_count',
  'outbound_send_attempt_count',
  'outbound_send_success_count',
  'outbound_send_failure_count',
  'provider_latency_ms',
  'provider_error_count',
  'provider_rate_limit_count',
  'truth_unknown_count',
  'truth_conflict_count',
  'grounded_answer_pass_count',
  'grounded_answer_fail_count',
  'handoff_count',
  'conversation_ownership_conflict_count',
  'connector_freshness_age_ms',
  'post_read_mismatch_count',
  'usage_quantity',
  'provider_cost_minor',
  'security_deny_count',
  'approval_required_count',
] as const;
export type MetricName = (typeof METRIC_NAMES)[number];

export interface MetricPoint {
  readonly name: MetricName;
  readonly value: number;
  readonly occurredAt: UtcTimestamp;
  readonly merchantWorkspaceId?: MerchantWorkspaceId;
  readonly runId?: RunId;
  readonly correlationId?: CorrelationId;
  readonly providerType?: string;
  readonly operation?: string;
}

export interface RunCorrelationLookup {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly runId?: RunId;
  readonly correlationId?: CorrelationId;
}

export function assertValidLookup(input: RunCorrelationLookup): void {
  if (!input.runId && !input.correlationId) {
    throw new Error('Run/correlation lookup requires runId or correlationId');
  }
}

export interface ObservabilityQueryPort {
  findByRunOrCorrelation(input: RunCorrelationLookup): Promise<readonly StructuredLogRecord[]>;
}

function descriptorFor(code: ErrorCode): ErrorDescriptor {
  switch (code) {
    case 'AUTH_TENANT_MISMATCH':
      return { code, retryable: false, customerSafeHandling: 'HIDE_DETAIL', operatorVisibility: 'SECURITY', securitySeverity: 'HIGH', createsEvaluationEvidence: true, createsIncidentEvidence: true };
    case 'AUTH_PERMISSION_DENIED':
    case 'AUTH_APPROVAL_INVALID':
    case 'AUTH_APPROVAL_EXPIRED':
      return { code, retryable: false, customerSafeHandling: 'HIDE_DETAIL', operatorVisibility: 'ELEVATED', securitySeverity: 'MEDIUM', createsEvaluationEvidence: true, createsIncidentEvidence: false };
    case 'AUTH_APPROVAL_REQUIRED':
      return { code, retryable: false, customerSafeHandling: 'SAFE_MESSAGE', operatorVisibility: 'NORMAL', securitySeverity: 'NONE', createsEvaluationEvidence: true, createsIncidentEvidence: false };
    case 'IDENTITY_UNRESOLVED':
    case 'IDENTITY_AMBIGUOUS':
    case 'CUSTOMER_VERIFICATION_INSUFFICIENT':
      return { code, retryable: false, customerSafeHandling: 'HANDOFF', operatorVisibility: 'NORMAL', securitySeverity: 'LOW', createsEvaluationEvidence: true, createsIncidentEvidence: false };
    case 'PROVIDER_RATE_LIMITED':
    case 'PROVIDER_TIMEOUT':
      return { code, retryable: true, customerSafeHandling: 'SAFE_MESSAGE', operatorVisibility: 'ELEVATED', securitySeverity: 'NONE', createsEvaluationEvidence: true, createsIncidentEvidence: false };
    case 'PROVIDER_ACCESS_BLOCKED':
    case 'PROVIDER_AUTH_REVOKED':
    case 'PROVIDER_SCHEMA_MISMATCH':
    case 'PROVIDER_UNSUPPORTED':
      return { code, retryable: false, customerSafeHandling: 'HANDOFF', operatorVisibility: 'ELEVATED', securitySeverity: code === 'PROVIDER_AUTH_REVOKED' ? 'MEDIUM' : 'NONE', createsEvaluationEvidence: true, createsIncidentEvidence: code === 'PROVIDER_SCHEMA_MISMATCH' };
    case 'PROVIDER_STALE_DATA':
      return { code, retryable: 'UNKNOWN', customerSafeHandling: 'HANDOFF', operatorVisibility: 'ELEVATED', securitySeverity: 'NONE', createsEvaluationEvidence: true, createsIncidentEvidence: false };
    case 'TRUTH_MISSING':
    case 'TRUTH_CONFLICT':
    case 'RULE_CONFLICT':
      return { code, retryable: false, customerSafeHandling: 'HANDOFF', operatorVisibility: 'ELEVATED', securitySeverity: 'NONE', createsEvaluationEvidence: true, createsIncidentEvidence: false };
    case 'WEBHOOK_INVALID':
      return { code, retryable: false, customerSafeHandling: 'HIDE_DETAIL', operatorVisibility: 'SECURITY', securitySeverity: 'HIGH', createsEvaluationEvidence: true, createsIncidentEvidence: true };
    case 'EVENT_DUPLICATE':
    case 'EVENT_OUT_OF_ORDER':
    case 'ACTION_IDEMPOTENT_REPLAY':
      return { code, retryable: false, customerSafeHandling: 'HIDE_DETAIL', operatorVisibility: 'NORMAL', securitySeverity: 'NONE', createsEvaluationEvidence: true, createsIncidentEvidence: false };
    case 'ACTION_POSTREAD_MISMATCH':
      return { code, retryable: 'UNKNOWN', customerSafeHandling: 'HANDOFF', operatorVisibility: 'ELEVATED', securitySeverity: 'LOW', createsEvaluationEvidence: true, createsIncidentEvidence: true };
    case 'HANDOFF_OWNERSHIP_CONFLICT':
      return { code, retryable: false, customerSafeHandling: 'HANDOFF', operatorVisibility: 'ELEVATED', securitySeverity: 'LOW', createsEvaluationEvidence: true, createsIncidentEvidence: false };
    case 'AI_OUTPUT_POLICY_FAIL':
    case 'AI_OUTPUT_GROUNDEDNESS_FAIL':
      return { code, retryable: false, customerSafeHandling: 'HANDOFF', operatorVisibility: 'ELEVATED', securitySeverity: code === 'AI_OUTPUT_POLICY_FAIL' ? 'MEDIUM' : 'NONE', createsEvaluationEvidence: true, createsIncidentEvidence: false };
    case 'USAGE_COST_UNKNOWN':
      return { code, retryable: false, customerSafeHandling: 'HIDE_DETAIL', operatorVisibility: 'ELEVATED', securitySeverity: 'NONE', createsEvaluationEvidence: true, createsIncidentEvidence: false };
    case 'INTERNAL_UNEXPECTED':
      return { code, retryable: 'UNKNOWN', customerSafeHandling: 'HANDOFF', operatorVisibility: 'ELEVATED', securitySeverity: 'UNKNOWN', createsEvaluationEvidence: true, createsIncidentEvidence: true };
  }
}

export const ERROR_DESCRIPTORS: Readonly<Record<ErrorCode, ErrorDescriptor>> = Object.freeze({
  AUTH_TENANT_MISMATCH: descriptorFor('AUTH_TENANT_MISMATCH'),
  AUTH_PERMISSION_DENIED: descriptorFor('AUTH_PERMISSION_DENIED'),
  AUTH_APPROVAL_REQUIRED: descriptorFor('AUTH_APPROVAL_REQUIRED'),
  AUTH_APPROVAL_INVALID: descriptorFor('AUTH_APPROVAL_INVALID'),
  AUTH_APPROVAL_EXPIRED: descriptorFor('AUTH_APPROVAL_EXPIRED'),
  IDENTITY_UNRESOLVED: descriptorFor('IDENTITY_UNRESOLVED'),
  IDENTITY_AMBIGUOUS: descriptorFor('IDENTITY_AMBIGUOUS'),
  CUSTOMER_VERIFICATION_INSUFFICIENT: descriptorFor('CUSTOMER_VERIFICATION_INSUFFICIENT'),
  PROVIDER_ACCESS_BLOCKED: descriptorFor('PROVIDER_ACCESS_BLOCKED'),
  PROVIDER_AUTH_REVOKED: descriptorFor('PROVIDER_AUTH_REVOKED'),
  PROVIDER_RATE_LIMITED: descriptorFor('PROVIDER_RATE_LIMITED'),
  PROVIDER_TIMEOUT: descriptorFor('PROVIDER_TIMEOUT'),
  PROVIDER_SCHEMA_MISMATCH: descriptorFor('PROVIDER_SCHEMA_MISMATCH'),
  PROVIDER_UNSUPPORTED: descriptorFor('PROVIDER_UNSUPPORTED'),
  PROVIDER_STALE_DATA: descriptorFor('PROVIDER_STALE_DATA'),
  TRUTH_MISSING: descriptorFor('TRUTH_MISSING'),
  TRUTH_CONFLICT: descriptorFor('TRUTH_CONFLICT'),
  RULE_CONFLICT: descriptorFor('RULE_CONFLICT'),
  WEBHOOK_INVALID: descriptorFor('WEBHOOK_INVALID'),
  EVENT_DUPLICATE: descriptorFor('EVENT_DUPLICATE'),
  EVENT_OUT_OF_ORDER: descriptorFor('EVENT_OUT_OF_ORDER'),
  ACTION_IDEMPOTENT_REPLAY: descriptorFor('ACTION_IDEMPOTENT_REPLAY'),
  ACTION_POSTREAD_MISMATCH: descriptorFor('ACTION_POSTREAD_MISMATCH'),
  HANDOFF_OWNERSHIP_CONFLICT: descriptorFor('HANDOFF_OWNERSHIP_CONFLICT'),
  AI_OUTPUT_POLICY_FAIL: descriptorFor('AI_OUTPUT_POLICY_FAIL'),
  AI_OUTPUT_GROUNDEDNESS_FAIL: descriptorFor('AI_OUTPUT_GROUNDEDNESS_FAIL'),
  USAGE_COST_UNKNOWN: descriptorFor('USAGE_COST_UNKNOWN'),
  INTERNAL_UNEXPECTED: descriptorFor('INTERNAL_UNEXPECTED'),
} satisfies Record<ErrorCode, ErrorDescriptor>);

export function errorDescriptor(code: ErrorCode): ErrorDescriptor {
  return ERROR_DESCRIPTORS[code];
}
