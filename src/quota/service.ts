import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { Link2AIError } from '../util/errors.js';
import { PLAN_LIMITS, type Plan } from './plans.js';
import { usageUnitsToLegacySeconds } from '../content/limits.js';

interface Period { start: Date | null; end: Date | null; }

async function getUserAndPeriod(client: PoolClient, userId: string): Promise<{plan:Plan; period:Period; trialEligible:boolean; bonusSeconds:number; bonusVideos:number}> {
  const user = await client.query<{plan:Plan;trial_eligible:boolean;admin_bonus_seconds:number;admin_bonus_videos:number}>('SELECT plan,trial_eligible,admin_bonus_seconds,admin_bonus_videos FROM users WHERE id=$1 FOR UPDATE', [userId]);
  if (!user.rowCount) throw new Link2AIError('AUTH_REQUIRED', 'User account not found.', 401);
  const plan = user.rows[0].plan;
  const trialEligible=Boolean(user.rows[0].trial_eligible);
  const bonusSeconds=Math.max(0,Number(user.rows[0].admin_bonus_seconds??0)||0);
  const bonusVideos=Math.max(0,Number(user.rows[0].admin_bonus_videos??0)||0);
  if (plan === 'trial') return { plan, period: { start: null, end: null }, trialEligible, bonusSeconds, bonusVideos };
  const sub = await client.query<{current_period_start:Date|null; current_period_end:Date|null}>(
    `SELECT current_period_start, current_period_end FROM subscriptions
     WHERE user_id=$1 AND plan=$2 AND status IN ('active','trialing','past_due')
     ORDER BY CASE WHEN status IN ('active','trialing') THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`, [userId,plan]
  );
  if (sub.rowCount && sub.rows[0].current_period_start && sub.rows[0].current_period_end) {
    return { plan, period: { start: sub.rows[0].current_period_start, end: sub.rows[0].current_period_end }, trialEligible, bonusSeconds, bonusVideos };
  }
  const now = new Date();
  return {
    plan,
    period: {
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    },
    trialEligible,
    bonusSeconds,
    bonusVideos
  };
}

function periodSql(period: Period, alias: string): {sql:string; params:unknown[]} {
  if (!period.start || !period.end) return { sql: '', params: [] };
  return { sql: ` AND ${alias}.created_at >= $2 AND ${alias}.created_at < $3`, params: [period.start, period.end] };
}

