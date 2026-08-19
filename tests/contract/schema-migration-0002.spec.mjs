import fs from 'node:fs';

const up = fs.readFileSync(new URL('../../migrations/0002_job_run_outbox_quota.sql', import.meta.url), 'utf8');
const down = fs.readFileSync(new URL('../../migrations/0002_job_run_outbox_quota.preproduction_rollback.sql', import.meta.url), 'utf8');
const expectedTables = ['quota_reservations', 'jobs', 'job_outbox'];
const created = [...up.matchAll(/CREATE TABLE\s+([a-z_]+)/g)].map((m) => m[1]);
const dropped = [...down.matchAll(/DROP TABLE IF EXISTS\s+([a-z_]+)/g)].map((m) => m[1]);

const scenarios = [
  { id: 'P0026-SET-COVERAGE', actual: expectedTables.every((t) => created.includes(t)), expected: true },
  { id: 'P0026-ROLLBACK-COVERS-CREATED-TABLES', actual: created.every((t) => dropped.includes(t)), expected: true },
  { id: 'P0026-D088-JOB-MINIMUM-SCHEMA', actual: /jobs[\s\S]*merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces/.test(up) && /capability_ref TEXT NOT NULL/.test(up) && /quota_reservation_id TEXT REFERENCES quota_reservations/.test(up) && /parent_job_id TEXT REFERENCES jobs\(job_id\)/.test(up), expected: true },
  { id: 'P0026-D088-METERED-SPEND-REQUIRES-QUOTA-CHECK', actual: /CHECK \(metered_spend = FALSE OR quota_reservation_id IS NOT NULL\)/.test(up), expected: true },
  { id: 'P0026-RG-OUTBOX-JOB-LINK', actual: /job_outbox[\s\S]*job_id TEXT NOT NULL REFERENCES jobs\(job_id\)/.test(up), expected: true },
  { id: 'P0026-RG-OUTBOX-REPLAY-SAFE-UNIQUE', actual: /UNIQUE \(merchant_workspace_id, topic, idempotency_key\)/.test(up), expected: true },
  { id: 'P0026-RG-QUOTA-RESERVATION-STATUS-CHECK', actual: /status TEXT NOT NULL CHECK \(status IN \('RESERVED','SETTLED','RELEASED'\)\)/.test(up), expected: true },
  { id: 'P0026-JOB-IDEMPOTENCY-UNIQUE', actual: /UNIQUE \(merchant_workspace_id, capability_ref, idempotency_key\)/.test(up), expected: true },
  { id: 'P0026-NO-FLOAT-MONEY', actual: !/\b(REAL|DOUBLE PRECISION|FLOAT)\b/i.test(up) && /reserved_amount BIGINT/.test(up), expected: true },
  { id: 'P0026-NO-SECRET-VALUE-COLUMN', actual: !/\b(access_token|refresh_token|password|secret_value|credential_value)\b/i.test(up), expected: true },
  { id: 'P0026-ROLLBACK-PREPRODUCTION-GUARD', actual: /PRE-PRODUCTION \/ LOCAL RECOVERY ONLY/.test(down), expected: true },
  { id: 'P0026-DOES-NOT-MODIFY-0001', actual: !fs.readFileSync(new URL('../../migrations/0001_foundation.sql', import.meta.url), 'utf8').includes('quota_reservations'), expected: true },
];

const failed = scenarios.filter((s) => s.actual !== s.expected);
if (failed.length) {
  for (const f of failed) console.error('FAIL', f);
  throw new Error(`${failed.length}/${scenarios.length} P0-026 schema staging checks failed`);
}
console.log(`PASS ${scenarios.length}/${scenarios.length}`);
for (const s of scenarios) console.log(`PASS ${s.id}`);
