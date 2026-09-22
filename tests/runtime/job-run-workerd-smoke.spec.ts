import { describe, expect, it } from 'vitest';
import { createJob, createChildJob, projectParentAggregateStatus } from '../../packages/events/src/job';
import { createOutboxDeliveryRegistry, deliverOutboxRecord, stageJobWithOutbox } from '../../packages/events/src/outbox';
import { AtomicQuotaLedger, boundedConcurrencyRun } from '../../packages/events/src/quota-ledger';
import { internalId, idempotencyKey, utcTimestamp } from '../../packages/domain/src';

const ws = internalId('mw_workerd_smoke', 'MerchantWorkspace');
const now = utcTimestamp('2026-08-20T05:00:00Z');

describe('P0-026 Job/Run/outbox/quota under the real Workers runtime (workerd)', () => {
  it('creates a metered job with quota reservation and a linked child job', () => {
    const result = createJob({
      jobId: internalId('job_workerd_1', 'Job'),
      merchantWorkspaceId: ws,
      capabilityRef: 'ai.generate_batch@1',
      meteredSpend: true,
      quotaReservationId: internalId('qr_workerd_1', 'QuotaReservation'),
      idempotencyKey: idempotencyKey('mw_workerd_smoke:ai.generate_batch:001'),
      now,
    });
    expect(result.status).toBe('CREATED');
    if (result.status !== 'CREATED') return;

    const child = createChildJob({
      jobId: internalId('job_workerd_child_1', 'Job'),
      merchantWorkspaceId: ws,
      capabilityRef: 'ai.generate_batch.child@1',
      meteredSpend: false,
      idempotencyKey: idempotencyKey('mw_workerd_smoke:ai.generate_batch.child:001'),
      now,
      parentJob: result.job,
    });
    expect(child.status).toBe('CREATED');
    if (child.status !== 'CREATED') return;
    expect(child.job.parentJobId).toBe(result.job.jobId);
    expect(projectParentAggregateStatus([{ ...child.job, status: 'SUCCEEDED' }])).toBe('SUCCEEDED');
  });

  it('stages a job+outbox Action Intent and delivers it exactly once under real Promise/microtask scheduling', () => {
    const jobResult = createJob({
      jobId: internalId('job_workerd_2', 'Job'),
      merchantWorkspaceId: ws,
      capabilityRef: 'commerce.sync_inventory@1',
      meteredSpend: false,
      idempotencyKey: idempotencyKey('mw_workerd_smoke:commerce.sync_inventory:001'),
      now,
    });
    expect(jobResult.status).toBe('CREATED');
    if (jobResult.status !== 'CREATED') return;

    const staged = stageJobWithOutbox({
      job: jobResult.job,
      outboxId: internalId('outbox_workerd_1', 'Outbox'),
      topic: 'action.execute',
      payloadRef: 'payload:ref:workerd-1',
    });
    const registry = createOutboxDeliveryRegistry();
    let effectCalls = 0;
    const first = deliverOutboxRecord(registry, staged.outbox, () => { effectCalls += 1; });
    const replay = deliverOutboxRecord(registry, staged.outbox, () => { effectCalls += 1; });
    expect(first.outcome).toBe('DELIVERED');
    expect(replay.outcome).toBe('ALREADY_DELIVERED');
    expect(effectCalls).toBe(1);
  });

  it('reserves quota atomically and bounds concurrency under the real workerd event loop, including setTimeout', async () => {
    const ledger = new AtomicQuotaLedger();
    ledger.seed({ merchantWorkspaceId: ws, budgetKey: 'ai.generate_batch', used: 0n, limit: 3n });

    const attempts = Array.from({ length: 6 }, (_, i) => i);
    const results = await Promise.all(
      attempts.map(
        (i) =>
          new Promise<'ALLOW' | 'DENY'>((resolve) => {
            setTimeout(() => {
              const result = ledger.reserveAtomic({
                quotaReservationId: internalId(`qr_workerd_concurrent_${i}`, 'QuotaReservation'),
                merchantWorkspaceId: ws,
                budgetKey: 'ai.generate_batch',
                amount: 1n,
                now,
              });
              resolve(result.decision);
            }, 0);
          }),
      ),
    );
    const granted = results.filter((r) => r === 'ALLOW').length;
    expect(granted).toBe(3);

    let peak = 0;
    let active = 0;
    await boundedConcurrencyRun(attempts, 2, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
