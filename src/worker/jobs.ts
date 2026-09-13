import { pool } from '../db/pool.js';
import type { Plan } from '../quota/plans.js';
import { PLAN_LIMITS } from '../quota/plans.js';
import { heartbeatMediaClaim } from './mediaClaims.js';
import { env } from '../config/env.js';

export interface JobRow {
  id: string;
  user_id: string;
  platform: 'instagram'|'tiktok'|'youtube';
  source_url: string;
  normalized_url: string;
  canonical_media_id: string;
  language: string;
  status: 'queued'|'processing'|'awaiting_payment'|'completed'|'failed';
  priority: number;
  attempts: number;
  duration_seconds: number | null;
  error_code: string | null;
  error_message: string | null;
  checkout_url: string | null;
}

export async function claimNextJob(workerId: string): Promise<JobRow | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // The first count is a cheap candidate filter. It is not the concurrency guarantee:
    // another worker can race this snapshot. We lock the user row below and re-count in
    // a fresh READ COMMITTED statement before moving the job to processing.
    const result = await client.query<JobRow & { plan: Plan }>(
      `SELECT j.*, u.plan
       FROM transcript_jobs j
       JOIN users u ON u.id=j.user_id
       WHERE j.status='queued'
         AND u.account_status <> 'disabled'
         AND j.next_attempt_at <= now()
         AND (
           SELECT COUNT(*) FROM transcript_jobs p
           WHERE p.user_id=j.user_id AND p.status='processing'
         ) < CASE u.plan WHEN 'pro' THEN 4 WHEN 'basic' THEN 2 ELSE 1 END
       ORDER BY j.priority DESC, j.created_at ASC
       FOR UPDATE OF j SKIP LOCKED
       LIMIT 1`
    );
    if (!result.rowCount) { await client.query('COMMIT'); return null; }
    const job = result.rows[0];
    const lockedUser=await client.query<{plan:Plan}>('SELECT plan FROM users WHERE id=$1 FOR UPDATE',[job.user_id]);
    if(!lockedUser.rowCount){await client.query('COMMIT');return null;}
    const limit=PLAN_LIMITS[lockedUser.rows[0].plan].concurrency;
    const active=await client.query<{count:string}>(
      `SELECT COUNT(*)::text count FROM transcript_jobs WHERE user_id=$1 AND status='processing'`,[job.user_id]
    );
    if(Number(active.rows[0]?.count??0)>=limit){
      // Move this candidate out of the immediate queue briefly so other users are not
      // starved behind a high-priority account that already has all of its slots busy.
      await client.query(`UPDATE transcript_jobs SET next_attempt_at=GREATEST(next_attempt_at,now()+interval '1 second') WHERE id=$1`,[job.id]);
      await client.query('COMMIT');
      return null;
    }
    await client.query(
      `UPDATE transcript_jobs SET status='processing', locked_at=now(), locked_by=$2, attempts=attempts+1, updated_at=now() WHERE id=$1`,
      [job.id, workerId]
    );
    await client.query('COMMIT');
    return { ...job, status: 'processing', attempts: job.attempts + 1 };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}

export async function heartbeatJob(jobId:string):Promise<void>{
  await Promise.all([
    pool.query(`UPDATE transcript_jobs SET locked_at=now(),updated_at=now() WHERE id=$1 AND status='processing'`,[jobId]),
    pool.query(`UPDATE quota_reservations SET expires_at=now()+interval '60 minutes' WHERE job_id=$1`,[jobId]),
    heartbeatMediaClaim(jobId)
  ]);
}

export async function deferJob(jobId:string,seconds=3):Promise<void>{
  await pool.query(
    `UPDATE transcript_jobs SET status='queued',attempts=GREATEST(attempts-1,0),locked_at=NULL,locked_by=NULL,
      next_attempt_at=now()+($2 || ' seconds')::interval,updated_at=now() WHERE id=$1`,
    [jobId,seconds]
  );
}

