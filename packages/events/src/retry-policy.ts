import type { UtcTimestamp } from '../../domain/src';
import { validateAsyncEventTenantBinding, type AsyncEventEnvelope, type LogicalAsyncTopic, type ServerResolvedAsyncIntegrationBinding } from './async-envelope';

export const ASYNC_FAILURE_CLASSES = [
  'RATE_LIMIT',
  'TIMEOUT',
  'TRANSIENT_PROVIDER',
  'SCHEMA_MISMATCH',
  'POISON_PAYLOAD',
  'AUTHENTICITY_INVALID',
  'AUTHORIZATION_DENIED',
  'UNSUPPORTED_OPERATION',
  'UNKNOWN',
] as const;
export type AsyncFailureClass = (typeof ASYNC_FAILURE_CLASSES)[number];

export type FailureDisposition = 'RETRY' | 'QUARANTINE' | 'FAIL_CLOSED';

export interface AsyncFailureRule {
  readonly failureClass: AsyncFailureClass;
  readonly disposition: FailureDisposition;
  /** Required only when disposition=RETRY. Runtime owns the actual timer/backoff implementation. */
  readonly retryDelaySeconds?: number;
}

export interface AsyncRetryPolicy {
  readonly policyRef: string;
  /** Total processing attempts, including the first attempt. Must be >= 1. */
  readonly maxAttempts: number;
  /** Upper bound on any policy-supplied retry delay. */
  readonly maxRetryDelaySeconds: number;
  /** What happens when a RETRY rule reaches maxAttempts. */
  readonly retryExhaustionDisposition: Exclude<FailureDisposition, 'RETRY'>;
  readonly rules: readonly AsyncFailureRule[];
}

export type AsyncRetryPolicyValidation =
  | { readonly status: 'VALID' }
  | { readonly status: 'INVALID'; readonly errors: readonly string[] };

export function validateAsyncRetryPolicy(policy: AsyncRetryPolicy): AsyncRetryPolicyValidation {
  const errors: string[] = [];
  if (!policy.policyRef.trim()) errors.push('POLICY_REF_REQUIRED');
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) errors.push('MAX_ATTEMPTS_INVALID');
  if (!Number.isFinite(policy.maxRetryDelaySeconds) || policy.maxRetryDelaySeconds < 0) {
    errors.push('MAX_RETRY_DELAY_INVALID');
  }

  const seen = new Set<AsyncFailureClass>();
  for (const rule of policy.rules) {
    if (seen.has(rule.failureClass)) errors.push(`DUPLICATE_FAILURE_RULE:${rule.failureClass}`);
    seen.add(rule.failureClass);
    if (rule.disposition === 'RETRY') {
      if (!Number.isFinite(rule.retryDelaySeconds) || (rule.retryDelaySeconds ?? -1) < 0) {
        errors.push(`RETRY_DELAY_REQUIRED:${rule.failureClass}`);
      } else if ((rule.retryDelaySeconds ?? 0) > policy.maxRetryDelaySeconds) {
        errors.push(`RETRY_DELAY_EXCEEDS_POLICY:${rule.failureClass}`);
      }
    } else if (rule.retryDelaySeconds !== undefined) {
      errors.push(`NON_RETRY_DELAY_FORBIDDEN:${rule.failureClass}`);
    }
  }
  return errors.length ? { status: 'INVALID', errors } : { status: 'VALID' };
}

export interface AsyncFailureEvaluationInput {
  readonly policy: AsyncRetryPolicy;
  /** 1-based attempt number for the attempt that just failed. */
  readonly attempt: number;
  readonly failureClass: AsyncFailureClass;
}

export type AsyncFailureDecision =
  | {
      readonly decision: 'RETRY';
      readonly nextAttempt: number;
      readonly retryDelaySeconds: number;
      readonly policyRef: string;
    }
  | {
      readonly decision: 'QUARANTINE' | 'FAIL_CLOSED';
      readonly policyRef: string;
      readonly exhaustedRetry: boolean;
    }
  | {
      readonly decision: 'FAIL_CLOSED';
      readonly policyRef: string;
      readonly exhaustedRetry: false;
      readonly reason: 'INVALID_POLICY' | 'INVALID_ATTEMPT' | 'NO_FAILURE_RULE';
    };

