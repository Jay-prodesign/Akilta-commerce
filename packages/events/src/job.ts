import type {
  IdempotencyKey,
  JobId,
  MerchantWorkspaceId,
  QuotaReservationId,
  UtcTimestamp,
} from '../../domain/src';

export const JOB_STATUSES = [
  'PENDING',
  'RESERVED',
  'DISPATCHED',
  'SUCCEEDED',
  'FAILED_RETRYABLE',
  'FAILED_TERMINAL',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * D-088 minimum Job/Run schema (merchant_workspace_id, capability_ref,
 * quota_reservation_id, parent_job_id). capabilityRef is an opaque,
 * namespaced/versioned capability key; broad dispatch/resolution through the
 * Capability/Action Registry is explicitly deferred by D-088 and out of this
 * bounded slice's scope -- this module only implements the safety invariants
 * (pre-spend cost admission linkage, parent/child correlation), not a generic
 * dispatcher.
 */
export interface JobRecord {
  readonly jobId: JobId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly capabilityRef: string;
  readonly meteredSpend: boolean;
  readonly quotaReservationId?: QuotaReservationId;
  readonly parentJobId?: JobId;
  readonly idempotencyKey: IdempotencyKey;
  readonly status: JobStatus;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface CreateJobInput {
  readonly jobId: JobId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly capabilityRef: string;
  readonly meteredSpend: boolean;
  readonly quotaReservationId?: QuotaReservationId;
  readonly idempotencyKey: IdempotencyKey;
  readonly now: UtcTimestamp;
}

export type CreateJobResult =
  | { readonly status: 'CREATED'; readonly job: JobRecord }
  | {
      readonly status: 'REJECTED';
      readonly reason: 'CAPABILITY_REF_REQUIRED' | 'QUOTA_RESERVATION_REQUIRED_FOR_METERED_SPEND';
    };

/** D-088 S1: metered/spend-bearing Job/Run must carry a quota_reservation_id. */
export function createJob(input: CreateJobInput): CreateJobResult {
  if (!input.capabilityRef.trim()) return { status: 'REJECTED', reason: 'CAPABILITY_REF_REQUIRED' };
  if (input.meteredSpend && !input.quotaReservationId) {
    return { status: 'REJECTED', reason: 'QUOTA_RESERVATION_REQUIRED_FOR_METERED_SPEND' };
  }
  return {
    status: 'CREATED',
    job: {
      jobId: input.jobId,
      merchantWorkspaceId: input.merchantWorkspaceId,
      capabilityRef: input.capabilityRef,
      meteredSpend: input.meteredSpend,
      ...(input.quotaReservationId ? { quotaReservationId: input.quotaReservationId } : {}),
      idempotencyKey: input.idempotencyKey,
      status: 'PENDING',
      createdAt: input.now,
      updatedAt: input.now,
    },
  };
}

export type CreateChildJobResult = CreateJobResult | { readonly status: 'REJECTED'; readonly reason: 'PARENT_JOB_WORKSPACE_MISMATCH' };

/**
 * D-088 S2: a requested outcome that expands into independently mutating targets
 * uses bounded child work linked by parent_job_id. This is the only place
 * parentJobId is set, so a child job can never be constructed without a real
 * parent already in hand.
 */
export function createChildJob(
  input: CreateJobInput & { readonly parentJob: JobRecord },
): CreateChildJobResult {
  if (input.parentJob.merchantWorkspaceId !== input.merchantWorkspaceId) {
    return { status: 'REJECTED', reason: 'PARENT_JOB_WORKSPACE_MISMATCH' };
  }
  const result = createJob(input);
  if (result.status === 'REJECTED') return result;
  return { status: 'CREATED', job: { ...result.job, parentJobId: input.parentJob.jobId } };
}

export function transitionJobStatus(job: JobRecord, next: JobStatus, now: UtcTimestamp): JobRecord {
  return { ...job, status: next, updatedAt: now };
}

export type ParentAggregateStatus =
  | 'PENDING'
  | 'PARTIAL_SUCCESS'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'AMBIGUOUS_UNRESOLVED';

/**
 * D-088 S2: parent status/result is an aggregate projection of child truth; external
 * bulk work never assumes global transaction rollback. A child left in
 * FAILED_RETRYABLE is ambiguous provider outcome and stays AMBIGUOUS_UNRESOLVED --
 * it is never blindly folded into FAILED or SUCCEEDED until readback/reconciliation
 * resolves it to a terminal child status.
 */
export function projectParentAggregateStatus(children: readonly JobRecord[]): ParentAggregateStatus {
  if (children.length === 0) return 'PENDING';
  const statuses = new Set(children.map((child) => child.status));
  if (statuses.has('FAILED_RETRYABLE')) return 'AMBIGUOUS_UNRESOLVED';
  if ([...statuses].every((status) => status === 'SUCCEEDED')) return 'SUCCEEDED';
  if ([...statuses].every((status) => status === 'FAILED_TERMINAL')) return 'FAILED';
  if (statuses.has('SUCCEEDED') && statuses.has('FAILED_TERMINAL') && statuses.size === 2) {
    return 'PARTIAL_SUCCESS';
  }
  return 'PENDING';
}