export async function recoverStaleJobs(): Promise<void> {
  // Disabled accounts must not continue consuming extraction/transcription resources.
  await pool.query(
    `UPDATE transcript_jobs j SET status='failed',error_code='AUTH_REQUIRED',
       error_message='This account is disabled.',retryable=false,checkout_url=NULL,
       source_url='',normalized_url='',canonical_media_id='',locked_at=NULL,locked_by=NULL,updated_at=now()
     FROM users u WHERE j.user_id=u.id AND u.account_status='disabled'
       AND j.status IN ('queued','awaiting_payment')`
  );
  await pool.query(
    `DELETE FROM quota_reservations r USING users u
     WHERE r.user_id=u.id AND u.account_status='disabled'`
  );
  await pool.query(
    `DELETE FROM billing_resume_intents b USING users u
     WHERE b.user_id=u.id AND u.account_status='disabled'`
  );
  await pool.query(
    `UPDATE transcript_jobs
     SET status='queued', locked_at=NULL, locked_by=NULL, next_attempt_at=now(), updated_at=now()
     WHERE status='processing' AND locked_at < now() - interval '10 minutes'`
  );
  await pool.query('DELETE FROM quota_reservations WHERE expires_at <= now()');
  await pool.query('DELETE FROM transcript_cache WHERE expires_at <= now()');
  // Final jobs remain as minimal accounting/idempotency records, but the original social URL
  // is not account history we need to retain. Once the transcript TTL has elapsed, scrub it.
  await pool.query(
    `UPDATE transcript_jobs
     SET source_url='', normalized_url='', canonical_media_id=''
     WHERE status IN ('completed','failed') AND transcript_cache_id IS NULL
       AND updated_at < now() - ($1 || ' hours')::interval
       AND (source_url<>'' OR normalized_url<>'' OR canonical_media_id<>'')`,
    [env().TRANSCRIPT_CACHE_HOURS]
  );
  await pool.query(`DELETE FROM media_processing_claims c WHERE c.expires_at<=now() OR NOT EXISTS (SELECT 1 FROM transcript_jobs j WHERE j.id=c.job_id AND j.status='processing')`);
  // Billing checkout sessions are not intended to keep a media URL forever.
  // After 24 hours the pending task is no longer resumable; fail it and scrub the URL
  // immediately. A fresh tool call can create a new job if the user still wants it.
  await pool.query(
    `UPDATE transcript_jobs SET status='failed',error_code='PAYMENT_SESSION_EXPIRED',
      error_message='The payment session expired. Ask the connected AI to read the video again to continue.',
      checkout_url=NULL,source_url='',normalized_url='',canonical_media_id='',updated_at=now()
     WHERE status='awaiting_payment' AND updated_at < now() - interval '24 hours'`
  );
  await pool.query('DELETE FROM billing_resume_intents WHERE expires_at <= now()');
  await pool.query(`DELETE FROM login_codes WHERE expires_at < now() - interval '1 day'`);
  await pool.query('DELETE FROM web_sessions WHERE expires_at <= now()');
  await pool.query(`DELETE FROM oauth_codes WHERE expires_at < now() - interval '1 day'`);
  await pool.query(`DELETE FROM oauth_access_tokens WHERE expires_at < now() - interval '1 day' OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '1 day')`);
  await pool.query(`DELETE FROM oauth_refresh_tokens WHERE expires_at < now() - interval '7 days' OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')`);
  // DCR registrations are disposable. Keep active/recent clients, but do not let an
  // unauthenticated registration endpoint turn into permanent database growth.
  await pool.query(`
    DELETE FROM oauth_clients c WHERE c.created_at < now() - interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM oauth_codes x WHERE x.client_id=c.client_id AND x.created_at > now() - interval '30 days')
      AND NOT EXISTS (SELECT 1 FROM oauth_access_tokens x WHERE x.client_id=c.client_id AND x.created_at > now() - interval '30 days')
      AND NOT EXISTS (SELECT 1 FROM oauth_refresh_tokens x WHERE x.client_id=c.client_id AND x.created_at > now() - interval '30 days')
  `);
}

export async function markRetry(job: JobRow, errorCode: string, message: string): Promise<void> {
  const delay = Math.min(120, 5 * 2 ** Math.max(0, job.attempts - 1));
  await pool.query(
    `UPDATE transcript_jobs SET status='queued', error_code=$2, error_message=$3, retryable=true,
      locked_at=NULL, locked_by=NULL, next_attempt_at=now() + ($4 || ' seconds')::interval, updated_at=now()
     WHERE id=$1`, [job.id, errorCode, message, delay]
  );
}

export async function markFailed(jobId: string, errorCode: string, message: string, retryable=false): Promise<void> {
  await pool.query(
    `UPDATE transcript_jobs SET status='failed', error_code=$2, error_message=$3, retryable=$4,
      locked_at=NULL, locked_by=NULL, updated_at=now() WHERE id=$1`,
    [jobId, errorCode, message, retryable]
  );
}

export async function markAwaitingPayment(jobId: string, errorCode: string, message: string, checkoutUrl: string | null): Promise<void> {
  await pool.query(
    `UPDATE transcript_jobs SET status='awaiting_payment', error_code=$2, error_message=$3, retryable=false,
      checkout_url=$4, locked_at=NULL, locked_by=NULL, updated_at=now() WHERE id=$1`,
    [jobId, errorCode, message, checkoutUrl]
  );
}

export async function markCompleted(jobId: string, cacheId: string, durationSeconds: number): Promise<void> {
  await pool.query(
    `UPDATE transcript_jobs SET status='completed', transcript_cache_id=$2, duration_seconds=$3,
      error_code=NULL, error_message=NULL, retryable=false, locked_at=NULL, locked_by=NULL,
      completed_at=now(), updated_at=now() WHERE id=$1`, [jobId, cacheId, durationSeconds]
  );
}

export async function setJobMetadata(jobId: string, canonicalId: string, durationSeconds: number): Promise<void> {
  await pool.query(
    `UPDATE transcript_jobs SET canonical_media_id=$2, duration_seconds=$3, updated_at=now() WHERE id=$1`,
    [jobId, canonicalId, durationSeconds]
  );
}

export async function planForUser(userId: string): Promise<Plan> {
  const r = await pool.query<{plan:Plan}>('SELECT plan FROM users WHERE id=$1', [userId]);
  return r.rows[0]?.plan ?? 'trial';
}

export function priorityForPlan(plan: Plan): number { return PLAN_LIMITS[plan].priority; }