/**
 * Pure decision contract only. It never sleeps, enqueues, mutates provider state, or decides provider-specific retry semantics.
 * Those semantics must arrive through an explicit policy built from canonical/runtime/provider evidence.
 */
export function evaluateAsyncFailure(input: AsyncFailureEvaluationInput): AsyncFailureDecision {
  if (validateAsyncRetryPolicy(input.policy).status === 'INVALID') {
    return { decision: 'FAIL_CLOSED', policyRef: input.policy.policyRef, exhaustedRetry: false, reason: 'INVALID_POLICY' };
  }
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    return { decision: 'FAIL_CLOSED', policyRef: input.policy.policyRef, exhaustedRetry: false, reason: 'INVALID_ATTEMPT' };
  }
  const rule = input.policy.rules.find((candidate) => candidate.failureClass === input.failureClass);
  if (!rule) {
    return { decision: 'FAIL_CLOSED', policyRef: input.policy.policyRef, exhaustedRetry: false, reason: 'NO_FAILURE_RULE' };
  }
  if (rule.disposition !== 'RETRY') {
    return { decision: rule.disposition, policyRef: input.policy.policyRef, exhaustedRetry: false };
  }
  if (input.attempt >= input.policy.maxAttempts) {
    return {
      decision: input.policy.retryExhaustionDisposition,
      policyRef: input.policy.policyRef,
      exhaustedRetry: true,
    };
  }
  return {
    decision: 'RETRY',
    nextAttempt: input.attempt + 1,
    retryDelaySeconds: rule.retryDelaySeconds ?? 0,
    policyRef: input.policy.policyRef,
  };
}

export interface DeadLetterRecord {
  readonly schemaVersion: '1';
  readonly topic: 'dead_letter.quarantine';
  readonly originalTopic: LogicalAsyncTopic;
  readonly originalEventId: AsyncEventEnvelope['eventId'];
  readonly merchantWorkspaceId: AsyncEventEnvelope['merchantWorkspaceId'];
  readonly integrationId?: AsyncEventEnvelope['integrationId'];
  readonly correlationId: AsyncEventEnvelope['correlationId'];
  readonly idempotencyKey: AsyncEventEnvelope['idempotencyKey'];
  readonly safePayloadRef: string;
  readonly failureClass: AsyncFailureClass;
  readonly failedAttempt: number;
  readonly quarantinedAt: UtcTimestamp;
  readonly policyRef: string;
}

/** Quarantine record intentionally carries references only; raw provider bodies/secrets do not belong in this contract. */
export function buildDeadLetterRecord(input: {
  readonly envelope: AsyncEventEnvelope;
  readonly failureClass: AsyncFailureClass;
  readonly failedAttempt: number;
  readonly quarantinedAt: UtcTimestamp;
  readonly policyRef: string;
  /** Current server-side Integration binding when the envelope carries integrationId. */
  readonly serverResolvedIntegration?: ServerResolvedAsyncIntegrationBinding;
}): DeadLetterRecord | null {
  if (validateAsyncEventTenantBinding({ envelope: input.envelope, ...(input.serverResolvedIntegration ? { serverResolvedIntegration: input.serverResolvedIntegration } : {}) }).status === 'INVALID') return null;
  if (!input.policyRef.trim() || !input.envelope.safePayloadRef.trim()) return null;
  if (!Number.isInteger(input.failedAttempt) || input.failedAttempt < 1) return null;
  return {
    schemaVersion: '1',
    topic: 'dead_letter.quarantine',
    originalTopic: input.envelope.topic,
    originalEventId: input.envelope.eventId,
    merchantWorkspaceId: input.envelope.merchantWorkspaceId,
    ...(input.envelope.integrationId ? { integrationId: input.envelope.integrationId } : {}),
    correlationId: input.envelope.correlationId,
    idempotencyKey: input.envelope.idempotencyKey,
    safePayloadRef: input.envelope.safePayloadRef,
    failureClass: input.failureClass,
    failedAttempt: input.failedAttempt,
    quarantinedAt: input.quarantinedAt,
    policyRef: input.policyRef,
  };
}
