import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { parseMediaUrl } from '../media/url.js';
import { createCheckoutSession } from '../billing/lemon.js';
import { asLink2AIError, Link2AIError } from '../util/errors.js';
import { reserveQuota, finalizeQuota, getUsageSnapshot } from '../quota/service.js';
import { TEXT_LINK_EQUIVALENT_SECONDS } from '../quota/plans.js';
import { findCache } from '../worker/cache.js';
import { planForUser, priorityForPlan, markAwaitingPayment, markCompleted, setJobMetadata } from '../worker/jobs.js';

export interface ToolJobResult {
  status: 'processing'|'completed'|'payment_required'|'failed';
  job_id: string;
  platform?: string;
  source_url?: string;
  creator?: string|null;
  title?: string|null;
  caption?: string|null;
  duration_seconds?: number;
  language?: string;
  transcript?: string;
  segments?: Array<{start:number;end:number;text:string}>;
  transcript_source?: string;
  checkout_url?: string|null;
  error_code?: string|null;
  message?: string;
  retry_after_seconds?: number;
}

async function checkoutForError(userId:string,jobId:string,duration:number|undefined):Promise<string|null>{
  const plan=await planForUser(userId);
  if(plan==='pro')return null;
  const target=plan==='trial' && (duration??0)<=30*60 ? 'basic' : 'pro';
  return await createCheckoutSession(userId,target,jobId);
}

