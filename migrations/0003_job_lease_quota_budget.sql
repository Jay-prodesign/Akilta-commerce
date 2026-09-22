-- P0-023 remediation (F1/F2): Job/Run single-owner lease + fencing, and a
-- genuine atomic quota_budgets ledger. Additive-only; does not modify 0001/0002.

-- F1: smallest deterministic single-owner mechanism for Job/Run dispatch.
-- owner_lease_id + lease_expires_at give crash/restart/orphan reconciliation
-- (an expired lease is simply reclaimable by the next worker); fencing_token
-- gives stale/dual-worker rejection (a worker presenting a token below the
-- job's current floor is refused regardless of business validity).
ALTER TABLE jobs ADD COLUMN owner_lease_id TEXT;
ALTER TABLE jobs ADD COLUMN lease_expires_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN fencing_token BIGINT NOT NULL DEFAULT 0;
CREATE INDEX jobs_lease_idx ON jobs(status, lease_expires_at);

-- F2: D-090 I5 atomic quota/cost admission needs an actual running budget a
-- single atomic UPDATE can conditionally increment -- quota_reservations
-- alone (individual reservation rows) cannot enforce "never exceed limit"
-- at the DB layer by itself. This is the minimal addition that lets
-- `UPDATE quota_budgets SET used_amount = used_amount + $amount
--   WHERE ... AND used_amount + $amount <= limit_amount`
-- be the single source of atomicity, safe under genuinely concurrent transactions.
CREATE TABLE quota_budgets (
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  budget_key TEXT NOT NULL,
  limit_amount BIGINT NOT NULL CHECK (limit_amount > 0),
  used_amount BIGINT NOT NULL DEFAULT 0 CHECK (used_amount >= 0),
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (merchant_workspace_id, budget_key),
  CHECK (used_amount <= limit_amount)
);
