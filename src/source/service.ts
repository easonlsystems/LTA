import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { assertPlatformAllowedForProfile, parseAllowedMediaUrl, type DistributionProfile } from './policy.js';
import { asLink2AIError, Link2AIError, publicErrorMessage } from '../util/errors.js';
import { reserveQuota, finalizeQuota, getUsageSnapshot } from '../quota/service.js';
import { estimateTokens, textUsageUnits, videoUsageUnits } from '../content/limits.js';
import { cacheProvenanceEpoch, findCache } from '../worker/cache.js';
import { planForUser, priorityForPlan, markAwaitingPayment, markCompleted, setJobMetadata } from '../worker/jobs.js';
import { recordActivationEvent } from '../analytics/product.js';

export interface ToolJobResult {
  status: 'processing'|'completed'|'payment_required'|'failed';
  job_id: string;
  platform?: string;
  source_url?: string;
  canonical_url?: string;
  source_key?: string;
  source_fetched_at?: string|null;
  cache_expires_at?: string|null;
  creator?: string|null;
  title?: string|null;
  caption?: string|null;
  duration_seconds?: number;
  language?: string;
  transcript?: string;
  segments?: Array<{start:number;end:number;text:string}>;
  transcript_source?: string;
  error_code?: string|null;
  message?: string;
  retry_after_seconds?: number;
  retryable?:boolean;
  truncated?:boolean;
  truncation_reason?:string|null;
  extracted_token_estimate?:number;
  usage_units?:number;
  items_available?:number|null;
  items_extracted?:number|null;
  pages_available?:number|null;
  pages_extracted?:number|null;
  content_sections_truncated?:string[];
  remaining_usage_units?:number;
  required_usage_units?:number;
}

export async function startTranscriptJob(userId:string,url:string,options:{refresh?:boolean;profile?:DistributionProfile}={}):Promise<ToolJobResult>{
  const profile=options.profile??'default';
  const parsed=parseAllowedMediaUrl(url,profile);
  await recordActivationEvent(userId,'connector_enabled',{
    platform:parsed.platform,distributionProfile:profile,
    metadata:{inferred_from:'authenticated_link_tool_call'}
  });
  await recordActivationEvent(userId,'first_link_attempt',{
    platform:parsed.platform,distributionProfile:profile,
    metadata:{refresh:Boolean(options.refresh)}
  });
  const active=await pool.query<{id:string}>(
    `SELECT j.id FROM transcript_jobs j WHERE j.user_id=$1 AND j.platform=$2
     AND (j.canonical_media_id=$3 OR j.normalized_url=$4)
     AND j.status IN ('queued','processing','awaiting_payment') ORDER BY j.created_at DESC LIMIT 1`,
    [userId,parsed.platform,parsed.canonicalMediaId,parsed.normalizedUrl]
  );
  if(active.rowCount)return await waitForJob(userId,active.rows[0].id,env().MCP_INLINE_WAIT_MS,profile);

  // A model may call the same read tool more than once while answering. Reuse a still-cached successful result
  // for this user so retries/follow-ups do not consume quota twice. Explicit refresh bypasses successful-result
  // reuse and the shared cache, but still reuses any in-flight job to avoid duplicate concurrent processing.
  if(!options.refresh&&parsed.platform!=='x'){
    const provenanceEpoch=cacheProvenanceEpoch(parsed.platform);
    const completed=await pool.query<{id:string}>(
      `SELECT j.id FROM transcript_jobs j JOIN transcript_cache c ON c.id=j.transcript_cache_id
       WHERE j.user_id=$1 AND j.platform=$2 AND (j.canonical_media_id=$3 OR j.normalized_url=$4)
         AND j.status='completed' AND c.expires_at>now()
         AND ($5::timestamptz IS NULL OR c.created_at >= $5::timestamptz)
       ORDER BY j.completed_at DESC LIMIT 1`,
      [userId,parsed.platform,parsed.canonicalMediaId,parsed.normalizedUrl,provenanceEpoch]
    );
    if(completed.rowCount)return await getJobResult(userId,completed.rows[0].id,profile);
  }

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
    if(concurrent.rowCount)return await waitForJob(userId,concurrent.rows[0].id,env().MCP_INLINE_WAIT_MS,profile);
    throw new Link2AIError('INTERNAL_ERROR','Could not create transcript job.',500,true);
  }
  const jobId=job.rows[0].id;

  // Fast path: avoid queue/extraction when this canonical media is already cached. Explicit refresh bypasses it.
  const cached=options.refresh||parsed.platform==='x'?null:await findCache(parsed.platform,parsed.canonicalMediaId,'auto');
  if(cached){
    // Persist duration before quota evaluation so a payment-blocked cached job can be
    // resumed correctly after entitlement changes.
    await setJobMetadata(jobId,parsed.canonicalMediaId,cached.duration_seconds);
    try{
      const units=cached.usage_units>0?cached.usage_units:(cached.source==='post'||cached.source==='page'?textUsageUnits(estimateTokens(cached.transcript)):videoUsageUnits(cached.duration_seconds));
      await reserveQuota(userId,jobId,units,(cached.source==='post'||cached.source==='page')?undefined:cached.duration_seconds);
      await finalizeQuota(userId,jobId);
      await markCompleted(jobId,cached.id,cached.duration_seconds);
      return await getJobResult(userId,jobId,profile);
    }catch(e){
      const err=asLink2AIError(e);
      if(err.code==='QUOTA_EXCEEDED'){
        const requiredUnitsRaw=err.details?.required_usage_units??err.details?.required_usage_units_at_least;
        const requiredUnits=typeof requiredUnitsRaw==='number'&&Number.isFinite(requiredUnitsRaw)?requiredUnitsRaw:undefined;
        await markAwaitingPayment(jobId,err.code,err.message,null,requiredUnits);
        return await getJobResult(userId,jobId,profile);
      }
      throw e;
    }
  }
  return await waitForJob(userId,jobId,env().MCP_INLINE_WAIT_MS,profile);
}