export async function startTranscriptJob(userId:string,url:string):Promise<ToolJobResult>{
  const parsed=parseMediaUrl(url);
  const active=await pool.query<{id:string}>(
    `SELECT j.id FROM transcript_jobs j WHERE j.user_id=$1 AND j.platform=$2
     AND (j.canonical_media_id=$3 OR j.normalized_url=$4)
     AND j.status IN ('queued','processing','awaiting_payment') ORDER BY j.created_at DESC LIMIT 1`,
    [userId,parsed.platform,parsed.canonicalMediaId,parsed.normalizedUrl]
  );
  if(active.rowCount)return await waitForJob(userId,active.rows[0].id,env().MCP_INLINE_WAIT_MS);

  // A model may call the same read tool more than once while answering. Reuse a still-cached successful result
  // for this user so retries do not consume quota twice.
  const completed=await pool.query<{id:string}>(
    `SELECT j.id FROM transcript_jobs j JOIN transcript_cache c ON c.id=j.transcript_cache_id
     WHERE j.user_id=$1 AND j.platform=$2 AND (j.canonical_media_id=$3 OR j.normalized_url=$4)
       AND j.status='completed' AND c.expires_at>now()
     ORDER BY j.completed_at DESC LIMIT 1`,
    [userId,parsed.platform,parsed.canonicalMediaId,parsed.normalizedUrl]
  );
  if(completed.rowCount)return await getJobResult(userId,completed.rows[0].id);

  const plan=await planForUser(userId);
  const job=await pool.query<{id:string}>(
    `INSERT INTO transcript_jobs(user_id,platform,source_url,normalized_url,canonical_media_id,language,status,priority)
     VALUES($1,$2,$3,$4,$5,'auto','queued',$6)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [userId,parsed.platform,parsed.sourceUrl,parsed.normalizedUrl,parsed.canonicalMediaId,priorityForPlan(plan)]
  );
  if(!job.rowCount){
    const concurrent=await pool.query<{id:string}>(
      `SELECT id FROM transcript_jobs WHERE user_id=$1 AND platform=$2 AND normalized_url=$3
       AND status IN ('queued','processing','awaiting_payment') ORDER BY created_at DESC LIMIT 1`,
      [userId,parsed.platform,parsed.normalizedUrl]
    );
    if(concurrent.rowCount)return await waitForJob(userId,concurrent.rows[0].id,env().MCP_INLINE_WAIT_MS);
    throw new Link2AIError('INTERNAL_ERROR','Could not create transcript job.',500,true);
  }
  const jobId=job.rows[0].id;

  // Fast path: avoid queue/extraction when this canonical media is already cached.
  const cached=await findCache(parsed.platform,parsed.canonicalMediaId,'auto');
  if(cached){
    // Persist duration before quota evaluation so a payment-blocked cached job can be
    // resumed correctly after entitlement changes.
    await setJobMetadata(jobId,parsed.canonicalMediaId,cached.duration_seconds);
    try{
      await reserveQuota(userId,jobId,(cached.source==='post'||cached.source==='page')?TEXT_LINK_EQUIVALENT_SECONDS:cached.duration_seconds);
      await finalizeQuota(userId,jobId);
      await markCompleted(jobId,cached.id,cached.duration_seconds);
      return await getJobResult(userId,jobId);
    }catch(e){
      const err=asLink2AIError(e);
      if(err.code==='QUOTA_EXCEEDED'||err.code==='DURATION_LIMIT_EXCEEDED'){
        const checkout=await checkoutForError(userId,jobId,cached.duration_seconds);
        await markAwaitingPayment(jobId,err.code,err.message,checkout);
        return await getJobResult(userId,jobId);
      }
      throw e;
    }
  }
  return await waitForJob(userId,jobId,env().MCP_INLINE_WAIT_MS);
}

export async function waitForJob(userId:string,jobId:string,maxWaitMs:number):Promise<ToolJobResult>{
  const started=Date.now();
  while(Date.now()-started<maxWaitMs){
    const r=await getJobResult(userId,jobId);
    if(r.status!=='processing')return r;
    await new Promise(resolve=>setTimeout(resolve,750));
  }
  return {status:'processing',job_id:jobId,message:'The link is still being prepared. Call get_transcript_result with this job_id.',retry_after_seconds:3};
}

export async function getJobResult(userId:string,jobId:string):Promise<ToolJobResult>{
  const r=await pool.query<any>(
    `SELECT j.*, c.title,c.creator,c.caption,c.language AS cache_language,c.transcript,c.segments,c.source AS transcript_source,c.duration_seconds AS cache_duration
     FROM transcript_jobs j LEFT JOIN transcript_cache c ON c.id=j.transcript_cache_id
     WHERE j.id=$1 AND j.user_id=$2`,[jobId,userId]
  );
  if(!r.rowCount)throw new Link2AIError('JOB_NOT_FOUND','Link-reading job not found.',404);
  const row=r.rows[0];
  if(row.status==='completed'&&!row.transcript){
    return {status:'failed',job_id:row.id,error_code:'TRANSCRIPT_EXPIRED',message:'This temporary result has expired. Call Read link content with the original link to read it again.'};
  }
  if(row.status==='completed'){
    return {
      status:'completed',job_id:row.id,platform:row.platform,source_url:row.source_url,title:row.title,creator:row.creator,
      caption:row.caption,duration_seconds:row.cache_duration??row.duration_seconds,language:row.cache_language??'und',
      transcript:row.transcript,segments:row.segments??[],transcript_source:row.transcript_source
    };
  }
  if(row.status==='awaiting_payment')return {status:'payment_required',job_id:row.id,duration_seconds:row.duration_seconds??undefined,checkout_url:row.checkout_url,error_code:row.error_code,message:row.error_message};
  if(row.status==='failed')return {status:'failed',job_id:row.id,error_code:row.error_code,message:row.error_message};
  return {status:'processing',job_id:row.id,message:`${env().PUBLIC_BRAND_NAME} is reading this link.`,retry_after_seconds:3};
}

export async function usageForTool(userId:string){
  const usage=await getUsageSnapshot(userId);
  return {
    plan:usage.plan,
    used_seconds:usage.used_seconds,
    limit_seconds:usage.limit_seconds,
    remaining_seconds:usage.remaining_seconds,
    used_links:usage.used_videos,
    limit_links:usage.limit_videos,
    remaining_links:usage.remaining_videos,
    concurrent_jobs:usage.concurrent_jobs,
    concurrency_limit:usage.concurrency_limit,
    period_end:usage.period_end
  };
}