export async function reserveQuota(userId: string, jobId: string, usageUnits: number, contentDurationSeconds?:number): Promise<void> {
  const seconds=usageUnitsToLegacySeconds(usageUnits);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { plan, period, trialEligible, bonusSeconds, bonusVideos } = await getUserAndPeriod(client, userId);
    // If a previous attempt finalized quota but crashed before marking the job completed,
    // retrying this same job must not reserve or charge it a second time.
    const finalized=await client.query('SELECT 1 FROM usage_ledger WHERE user_id=$1 AND job_id=$2',[userId,jobId]);
    if(finalized.rowCount){await client.query('COMMIT');return;}
    const limits = PLAN_LIMITS[plan];
    const limitSeconds=limits.secondsPerPeriod+bonusSeconds;
    const limitVideos=limits.videosPerPeriod===null?null:limits.videosPerPeriod+bonusVideos;
    if(plan==='trial'&&!trialEligible){
      throw new Link2AIError('QUOTA_EXCEEDED','This account is not eligible for another free trial.',402,false,{
        plan,remaining_seconds:0,remaining_videos:0
      });
    }
    if (contentDurationSeconds!==undefined&&contentDurationSeconds > limits.maxVideoSeconds) {
      throw new Link2AIError('DURATION_LIMIT_EXCEEDED', `The content behind this link exceeds the ${Math.round(limits.maxVideoSeconds/60)} minute limit for ${plan}.`, 402, false, { plan, max_video_seconds: limits.maxVideoSeconds });
    }

    await client.query('DELETE FROM quota_reservations WHERE expires_at <= now()');
    const pf = periodSql(period, 'u');
    const usage = await client.query<{seconds:string; videos:string}>(
      `SELECT COALESCE(SUM(u.seconds),0)::text AS seconds, COALESCE(SUM(u.videos),0)::text AS videos
       FROM usage_ledger u WHERE u.user_id=$1${pf.sql}`,
      [userId, ...pf.params]
    );
    const reservations = await client.query<{seconds:string; videos:string}>(
      `SELECT COALESCE(SUM(r.seconds),0)::text AS seconds, COUNT(*)::text AS videos
       FROM quota_reservations r WHERE r.user_id=$1 AND r.job_id<>$2 AND r.expires_at > now()`, [userId,jobId]
    );
    const usedSeconds = Number(usage.rows[0].seconds) + Number(reservations.rows[0].seconds);
    const usedVideos = Number(usage.rows[0].videos) + Number(reservations.rows[0].videos);
    if (usedSeconds + seconds > limitSeconds || (limitVideos !== null && usedVideos + 1 > limitVideos)) {
      throw new Link2AIError('QUOTA_EXCEEDED', 'Your plan does not have enough remaining quota for this link.', 402, false, {
        plan,
        remaining_seconds: Math.max(0, limitSeconds - usedSeconds),
        remaining_videos: limitVideos === null ? null : Math.max(0, limitVideos - usedVideos)
        ,remaining_usage_units:Math.floor(Math.max(0,limitSeconds-usedSeconds)/60)
      });
    }
    await client.query(
      `INSERT INTO quota_reservations(user_id, job_id, seconds, expires_at)
       VALUES($1,$2,$3,now() + interval '60 minutes')
       ON CONFLICT(job_id) DO UPDATE SET seconds=EXCLUDED.seconds, expires_at=EXCLUDED.expires_at`,
      [userId, jobId, seconds]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}

export async function finalizeQuota(userId: string, jobId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { period } = await getUserAndPeriod(client, userId);
    const reservation = await client.query<{seconds:number}>(
      'SELECT seconds FROM quota_reservations WHERE user_id=$1 AND job_id=$2 FOR UPDATE', [userId, jobId]
    );
    if (!reservation.rowCount) {
      // Idempotency: an already-finalized job has a ledger row.
      const existing = await client.query('SELECT 1 FROM usage_ledger WHERE job_id=$1', [jobId]);
      if (existing.rowCount) { await client.query('COMMIT'); return; }
      throw new Link2AIError('INTERNAL_ERROR', 'Quota reservation disappeared before completion.', 500);
    }
    await client.query(
      `INSERT INTO usage_ledger(user_id, job_id, seconds, videos, billing_period_start, billing_period_end)
       VALUES($1,$2,$3,1,$4,$5) ON CONFLICT(job_id) DO NOTHING`,
      [userId, jobId, reservation.rows[0].seconds, period.start, period.end]
    );
    await client.query('DELETE FROM quota_reservations WHERE job_id=$1', [jobId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}

export async function releaseQuota(jobId: string): Promise<void> {
  await pool.query('DELETE FROM quota_reservations WHERE job_id=$1', [jobId]);
}

export interface UsageSnapshot {
  plan: Plan;
  used_seconds: number;
  limit_seconds: number;
  remaining_seconds: number;
  used_videos: number;
  limit_videos: number | null;
  remaining_videos: number | null;
  concurrent_jobs: number;
  concurrency_limit: number;
  period_end: string | null;
  used_usage_units:number;
  limit_usage_units:number;
  remaining_usage_units:number;
}

export async function getUsageSnapshot(userId: string): Promise<UsageSnapshot> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { plan, period, trialEligible, bonusSeconds, bonusVideos } = await getUserAndPeriod(client, userId);
    const limits = PLAN_LIMITS[plan];
    const limitSeconds=limits.secondsPerPeriod+bonusSeconds;
    const limitVideos=limits.videosPerPeriod===null?null:limits.videosPerPeriod+bonusVideos;
    const pf = periodSql(period, 'u');
    const usage = await client.query<{seconds:string; videos:string}>(
      `SELECT COALESCE(SUM(u.seconds),0)::text seconds, COALESCE(SUM(u.videos),0)::text videos
       FROM usage_ledger u WHERE u.user_id=$1${pf.sql}`, [userId, ...pf.params]
    );
    const active = await client.query<{count:string}>(
      `SELECT COUNT(*)::text count FROM transcript_jobs WHERE user_id=$1 AND status='processing'`, [userId]
    );
    await client.query('COMMIT');
    const usedSeconds = Number(usage.rows[0].seconds);
    const usedVideos = Number(usage.rows[0].videos);
    return {
      plan,
      used_seconds: usedSeconds,
      limit_seconds: plan==='trial'&&!trialEligible?0:limitSeconds,
      remaining_seconds: plan==='trial'&&!trialEligible?0:Math.max(0, limitSeconds - usedSeconds),
      used_videos: usedVideos,
      limit_videos: plan==='trial'&&!trialEligible?0:limitVideos,
      remaining_videos: plan==='trial'&&!trialEligible?0:(limitVideos === null ? null : Math.max(0, limitVideos - usedVideos)),
      concurrent_jobs: Number(active.rows[0].count),
      concurrency_limit: limits.concurrency,
      period_end: period.end?.toISOString() ?? null
      ,used_usage_units:Math.ceil(usedSeconds/60)
      ,limit_usage_units:Math.floor((plan==='trial'&&!trialEligible?0:limitSeconds)/60)
      ,remaining_usage_units:Math.floor((plan==='trial'&&!trialEligible?0:Math.max(0,limitSeconds-usedSeconds))/60)
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}