export async function waitForJob(userId:string,jobId:string,maxWaitMs:number,profile:DistributionProfile='default'):Promise<ToolJobResult>{
  const started=Date.now();
  while(Date.now()-started<maxWaitMs){
    const r=await getJobResult(userId,jobId,profile);
    if(r.status!=='processing')return r;
    await new Promise(resolve=>setTimeout(resolve,750));
  }
  return {status:'processing',job_id:jobId,message:'The link is still being prepared. Call get_transcript_result with this job_id.',retry_after_seconds:3};
}

export async function getJobResult(userId:string,jobId:string,profile:DistributionProfile='default'):Promise<ToolJobResult>{
  const r=await pool.query<any>(
    `SELECT j.*, c.title,c.creator,c.caption,c.language AS cache_language,c.transcript,c.segments,c.source AS transcript_source,c.duration_seconds AS cache_duration,
       c.created_at AS source_fetched_at,c.expires_at AS cache_expires_at,
       c.truncated,c.truncation_reason,c.extracted_token_estimate,c.usage_units,c.items_available,c.items_extracted,c.pages_available,c.pages_extracted,c.content_sections_truncated
     FROM transcript_jobs j LEFT JOIN transcript_cache c ON c.id=j.transcript_cache_id
     WHERE j.id=$1 AND j.user_id=$2`,[jobId,userId]
  );
  if(!r.rowCount)throw new Link2AIError('JOB_NOT_FOUND','Link-reading job not found.',404);
  const row=r.rows[0];
  assertPlatformAllowedForProfile(row.platform,profile);
  const provenanceEpoch=cacheProvenanceEpoch(String(row.platform));
  if(profile==='openai'&&row.status==='completed'&&provenanceEpoch){
    const sourceFetchedAt=row.source_fetched_at?new Date(row.source_fetched_at).getTime():NaN;
    const requiredAfter=new Date(provenanceEpoch).getTime();
    if(!Number.isFinite(sourceFetchedAt)||sourceFetchedAt<requiredAfter){
      return {
        status:'failed',
        job_id:row.id,
        platform:row.platform,
        error_code:'TRANSCRIPT_EXPIRED',
        message:'This Hacker News result predates the ChatGPT-approved retrieval path. Read the original Hacker News link again to refresh it.'
      };
    }
  }
  if(row.status==='completed'&&!row.transcript){
    return {status:'failed',job_id:row.id,error_code:'TRANSCRIPT_EXPIRED',message:'This temporary result has expired. Call Read link content with the original link to read it again.'};
  }
  if(row.status==='completed'){
    await recordActivationEvent(userId,'connector_enabled',{
      platform:row.platform,distributionProfile:profile,
      metadata:{inferred_from:'authenticated_result_tool_call'}
    });
    await recordActivationEvent(userId,'first_successful_read',{
      platform:row.platform,distributionProfile:profile,
      metadata:{source:row.transcript_source??'unknown'}
    });
    const returnedUsageUnits=Number(row.usage_units??0)>0?Number(row.usage_units):(row.transcript_source==='post'||row.transcript_source==='page'?textUsageUnits(estimateTokens(row.transcript)):videoUsageUnits(Number(row.cache_duration??row.duration_seconds??0)));
    return {
      status:'completed',job_id:row.id,platform:row.platform,source_url:row.source_url,canonical_url:row.normalized_url,source_key:`${row.platform}:${row.canonical_media_id}`,
      source_fetched_at:row.source_fetched_at?new Date(row.source_fetched_at).toISOString():null,cache_expires_at:row.cache_expires_at?new Date(row.cache_expires_at).toISOString():null,
      title:row.title,creator:row.creator,
      caption:row.caption,duration_seconds:row.cache_duration??row.duration_seconds,language:row.cache_language??'und',
      transcript:row.transcript,segments:row.segments??[],transcript_source:row.transcript_source,
      truncated:Boolean(row.truncated),truncation_reason:row.truncation_reason,extracted_token_estimate:Number(row.extracted_token_estimate??0)||estimateTokens(row.transcript),usage_units:returnedUsageUnits,
      items_available:row.items_available,items_extracted:row.items_extracted,pages_available:row.pages_available,pages_extracted:row.pages_extracted,content_sections_truncated:row.content_sections_truncated??[]
    };
  }
  if(row.status==='awaiting_payment'){
    const usage=await getUsageSnapshot(userId).catch(()=>null);
    const remaining=usage?.remaining_usage_units;
    const required=Number(row.required_usage_units??0)>0?Number(row.required_usage_units):undefined;
    return {
      status:'payment_required',
      job_id:row.id,
      duration_seconds:row.duration_seconds??undefined,
      error_code:row.error_code??'QUOTA_EXCEEDED',
      message:`Link2AI could not read the full source because the connected account${remaining===undefined?' does not have enough processing units':` has ${remaining} processing units remaining`}${required===undefined?'':`, but this source requires ${required}`}. Processing units for text sources are based on the amount of source text Link2AI must retrieve, so large discussions or pull-request diffs can require multiple units. Link2AI does not intentionally return a partial source just to fit the remaining balance. No processing units were charged for this failed read. To add units or review plan options, open ${env().PUBLIC_BASE_URL}/account in your browser.`,
      usage_units:0,
      ...(remaining===undefined?{}:{remaining_usage_units:remaining}),
      ...(required===undefined?{}:{required_usage_units:required})
    };
  }
  if(row.status==='failed')return {
    status:'failed',
    job_id:row.id,
    error_code:row.error_code,
    message:publicErrorMessage(String(row.error_code??'INTERNAL_ERROR')),
    retryable:Boolean(row.retryable),
    usage_units:0
  };
  return {status:'processing',job_id:row.id,message:`${env().PUBLIC_BRAND_NAME} is reading this link.`,retry_after_seconds:3};
}

export async function usageForTool(userId:string,profile:DistributionProfile='default'){
  await recordActivationEvent(userId,'connector_enabled',{distributionProfile:profile,metadata:{inferred_from:'usage_tool_call'}});
  const usage=await getUsageSnapshot(userId);
  const authoritative={
    plan:usage.plan,
    used_usage_units:usage.used_usage_units,
    limit_usage_units:usage.limit_usage_units,
    remaining_usage_units:usage.remaining_usage_units,
    concurrent_jobs:usage.concurrent_jobs,
    concurrency_limit:usage.concurrency_limit,
    period_end:usage.period_end
  };
  if(profile==='openai')return authoritative;
  return {
    ...authoritative,
    used_seconds:usage.used_seconds,
    limit_seconds:usage.limit_seconds,
    remaining_seconds:usage.remaining_seconds,
    used_links:usage.used_videos,
    limit_links:usage.limit_videos,
    remaining_links:usage.remaining_videos
  };
}
