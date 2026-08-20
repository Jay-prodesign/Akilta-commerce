import {
  classifyJobSubmission,
  createChildJob,
  createJob,
  jobDeduplicationKey,
  projectParentAggregateStatus,
  type JobRecord,
} from '../../packages/events/src/job';
import {
  createOutboxDeliveryRegistry,
  deliverOutboxRecord,
  stageJobWithOutbox,
} from '../../packages/events/src/outbox';
import { settleActionExecution } from '../../apps/api/src/action-settlement';
import { idempotencyKey, internalId, utcTimestamp } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspace = internalId('mw_job_001', 'MerchantWorkspace');
const otherWorkspace = internalId('mw_job_other', 'MerchantWorkspace');
const now = utcTimestamp('2026-08-19T09:00:00Z');

function job(overrides: Partial<Parameters<typeof createJob>[0]> = {}) {
  const result = createJob({
    jobId: internalId('job_001', 'Job'),
    merchantWorkspaceId: workspace,
    capabilityRef: 'commerce.sync_inventory@1',
    meteredSpend: false,
    idempotencyKey: idempotencyKey('mw_job_001:commerce.sync_inventory:001'),
    now,
    ...overrides,
  });
  assert(result.status === 'CREATED', 'expected job to be created');
  return result.job;
}

