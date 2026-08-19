-- P0-026: D-088 minimum Job/Run schema + D-090 I1/I3/I5 safety invariants
-- (RG-OUTBOX, RG-AUTH-RACE, RG-QUOTA). Additive-only; does not modify 0001.

CREATE TABLE quota_reservations (
  quota_reservation_id TEXT PRIMARY KEY,
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  budget_key TEXT NOT NULL,
  reserved_amount BIGINT NOT NULL CHECK (reserved_amount > 0),
  status TEXT NOT NULL CHECK (status IN ('RESERVED','SETTLED','RELEASED')),
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX quota_reservations_workspace_budget_idx ON quota_reservations(merchant_workspace_id, budget_key);

-- D-088 minimum Job/Run schema: merchant_workspace_id, capability_ref,
-- quota_reservation_id (required by application logic for metered spend-bearing
-- Job/Run, not encoded as a blanket NOT NULL since most Job/Run work is unmetered),
-- parent_job_id (bounded child work linkage, D-088 S2).
CREATE TABLE jobs (
  job_id TEXT PRIMARY KEY,
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  capability_ref TEXT NOT NULL,
  metered_spend BOOLEAN NOT NULL DEFAULT FALSE,
  quota_reservation_id TEXT REFERENCES quota_reservations(quota_reservation_id) ON DELETE RESTRICT,
  parent_job_id TEXT REFERENCES jobs(job_id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','RESERVED','DISPATCHED','SUCCEEDED','FAILED_RETRYABLE','FAILED_TERMINAL')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  -- D-088 S1: metered/spend-bearing Job/Run must carry a quota_reservation_id.
  CHECK (metered_spend = FALSE OR quota_reservation_id IS NOT NULL),
  UNIQUE (merchant_workspace_id, capability_ref, idempotency_key)
);
CREATE INDEX jobs_workspace_status_idx ON jobs(merchant_workspace_id, status);
CREATE INDEX jobs_parent_job_idx ON jobs(parent_job_id);

-- D-090 I1 / RG-OUTBOX: committed Action Intent before external effect. A job row
-- and its outbox row are written in the same transaction as the application-layer
-- Action Intent commit (see packages/events/src/outbox.ts stageJobWithOutbox),
-- giving the durable outbox/inbox-equivalent atomic boundary D-090 I1 requires.
CREATE TABLE job_outbox (
  outbox_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE RESTRICT,
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  topic TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_ref TEXT NOT NULL,
  delivery_state TEXT NOT NULL CHECK (delivery_state IN ('PENDING','DELIVERED')),
  created_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ,
  -- Replay-safe / at-least-once delivery: redelivering the same logical outbox
  -- entry can never insert a second row, so a consumer scanning for PENDING rows
  -- and marking DELIVERED cannot double-fire the same Action Intent.
  UNIQUE (merchant_workspace_id, topic, idempotency_key)
);
CREATE INDEX job_outbox_job_idx ON job_outbox(job_id);
CREATE INDEX job_outbox_pending_idx ON job_outbox(merchant_workspace_id, delivery_state, created_at);
