import fs from 'node:fs';

const up = fs.readFileSync(new URL('../../migrations/0003_job_lease_quota_budget.sql', import.meta.url), 'utf8');
const down = fs.readFileSync(new URL('../../migrations/0003_job_lease_quota_budget.preproduction_rollback.sql', import.meta.url), 'utf8');
const zeroTwo = fs.readFileSync(new URL('../../migrations/0002_job_run_outbox_quota.sql', import.meta.url), 'utf8');

const scenarios = [
  { id: 'P0023-F1-LEASE-COLUMNS-ADDED', actual: /ALTER TABLE jobs ADD COLUMN owner_lease_id TEXT/.test(up) && /ALTER TABLE jobs ADD COLUMN lease_expires_at TIMESTAMPTZ/.test(up) && /ALTER TABLE jobs ADD COLUMN fencing_token BIGINT NOT NULL DEFAULT 0/.test(up), expected: true },
  { id: 'P0023-F2-QUOTA-BUDGETS-TABLE-CREATED', actual: /CREATE TABLE quota_budgets/.test(up), expected: true },
  { id: 'P0023-F2-QUOTA-BUDGETS-ATOMIC-CHECK-CONSTRAINTS', actual: /CHECK \(used_amount >= 0\)/.test(up) && /CHECK \(used_amount <= limit_amount\)/.test(up) && /CHECK \(limit_amount > 0\)/.test(up), expected: true },
  { id: 'P0023-F2-QUOTA-BUDGETS-TENANT-SCOPED-PK', actual: /PRIMARY KEY \(merchant_workspace_id, budget_key\)/.test(up), expected: true },
  { id: 'P0023-ROLLBACK-DROPS-LEASE-COLUMNS-AND-BUDGET-TABLE', actual: /DROP TABLE IF EXISTS quota_budgets/.test(down) && /DROP COLUMN IF EXISTS fencing_token/.test(down) && /DROP COLUMN IF EXISTS lease_expires_at/.test(down) && /DROP COLUMN IF EXISTS owner_lease_id/.test(down), expected: true },
  { id: 'P0023-ROLLBACK-PREPRODUCTION-GUARD', actual: /PRE-PRODUCTION \/ LOCAL RECOVERY ONLY/.test(down), expected: true },
  { id: 'P0023-DOES-NOT-MODIFY-0002', actual: !zeroTwo.includes('quota_budgets') && !zeroTwo.includes('owner_lease_id'), expected: true },
  { id: 'P0023-NO-FLOAT-MONEY', actual: !/\b(REAL|DOUBLE PRECISION|FLOAT)\b/i.test(up) && /used_amount BIGINT/.test(up) && /limit_amount BIGINT/.test(up), expected: true },
  { id: 'P0023-NO-SECRET-VALUE-COLUMN', actual: !/\b(access_token|refresh_token|password|secret_value|credential_value)\b/i.test(up), expected: true },
];

const failed = scenarios.filter((s) => s.actual !== s.expected);
if (failed.length) {
  for (const f of failed) console.error('FAIL', f);
  throw new Error(`${failed.length}/${scenarios.length} P0-023 remediation schema checks failed`);
}
console.log(`PASS ${scenarios.length}/${scenarios.length}`);
for (const s of scenarios) console.log(`PASS ${s.id}`);