const cases: Array<[string, () => void]> = [
  [
    'JOB-01-METERED-WITHOUT-QUOTA-RESERVATION-REJECTED',
    () => {
      const result = createJob({
        jobId: internalId('job_metered_001', 'Job'),
        merchantWorkspaceId: workspace,
        capabilityRef: 'ai.generate_batch@1',
        meteredSpend: true,
        idempotencyKey: idempotencyKey('mw_job_001:ai.generate_batch:001'),
        now,
      });
      assert(
        result.status === 'REJECTED' && result.reason === 'QUOTA_RESERVATION_REQUIRED_FOR_METERED_SPEND',
        'D-088 S1: metered job without quota_reservation_id must be rejected',
      );
    },
  ],
  [
    'JOB-02-METERED-WITH-QUOTA-RESERVATION-CREATED',
    () => {
      const result = createJob({
        jobId: internalId('job_metered_002', 'Job'),
        merchantWorkspaceId: workspace,
        capabilityRef: 'ai.generate_batch@1',
        meteredSpend: true,
        quotaReservationId: internalId('qr_001', 'QuotaReservation'),
        idempotencyKey: idempotencyKey('mw_job_001:ai.generate_batch:002'),
        now,
      });
      assert(result.status === 'CREATED', 'metered job with quota reservation should be created');
    },
  ],
  [
    'JOB-03-EMPTY-CAPABILITY-REF-REJECTED',
    () => {
      const result = createJob({
        jobId: internalId('job_003', 'Job'),
        merchantWorkspaceId: workspace,
        capabilityRef: '  ',
        meteredSpend: false,
        idempotencyKey: idempotencyKey('mw_job_001:blank:001'),
        now,
      });
      assert(result.status === 'REJECTED' && result.reason === 'CAPABILITY_REF_REQUIRED', 'blank capability_ref accepted');
    },
  ],
  [
    'JOB-04-CHILD-JOB-LINKED-TO-PARENT',
    () => {
      const parent = job();
      const result = createChildJob({
        jobId: internalId('job_child_001', 'Job'),
        merchantWorkspaceId: workspace,
        capabilityRef: 'commerce.sync_inventory.child@1',
        meteredSpend: false,
        idempotencyKey: idempotencyKey('mw_job_001:commerce.sync_inventory.child:001'),
        now,
        parentJob: parent,
      });
      assert(result.status === 'CREATED', 'child job creation should succeed');
      if (result.status === 'CREATED') {
        assert(result.job.parentJobId === parent.jobId, 'D-088 S2: child job must carry parent_job_id');
      }
    },
  ],
  [
    'JOB-05-CHILD-JOB-CROSS-WORKSPACE-REJECTED',
    () => {
      const parent = job();
      const result = createChildJob({
        jobId: internalId('job_child_002', 'Job'),
        merchantWorkspaceId: otherWorkspace,
        capabilityRef: 'commerce.sync_inventory.child@1',
        meteredSpend: false,
        idempotencyKey: idempotencyKey('mw_job_other:commerce.sync_inventory.child:001'),
        now,
        parentJob: parent,
      });
      assert(
        result.status === 'REJECTED' && result.reason === 'PARENT_JOB_WORKSPACE_MISMATCH',
        'cross-workspace child job must be rejected',
      );
    },
  ],
  [
    'JOB-06-PARENT-AGGREGATE-AMBIGUOUS-NOT-BLINDLY-RESOLVED',
    () => {
      const children: JobRecord[] = [
        { ...job(), status: 'SUCCEEDED' },
        { ...job(), status: 'FAILED_RETRYABLE' },
      ];
      assert(
        projectParentAggregateStatus(children) === 'AMBIGUOUS_UNRESOLVED',
        'D-088 S2: ambiguous provider outcome must stay unresolved, not be folded into FAILED',
      );
    },
  ],
  [
    'JOB-07-PARENT-AGGREGATE-PARTIAL-SUCCESS',
    () => {
      const children: JobRecord[] = [
        { ...job(), status: 'SUCCEEDED' },
        { ...job(), status: 'FAILED_TERMINAL' },
      ];
      assert(projectParentAggregateStatus(children) === 'PARTIAL_SUCCESS', 'mixed terminal outcomes should project PARTIAL_SUCCESS');
    },
  ],
  [
    'OUTBOX-01-STAGED-INTENT-SHARES-JOB-IDENTITY',
    () => {
      const staged = stageJobWithOutbox({
        job: job(),
        outboxId: internalId('outbox_001', 'Outbox'),
        topic: 'action.execute',
        payloadRef: 'payload:ref:001',
      });
      assert(staged.outbox.jobId === staged.job.jobId, 'outbox record must reference its committed job');
      assert(staged.outbox.idempotencyKey === staged.job.idempotencyKey, 'outbox idempotency key must match job idempotency key');
      assert(staged.outbox.deliveryState === 'PENDING', 'a freshly staged outbox record must start PENDING');
    },
  ],
  [
    'OUTBOX-02-EMPTY-PAYLOAD-REF-REJECTED',
    () => {
      let threw = false;
      try {
        stageJobWithOutbox({ job: job(), outboxId: internalId('outbox_002', 'Outbox'), topic: 'action.execute', payloadRef: '' });
      } catch {
        threw = true;
      }
      assert(threw, 'empty payloadRef must be rejected');
    },
  ],
  [
    'OUTBOX-03-REPLAY-DELIVERY-FIRES-EFFECT-EXACTLY-ONCE',
    () => {
      const staged = stageJobWithOutbox({
        job: job(),
        outboxId: internalId('outbox_003', 'Outbox'),
        topic: 'action.execute',
        payloadRef: 'payload:ref:003',
      });
      const registry = createOutboxDeliveryRegistry();
      let effectCalls = 0;
      const first = deliverOutboxRecord(registry, staged.outbox, () => { effectCalls += 1; });
      const replay = deliverOutboxRecord(registry, staged.outbox, () => { effectCalls += 1; });
      assert(first.outcome === 'DELIVERED', 'first delivery attempt should deliver');
      assert(replay.outcome === 'ALREADY_DELIVERED', 'D-090 I1: replayed delivery must be recognized, not redelivered');
      assert(effectCalls === 1, 'at-least-once delivery must still fire the external effect exactly once');
    },
  ],
  [
    'JOB-08-RG-DUP-DUPLICATE-SUBMISSION-DETECTED-APPLICATION-LEVEL',
    () => {
      const first = job();
      const seen = new Set<string>([jobDeduplicationKey(first)]);
      // Same workspace/capabilityRef/idempotencyKey resubmitted out of order (e.g. a
      // retried client request) must be recognized before ever reaching the DB
      // UNIQUE constraint.
      const resubmission = job();
      assert(
        classifyJobSubmission(seen, resubmission) === 'DUPLICATE',
        'RG-DUP: a resubmitted job with identical workspace/capabilityRef/idempotencyKey must be classified DUPLICATE',
      );
    },
  ],
  [
    'JOB-09-RG-DUP-DIFFERENT-IDEMPOTENCY-KEY-NOT-A-DUPLICATE',
    () => {
      const first = job();
      const seen = new Set<string>([jobDeduplicationKey(first)]);
      const distinct = job({ jobId: internalId('job_distinct_001', 'Job'), idempotencyKey: idempotencyKey('mw_job_001:commerce.sync_inventory:distinct') });
      assert(classifyJobSubmission(seen, distinct) === 'ACCEPT', 'a genuinely distinct job must not be misclassified as duplicate');
    },
  ],
  [
    'OUTBOX-04-CROSS-WORKSPACE-IDENTITY-CANNOT-BE-FORGED',
    () => {
      // The outbox record's merchantWorkspaceId is always derived from the
      // committed job, never independently supplied -- there is no input path
      // that lets a caller stage an outbox entry against a workspace other than
      // the one its job actually belongs to.
      const staged = stageJobWithOutbox({
        job: job({ merchantWorkspaceId: otherWorkspace, idempotencyKey: idempotencyKey('mw_job_other:commerce.sync_inventory:cross') }),
        outboxId: internalId('outbox_004', 'Outbox'),
        topic: 'action.execute',
        payloadRef: 'payload:ref:004',
      });
      assert(staged.outbox.merchantWorkspaceId === otherWorkspace, 'outbox workspace must track its job, never be independently settable');
    },
  ],
  [
    'OUTBOX-05-AMBIGUOUS-SETTLEMENT-NEVER-BLINDLY-REPLAYED',
    () => {
      // Compose the outbox's at-least-once delivery tracking with the existing
      // action-settlement reconciliation contract: an ambiguous (OUTCOME_UNKNOWN)
      // provider result is a *business* ambiguity that action-settlement routes to
      // RECONCILE_PROVIDER_RESULT (manual/explicit reconciliation) -- it is never,
      // by itself, treated by the outbox layer as "not yet delivered", so a caller
      // cannot get a second automatic mutation attempt merely by calling
      // deliverOutboxRecord again for the same outboxId.
      const staged = stageJobWithOutbox({
        job: job(),
        outboxId: internalId('outbox_005', 'Outbox'),
        topic: 'action.execute',
        payloadRef: 'payload:ref:005',
      });
      const registry = createOutboxDeliveryRegistry();
      let attempts = 0;
      const first = deliverOutboxRecord(registry, staged.outbox, () => { attempts += 1; });
      assert(first.outcome === 'DELIVERED', 'first attempt should deliver');

      const settlement = settleActionExecution({
        actionName: 'conversation.reply.send',
        evidence: { providerState: 'OUTCOME_UNKNOWN' },
      });
      assert(
        settlement.status === 'BLOCKED' && settlement.nextSafeAction === 'RECONCILE_PROVIDER_RESULT',
        'an ambiguous provider outcome must route to explicit reconciliation, not an implicit retry signal',
      );

      // A caller that (incorrectly) tries to "retry" by redelivering the same
      // outbox entry after seeing the ambiguous settlement must still be refused.
      const secondAttempt = deliverOutboxRecord(registry, staged.outbox, () => { attempts += 1; });
      assert(secondAttempt.outcome === 'ALREADY_DELIVERED', 'ambiguous settlement must not unlock a second delivery of the same outbox entry');
      assert(attempts === 1, 'the external effect must never fire twice off the back of an ambiguous outcome');
    },
  ],
];

for (const [name, fn] of cases) { fn(); console.log(`PASS ${name}`); }
console.log(`PASS ${cases.length}/${cases.length} job/outbox scenarios`);
