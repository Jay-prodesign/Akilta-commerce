-- PRE-PRODUCTION / LOCAL RECOVERY ONLY.
-- Production schema evolution remains forward/additive-first; do not use this script to erase live tenant data.
BEGIN;
DROP TABLE IF EXISTS job_outbox;
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS quota_reservations;
COMMIT;
