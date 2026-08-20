-- PRE-PRODUCTION / LOCAL RECOVERY ONLY.
-- Production schema evolution remains forward/additive-first; do not use this script to erase live tenant data.
BEGIN;
DROP TABLE IF EXISTS quota_budgets;
ALTER TABLE jobs DROP COLUMN IF EXISTS fencing_token;
ALTER TABLE jobs DROP COLUMN IF EXISTS lease_expires_at;
ALTER TABLE jobs DROP COLUMN IF EXISTS owner_lease_id;
DROP INDEX IF EXISTS jobs_lease_idx;
COMMIT;
