// P0-023 remediation (F1/F2/F3): real local PostgreSQL evidence generator.
// Not part of the CI-gated dependency-free suite (no Postgres service exists
// in CI yet -- see release/OPEN_GATES.json POSTGRES_RUNTIME). Run manually
// against a local/ephemeral Postgres, exactly like RUN-3's evidence pass:
//   node scripts/pg-remediation-evidence.mjs "postgres://user@host:port/db"
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const { Pool } = pg;
const connectionString = process.argv[2];
if (!connectionString) {
  console.error('usage: node scripts/pg-remediation-evidence.mjs <connection-string>');
  process.exit(1);
}

const pool = new Pool({ connectionString, max: 10 });

function log(scenario, pass, detail) {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${scenario}${detail ? ' -- ' + detail : ''}`);
  if (!pass) process.exitCode = 1;
}

async function main() {
  const setup = await pool.connect();
  try {
    await setup.query(readFileSync(new URL('../migrations/0001_foundation.sql', import.meta.url), 'utf8'));
    await setup.query(readFileSync(new URL('../migrations/0002_job_run_outbox_quota.sql', import.meta.url), 'utf8'));
    await setup.query(readFileSync(new URL('../migrations/0003_job_lease_quota_budget.sql', import.meta.url), 'utf8'));
    await setup.query(
      `INSERT INTO organizations (organization_id, type, display_name, status, created_at, updated_at)
       VALUES ('org_rem','STANDALONE_MERCHANT','Remediation Org','ACTIVE', now(), now())`,
    );
    await setup.query(
      `INSERT INTO merchant_workspaces (merchant_workspace_id, owning_organization_id, display_name, status, locale_default, timezone, onboarding_state, created_at, updated_at)
       VALUES ('mw_rem','org_rem','Remediation Workspace','ACTIVE','tr-TR','Europe/Istanbul','ACTIVE', now(), now())`,
    );
  } finally {
    setup.release();
  }
  console.log('PASS SETUP-0001-0002-0003-APPLIED-CLEAN');

  // ---------------------------------------------------------------------
  // F2: real concurrent atomic quota reservation -- no overspend.
  // ---------------------------------------------------------------------
  {
    const c = await pool.connect();
    await c.query(
      `INSERT INTO quota_budgets (merchant_workspace_id, budget_key, limit_amount, used_amount, updated_at)
       VALUES ('mw_rem','ai.generate_batch', 5, 0, now())`,
    );
    c.release();

    async function attemptReserve(amount) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `UPDATE quota_budgets SET used_amount = used_amount + $1, updated_at = now()
             WHERE merchant_workspace_id = 'mw_rem' AND budget_key = 'ai.generate_batch'
               AND used_amount + $1 <= limit_amount
             RETURNING used_amount`,
          [amount],
        );
        if (result.rowCount === 0) {
          await client.query('ROLLBACK');
          return 'DENY';
        }
        await client.query(
          `INSERT INTO quota_reservations (quota_reservation_id, merchant_workspace_id, budget_key, reserved_amount, status, created_at)
             VALUES ($1, 'mw_rem', 'ai.generate_batch', $2, 'RESERVED', now())`,
          [randomUUID(), amount],
        );
        await client.query('COMMIT');
        return 'ALLOW';
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // 10 genuinely concurrent client connections, each racing to reserve 1
    // unit against a limit of 5 -- real network round-trips, real Postgres
    // row-level locking arbitrates, not in-process JS scheduling.
    const results = await Promise.all(Array.from({ length: 10 }, () => attemptReserve(1)));
    const granted = results.filter((r) => r === 'ALLOW').length;
    log('F2-CONCURRENT-RESERVATION-NO-OVERSPEND', granted === 5, `granted=${granted} (expected 5)`);

    const finalUsed = await pool.query(
      `SELECT used_amount FROM quota_budgets WHERE merchant_workspace_id='mw_rem' AND budget_key='ai.generate_batch'`,
    );
    log('F2-USED-AMOUNT-MATCHES-GRANTED-EXACTLY', Number(finalUsed.rows[0].used_amount) === granted, `used_amount=${finalUsed.rows[0].used_amount}`);

    const reservationRows = await pool.query(
      `SELECT count(*)::int AS n FROM quota_reservations WHERE merchant_workspace_id='mw_rem' AND budget_key='ai.generate_batch'`,
    );
    log('F2-RESERVATION-ROW-COUNT-MATCHES-GRANTED', reservationRows.rows[0].n === granted, `rows=${reservationRows.rows[0].n}`);

    // Tenant isolation: a second workspace's budget must be unaffected.
    await pool.query(
      `INSERT INTO merchant_workspaces (merchant_workspace_id, owning_organization_id, display_name, status, locale_default, timezone, onboarding_state, created_at, updated_at)
       VALUES ('mw_rem_b','org_rem','Remediation Workspace B','ACTIVE','tr-TR','Europe/Istanbul','ACTIVE', now(), now())`,
    );
    await pool.query(
      `INSERT INTO quota_budgets (merchant_workspace_id, budget_key, limit_amount, used_amount, updated_at)
       VALUES ('mw_rem_b','ai.generate_batch', 5, 0, now())`,
    );
    const cB = await pool.connect();
    await cB.query('BEGIN');
    const rB = await cB.query(
      `UPDATE quota_budgets SET used_amount = used_amount + 1, updated_at = now()
         WHERE merchant_workspace_id = 'mw_rem_b' AND budget_key = 'ai.generate_batch' AND used_amount + 1 <= limit_amount
         RETURNING used_amount`,
    );
    await cB.query('COMMIT');
    cB.release();
    log('F2-TENANT-ISOLATION-SECOND-WORKSPACE-UNAFFECTED', rB.rowCount === 1 && Number(rB.rows[0].used_amount) === 1, `workspace B used_amount=${rB.rows?.[0]?.used_amount}`);

    // Deterministic denial once exhausted (workspace A is now at 5/5).
    const exhausted = await attemptReserve(1);
    log('F2-DETERMINISTIC-DENIAL-WHEN-EXHAUSTED', exhausted === 'DENY', `result=${exhausted}`);
  }

  // ---------------------------------------------------------------------
  // F3: real Job/ActionIntent/outbox atomic commit/rollback + replay.
  // ---------------------------------------------------------------------
  {
    const jobId = randomUUID();
    const outboxId = randomUUID();
    const idemKey = `mw_rem:commerce.sync:${randomUUID()}`;

    // Rollback proof: insert job + outbox in one transaction, then force a
    // failure (violate the jobs status CHECK on a second, related insert)
    // before COMMIT -- neither row must persist.
    const rollbackClient = await pool.connect();
    let rollbackForced = false;
    try {
      await rollbackClient.query('BEGIN');
      await rollbackClient.query(
        `INSERT INTO jobs (job_id, merchant_workspace_id, capability_ref, metered_spend, idempotency_key, status, created_at, updated_at)
           VALUES ($1, 'mw_rem', 'commerce.sync@1', FALSE, $2, 'PENDING', now(), now())`,
        [jobId, idemKey],
      );
      await rollbackClient.query(
        `INSERT INTO job_outbox (outbox_id, job_id, merchant_workspace_id, topic, idempotency_key, payload_ref, delivery_state, created_at)
           VALUES ($1, $2, 'mw_rem', 'action.execute', $3, 'payload:ref:rollback', 'PENDING', now())`,
        [outboxId, jobId, idemKey],
      );
      // Force a real constraint violation inside the same transaction.
      await rollbackClient.query(
        `INSERT INTO jobs (job_id, merchant_workspace_id, capability_ref, metered_spend, idempotency_key, status, created_at, updated_at)
           VALUES ($1, 'mw_rem', 'commerce.sync.bad@1', FALSE, $2, 'BOGUS_STATUS', now(), now())`,
        [randomUUID(), `mw_rem:commerce.sync.bad:${randomUUID()}`],
      );
      await rollbackClient.query('COMMIT');
    } catch {
      await rollbackClient.query('ROLLBACK');
      rollbackForced = true;
    } finally {
      rollbackClient.release();
    }
    log('F3-FORCED-FAILURE-TRIGGERED-ROLLBACK', rollbackForced, undefined);

    const afterRollback = await pool.query(`SELECT count(*)::int AS n FROM jobs WHERE job_id=$1`, [jobId]);
    const afterRollbackOutbox = await pool.query(`SELECT count(*)::int AS n FROM job_outbox WHERE outbox_id=$1`, [outboxId]);
    log(
      'F3-ROLLBACK-LEAVES-NEITHER-JOB-NOR-OUTBOX-ROW',
      afterRollback.rows[0].n === 0 && afterRollbackOutbox.rows[0].n === 0,
      `jobs=${afterRollback.rows[0].n} outbox=${afterRollbackOutbox.rows[0].n}`,
    );

    // Real successful atomic commit: job + outbox together.
    const commitJobId = randomUUID();
    const commitOutboxId = randomUUID();
    const commitIdemKey = `mw_rem:commerce.sync:${randomUUID()}`;
    const commitClient = await pool.connect();
    await commitClient.query('BEGIN');
    await commitClient.query(
      `INSERT INTO jobs (job_id, merchant_workspace_id, capability_ref, metered_spend, idempotency_key, status, created_at, updated_at)
         VALUES ($1, 'mw_rem', 'commerce.sync@1', FALSE, $2, 'PENDING', now(), now())`,
      [commitJobId, commitIdemKey],
    );
    await commitClient.query(
      `INSERT INTO job_outbox (outbox_id, job_id, merchant_workspace_id, topic, idempotency_key, payload_ref, delivery_state, created_at)
         VALUES ($1, $2, 'mw_rem', 'action.execute', $3, 'payload:ref:commit', 'PENDING', now())`,
      [commitOutboxId, commitJobId, commitIdemKey],
    );
    await commitClient.query('COMMIT');
    commitClient.release();

    const afterCommitJob = await pool.query(`SELECT status FROM jobs WHERE job_id=$1`, [commitJobId]);
    const afterCommitOutbox = await pool.query(`SELECT delivery_state FROM job_outbox WHERE outbox_id=$1`, [commitOutboxId]);
    log(
      'F3-COMMIT-PERSISTS-JOB-AND-OUTBOX-TOGETHER',
      afterCommitJob.rowCount === 1 && afterCommitOutbox.rowCount === 1,
      `job=${afterCommitJob.rows[0]?.status} outbox=${afterCommitOutbox.rows[0]?.delivery_state}`,
    );

    // Replay/idempotency: re-attempt the exact same logical submission
    // (same workspace+capability_ref+idempotency_key) via a real
    // ON CONFLICT DO NOTHING -- must not duplicate, must not error, and the
    // original row's data must remain exactly as first committed.
    const replay = await pool.query(
      `INSERT INTO jobs (job_id, merchant_workspace_id, capability_ref, metered_spend, idempotency_key, status, created_at, updated_at)
         VALUES ($1, 'mw_rem', 'commerce.sync@1', FALSE, $2, 'PENDING', now(), now())
         ON CONFLICT (merchant_workspace_id, capability_ref, idempotency_key) DO NOTHING
         RETURNING job_id`,
      [randomUUID(), commitIdemKey],
    );
    log('F3-REPLAY-INSERT-SAFELY-NO-OPS', replay.rowCount === 0, `replay rowCount=${replay.rowCount}`);

    const stillOriginal = await pool.query(`SELECT job_id FROM jobs WHERE merchant_workspace_id='mw_rem' AND capability_ref='commerce.sync@1' AND idempotency_key=$1`, [commitIdemKey]);
    log('F3-REPLAY-DID-NOT-MUTATE-ORIGINAL-ROW', stillOriginal.rowCount === 1 && stillOriginal.rows[0].job_id === commitJobId, `job_id=${stillOriginal.rows[0]?.job_id}`);
  }

  // ---------------------------------------------------------------------
  // F1: real concurrent lease acquisition -- exactly one worker wins.
  // ---------------------------------------------------------------------
  {
    const leaseJobId = randomUUID();
    const leaseIdemKey = `mw_rem:commerce.lease_test:${randomUUID()}`;
    await pool.query(
      `INSERT INTO jobs (job_id, merchant_workspace_id, capability_ref, metered_spend, idempotency_key, status, created_at, updated_at)
         VALUES ($1, 'mw_rem', 'commerce.lease_test@1', FALSE, $2, 'PENDING', now(), now())`,
      [leaseJobId, leaseIdemKey],
    );

    async function attemptClaim(workerId) {
      const client = await pool.connect();
      try {
        const result = await client.query(
          `UPDATE jobs SET owner_lease_id = $1, lease_expires_at = now() + interval '60 seconds', fencing_token = fencing_token + 1
             WHERE job_id = $2 AND (owner_lease_id IS NULL OR lease_expires_at < now())
             RETURNING fencing_token`,
          [workerId, leaseJobId],
        );
        return result.rowCount === 1 ? { workerId, fencingToken: result.rows[0].fencing_token } : null;
      } finally {
        client.release();
      }
    }

    const claimResults = await Promise.all(Array.from({ length: 8 }, (_, i) => attemptClaim(`worker-${i}`)));
    const winners = claimResults.filter((r) => r !== null);
    log('F1-EXACTLY-ONE-CONCURRENT-CLAIM-WINS', winners.length === 1, `winners=${winners.length}`);

    const finalLease = await pool.query(`SELECT owner_lease_id, fencing_token FROM jobs WHERE job_id=$1`, [leaseJobId]);
    log(
      'F1-WINNING-CLAIM-MATCHES-PERSISTED-STATE',
      winners.length === 1 && finalLease.rows[0].owner_lease_id === winners[0].workerId && Number(finalLease.rows[0].fencing_token) === Number(winners[0].fencingToken),
      `owner=${finalLease.rows[0].owner_lease_id} fencing_token=${finalLease.rows[0].fencing_token}`,
    );
  }

  await pool.end();
  console.log(process.exitCode === 1 ? 'PG_REMEDIATION_EVIDENCE_FAIL' : 'PG_REMEDIATION_EVIDENCE_PASS');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
