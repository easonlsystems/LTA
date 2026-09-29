import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { assertPlatformAllowedForProfile, parseAllowedMediaUrl, type DistributionProfile } from './policy.js';
import { asLink2AIError, Link2AIError, publicErrorMessage } from '../util/errors.js';
import { availableUsageUnits, getUsageSnapshot } from '../quota/service.js';
import { estimateTokens, textUsageUnits, videoUsageUnits } from '../content/limits.js';
import { cacheProvenanceEpoch } from '../worker/cache.js';
import { planForUser, priorityForPlan } from '../worker/jobs.js';
import { recordActivationEvent } from '../analytics/product.js';
import { normalizeClientSource, type ClientSource } from './clientSource.js';
import { generalAudienceBlockReason } from '../safety/generalAudience.js';
import type { VisualAssetRef } from '../media/types.js';

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
  visual_assets?:VisualAssetRef[];
  remaining_usage_units?:number;
  required_usage_units?:number;
  topup_path?:string;
}

function sourceDomain(url:string):string|null{
  try{return new URL(url).hostname.toLowerCase().slice(0,255)||null;}catch{return null;}
}

async function beginSourceAccessEvent(userId:string,url:string,clientSource:ClientSource):Promise<number|null>{
  try{
    const r=await pool.query<{id:number}>(
      `INSERT INTO source_access_events(user_id,job_id,platform,client_source,reused,source_domain,outcome)
       VALUES($1,NULL,NULL,$2,false,$3,'requested')
       RETURNING id`,
      [userId,clientSource,sourceDomain(url)]
    );
    return r.rows[0]?.id??null;
  }catch{
    // Attribution must never block source processing.
    return null;
  }
}

async function attachSourceAccessEvent(
  accessId:number|null,
  input:{jobId?:string|null;platform?:string|null;sourceKey?:string|null;reused?:boolean;cacheHit?:boolean}
):Promise<void>{
  if(accessId===null)return;
  try{
    await pool.query(
      `UPDATE source_access_events SET
         job_id=COALESCE($2,job_id),
         platform=COALESCE($3,platform),
         source_key=COALESCE($4,source_key),
         reused=CASE WHEN $5::boolean THEN true ELSE reused END,
         cache_hit=CASE WHEN $6::boolean THEN true ELSE cache_hit END
       WHERE id=$1`,
      [accessId,input.jobId??null,input.platform??null,input.sourceKey??null,Boolean(input.reused),Boolean(input.cacheHit)]
    );
  }catch{
    // Attribution must never block source processing.
  }
}

async function failSourceAccessEvent(accessId:number|null,errorCode:string):Promise<void>{
  if(accessId===null)return;
  try{
    await pool.query(
      `UPDATE source_access_events SET outcome='failed',error_code=$2,
         processing_time_ms=GREATEST(0,(EXTRACT(EPOCH FROM (now()-created_at))*1000)::bigint),
         units_charged=0,units_refunded=0,finished_at=now()
       WHERE id=$1 AND finished_at IS NULL`,
      [accessId,errorCode]
    );
  }catch{
    // Attribution must never block source processing.
  }
}

async function finalizeSourceAccessEvents(
  userId:string,
  row:any,
  outcome:'completed'|'failed'|'quota_exceeded'
):Promise<{finished:number;unitsCharged:number;unitsRefunded:number;cacheHit:boolean}>{
  try{
    const ledger=await pool.query<{seconds:string}>(
      `SELECT COALESCE(SUM(seconds),0)::text AS seconds FROM usage_ledger WHERE user_id=$1 AND job_id=$2`,
      [userId,row.id]
    );
    const unitsCharged=Math.max(0,Math.ceil(Number(ledger.rows[0]?.seconds??0)/60));
    const reserved=Math.max(0,Number(row.analytics_reserved_usage_units??0)||0);
    const unitsRefunded=Math.max(0,reserved-unitsCharged);
    const cacheHit=Boolean(row.analytics_cache_hit);
    const sourceKey=row.platform&&row.canonical_media_id?String(row.platform)+':'+String(row.canonical_media_id):null;
    const result=await pool.query(
      `UPDATE source_access_events SET
         platform=COALESCE($3,platform),
         source_key=COALESCE($4,source_key),
         outcome=$5,
         error_code=$6,
         processing_time_ms=GREATEST(0,(EXTRACT(EPOCH FROM (now()-created_at))*1000)::bigint),
         cache_hit=(cache_hit OR $7::boolean),
         units_charged=CASE WHEN reused THEN 0 ELSE $8 END,
         units_refunded=CASE WHEN reused THEN 0 ELSE $9 END,
         finished_at=now()
       WHERE user_id=$1 AND job_id=$2 AND finished_at IS NULL`,
      [
        userId,row.id,row.platform??null,sourceKey,outcome,
        outcome==='completed'?null:String(row.error_code??(outcome==='quota_exceeded'?'QUOTA_EXCEEDED':'INTERNAL_ERROR')),
        cacheHit,unitsCharged,unitsRefunded
      ]
    );
    return {finished:result.rowCount??0,unitsCharged,unitsRefunded,cacheHit};
  }catch{
    return {finished:0,unitsCharged:0,unitsRefunded:0,cacheHit:Boolean(row?.analytics_cache_hit)};
  }
}

async function recordReadSuccessMilestones(
  userId:string,
  row:any,
  profile:DistributionProfile,
  accounting:{unitsCharged:number;unitsRefunded:number;cacheHit:boolean}
):Promise<number>{
  const sourceKey=row.platform&&row.canonical_media_id?String(row.platform)+':'+String(row.canonical_media_id):'';
  const distinct=await pool.query<{count:string}>(
    `SELECT COUNT(DISTINCT source_key)::text AS count
     FROM source_access_events
     WHERE user_id=$1 AND outcome='completed' AND source_key IS NOT NULL`,
    [userId]
  ).catch(()=>({rows:[{count:'0'}]} as any));
  const count=Math.max(0,Number(distinct.rows[0]?.count??0)||0);
  const metadata={
    job_id:String(row.id),
    source_key:sourceKey,
    source_domain:sourceDomain(String(row.normalized_url??row.source_url??'')),
    cache_hit:accounting.cacheHit,
    units_charged:accounting.unitsCharged,
    units_refunded:accounting.unitsRefunded
  };
  if(count>=1)await recordActivationEvent(userId,'first_read_success',{platform:row.platform,distributionProfile:profile,metadata});
  if(count>=2)await recordActivationEvent(userId,'second_read_success',{platform:row.platform,distributionProfile:profile,metadata});
  return count;
}


async function reviveAffordableAwaitingQuotaJob(userId:string,jobId:string):Promise<void>{
  const waiting=await pool.query<{required_usage_units:number|null}>(
    `SELECT required_usage_units FROM transcript_jobs
     WHERE id=$1 AND user_id=$2 AND status='awaiting_payment' AND error_code='QUOTA_EXCEEDED'
     LIMIT 1`,
    [jobId,userId]
  );
  if(!waiting.rowCount)return;
  const requiredRaw=waiting.rows[0].required_usage_units;
  const required=typeof requiredRaw==='number'&&Number.isFinite(requiredRaw)?Math.max(1,Math.ceil(requiredRaw)):1;
  const availability=await availableUsageUnits(userId,jobId);
  if(availability.remaining_usage_units<required)return;
  const plan=await planForUser(userId);
  await pool.query(
    `UPDATE transcript_jobs SET status='queued',priority=$3,next_attempt_at=now(),
       error_code=NULL,error_message=NULL,checkout_url=NULL,required_usage_units=NULL,retryable=true,
       locked_at=NULL,locked_by=NULL,updated_at=now()
     WHERE id=$1 AND user_id=$2 AND status='awaiting_payment' AND error_code='QUOTA_EXCEEDED'`,
    [jobId,userId,priorityForPlan(plan)]
  );
}

export async function startTranscriptJob(userId:string,url:string,options:{refresh?:boolean;profile?:DistributionProfile;clientSource?:ClientSource|string}={}):Promise<ToolJobResult>{
  const profile=options.profile??'default';
  const clientSource=normalizeClientSource(options.clientSource??(profile==='openai'?'chatgpt':'mcp'));
  const accessId=await beginSourceAccessEvent(userId,url,clientSource);
  let parsed;
  try{
    parsed=parseAllowedMediaUrl(url,profile);
  }catch(error){
    const err=asLink2AIError(error);
    await recordActivationEvent(userId,'read_requested',{
      distributionProfile:profile,
      metadata:{source_domain:sourceDomain(url),refresh:Boolean(options.refresh),client_source:clientSource,error_code:err.code,access_id:accessId}
    });
    await failSourceAccessEvent(accessId,err.code);
    throw error;
  }

  const sourceKey=`${parsed.platform}:${parsed.canonicalMediaId}`;
  await attachSourceAccessEvent(accessId,{platform:parsed.platform,sourceKey});
  await recordActivationEvent(userId,'read_requested',{
    platform:parsed.platform,distributionProfile:profile,
    metadata:{source_domain:sourceDomain(parsed.normalizedUrl),source_key:sourceKey,refresh:Boolean(options.refresh),client_source:clientSource,access_id:accessId}
  });
  await recordActivationEvent(userId,'connector_enabled',{
    platform:parsed.platform,distributionProfile:profile,
    metadata:{inferred_from:'authenticated_link_tool_call',client_source:clientSource}
  });
  await recordActivationEvent(userId,'first_link_attempt',{
    platform:parsed.platform,distributionProfile:profile,
    metadata:{refresh:Boolean(options.refresh),client_source:clientSource}
  });

  try{
    const active=await pool.query<{id:string}>(
      `SELECT j.id FROM transcript_jobs j WHERE j.user_id=$1 AND j.platform=$2
       AND (j.canonical_media_id=$3 OR j.normalized_url=$4)
       AND j.status IN ('queued','processing','awaiting_payment') ORDER BY j.created_at DESC LIMIT 1`,
      [userId,parsed.platform,parsed.canonicalMediaId,parsed.normalizedUrl]
    );
    if(active.rowCount){
      await reviveAffordableAwaitingQuotaJob(userId,active.rows[0].id);
      await attachSourceAccessEvent(accessId,{jobId:active.rows[0].id,platform:parsed.platform,sourceKey,reused:true});
      return await waitForJob(userId,active.rows[0].id,env().MCP_INLINE_WAIT_MS,profile);
    }

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
           AND NOT ($6::boolean AND jsonb_array_length(COALESCE(c.visual_assets,'[]'::jsonb))=0)
         ORDER BY j.completed_at DESC LIMIT 1`,
        [userId,parsed.platform,parsed.canonicalMediaId,parsed.normalizedUrl,provenanceEpoch,
         (parsed.platform==='instagram'&&parsed.kind==='post')||(parsed.platform==='tiktok'&&parsed.canonicalMediaId.startsWith('photo_'))]
      );
      if(completed.rowCount){
        await attachSourceAccessEvent(accessId,{jobId:completed.rows[0].id,platform:parsed.platform,sourceKey,reused:true,cacheHit:true});
        return await getJobResult(userId,completed.rows[0].id,profile);
      }
    }

    const plan=await planForUser(userId);
    const job=await pool.query<{id:string}>(
      `INSERT INTO transcript_jobs(user_id,platform,source_url,normalized_url,canonical_media_id,language,status,priority,client_source)
       VALUES($1,$2,$3,$4,$5,'auto','queued',$6,$7)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [userId,parsed.platform,parsed.sourceUrl,parsed.normalizedUrl,parsed.canonicalMediaId,priorityForPlan(plan),clientSource]
    );
    if(!job.rowCount){
      const concurrent=await pool.query<{id:string}>(
        `SELECT id FROM transcript_jobs WHERE user_id=$1 AND platform=$2 AND normalized_url=$3
         AND status IN ('queued','processing','awaiting_payment') ORDER BY created_at DESC LIMIT 1`,
        [userId,parsed.platform,parsed.normalizedUrl]
      );
      if(concurrent.rowCount){
        await reviveAffordableAwaitingQuotaJob(userId,concurrent.rows[0].id);
        await attachSourceAccessEvent(accessId,{jobId:concurrent.rows[0].id,platform:parsed.platform,sourceKey,reused:true});
        return await waitForJob(userId,concurrent.rows[0].id,env().MCP_INLINE_WAIT_MS,profile);
      }
      throw new Link2AIError('INTERNAL_ERROR','Could not create transcript job.',500,true);
    }
    const jobId=job.rows[0].id;
    await attachSourceAccessEvent(accessId,{jobId,platform:parsed.platform,sourceKey});

    // The worker owns every queued job, including a shared-cache hit. Completing it
    // here would race a worker that claims the row immediately after the insert.
    return await waitForJob(userId,jobId,env().MCP_INLINE_WAIT_MS,profile);
  }catch(error){
    const err=asLink2AIError(error);
    await failSourceAccessEvent(accessId,err.code);
    throw error;
  }
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
       c.truncated,c.truncation_reason,c.extracted_token_estimate,c.usage_units,c.items_available,c.items_extracted,c.pages_available,c.pages_extracted,c.content_sections_truncated,c.visual_assets
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
      await finalizeSourceAccessEvents(userId,{...row,error_code:'TRANSCRIPT_EXPIRED'},'failed');
      return {
        status:'failed',
        job_id:row.id,
        platform:row.platform,
        error_code:'TRANSCRIPT_EXPIRED',
        message:'This Hacker News result predates the ChatGPT-approved retrieval path. Read the original Hacker News link again to refresh it.',
        usage_units:0
      };
    }
  }
  if(row.status==='completed'&&!row.transcript){
    await finalizeSourceAccessEvents(userId,{...row,error_code:'TRANSCRIPT_EXPIRED'},'failed');
    return {status:'failed',job_id:row.id,error_code:'TRANSCRIPT_EXPIRED',message:'This temporary result has expired. Call Read link content with the original link to read it again.',usage_units:0};
  }
  if(profile==='openai'&&row.status==='completed'){
    const audienceReason=generalAudienceBlockReason({
      sourceUrl:row.normalized_url??row.source_url,
      title:row.title,
      description:row.caption,
      text:row.transcript
    });
    if(audienceReason){
      await finalizeSourceAccessEvents(userId,{...row,error_code:'CONTENT_RESTRICTED'},'failed');
      return {
        status:'failed',
        job_id:row.id,
        platform:row.platform,
        error_code:'CONTENT_RESTRICTED',
        message:'This source is outside LTA’s general-audience ChatGPT scope. No processing units were charged for this read.',
        usage_units:0
      };
    }
  }
  if(row.status==='completed'){
    await recordActivationEvent(userId,'connector_enabled',{
      platform:row.platform,distributionProfile:profile,
      metadata:{inferred_from:'authenticated_result_tool_call'}
    });
    const returnedUsageUnits=Number(row.usage_units??0)>0?Number(row.usage_units):(row.transcript_source==='post'||row.transcript_source==='page'?textUsageUnits(estimateTokens(row.transcript)):videoUsageUnits(Number(row.cache_duration??row.duration_seconds??0)));
    const accounting=await finalizeSourceAccessEvents(userId,row,'completed');
    let distinctDelivered=0;
    if(accounting.finished>0){
      await recordActivationEvent(userId,'first_successful_read',{
        platform:row.platform,distributionProfile:profile,
        metadata:{source:row.transcript_source??'unknown'}
      });
      distinctDelivered=await recordReadSuccessMilestones(userId,row,profile,accounting);
      const usage=await getUsageSnapshot(userId).catch(()=>null);
      if(usage&&!usage.quota_exempt&&usage.limit_usage_units>0&&usage.remaining_usage_units>0){
        const lowThreshold=Math.max(2,Math.ceil(usage.limit_usage_units*0.10));
        if(usage.remaining_usage_units<=lowThreshold){
          await recordActivationEvent(userId,'quota_low',{
            platform:row.platform,distributionProfile:profile,
            metadata:{
              job_id:String(row.id),
              remaining_usage_units:usage.remaining_usage_units,
              limit_usage_units:usage.limit_usage_units,
              threshold_usage_units:lowThreshold
            }
          });
        }
      }
    }
    return {
      status:'completed',job_id:row.id,platform:row.platform,source_url:row.source_url,canonical_url:row.normalized_url,source_key:`${row.platform}:${row.canonical_media_id}`,
      source_fetched_at:row.source_fetched_at?new Date(row.source_fetched_at).toISOString():null,cache_expires_at:row.cache_expires_at?new Date(row.cache_expires_at).toISOString():null,
      title:row.title,creator:row.creator,
      caption:row.caption,duration_seconds:row.cache_duration??row.duration_seconds,language:row.cache_language??'und',
      transcript:row.transcript,segments:row.segments??[],transcript_source:row.transcript_source,
      truncated:Boolean(row.truncated),truncation_reason:row.truncation_reason,extracted_token_estimate:Number(row.extracted_token_estimate??0)||estimateTokens(row.transcript),usage_units:returnedUsageUnits,
      items_available:row.items_available,items_extracted:row.items_extracted,pages_available:row.pages_available,pages_extracted:row.pages_extracted,content_sections_truncated:row.content_sections_truncated??[],
      visual_assets:Array.isArray(row.visual_assets)?row.visual_assets:[],
      ...(accounting.finished>0&&distinctDelivered===1?{message:'Source ready. Try another link.'}:{})
    };
  }
  if(row.status==='awaiting_payment'){
    const usage=await getUsageSnapshot(userId).catch(()=>null);
    const remaining=usage?.remaining_usage_units;
    const required=Number(row.required_usage_units??0)>0?Number(row.required_usage_units):undefined;
    const topupPath=profile==='openai'?undefined:'/account';
    const accounting=await finalizeSourceAccessEvents(userId,row,'quota_exceeded');
    if(accounting.finished>0){
      await recordActivationEvent(userId,'quota_exceeded',{
        platform:row.platform,distributionProfile:profile,
        metadata:{
          job_id:String(row.id),
          source_key:row.platform&&row.canonical_media_id?`${row.platform}:${row.canonical_media_id}`:null,
          source_domain:sourceDomain(String(row.normalized_url??row.source_url??'')),
          remaining_usage_units:remaining??null,
          required_usage_units:required??null,
          units_charged:0,
          units_refunded:accounting.unitsRefunded
        }
      });
    }
    return {
      status:'payment_required',
      job_id:row.id,
      duration_seconds:row.duration_seconds??undefined,
      error_code:row.error_code??'QUOTA_EXCEEDED',
      message:profile==='openai'
        ? required!==undefined&&remaining!==undefined
          ? `LTA needs ${required} processing units to read this source, but your connected account has ${remaining}. This attempt used 0 units.`
          : remaining!==undefined
            ? `LTA needs more processing units than the ${remaining} available on your connected account. This attempt used 0 units.`
            : `LTA does not have enough processing units on the connected account to read this source. This attempt used 0 units.`
        : required!==undefined&&remaining!==undefined
          ? `LTA needs ${required} processing units to read this source, but your connected account has ${remaining}. This attempt used 0 units. Open LTA → Account to add units or review your plan, then retry the same link.`
          : remaining!==undefined
            ? `LTA needs more processing units than the ${remaining} available on your connected account. This attempt used 0 units. Open LTA → Account to add units or review your plan, then retry the same link.`
            : `LTA does not have enough processing units on the connected account to read this source. This attempt used 0 units. Open LTA → Account to add units or review your plan, then retry the same link.`,
      usage_units:0,
      ...(topupPath?{topup_path:topupPath}:{}),
      ...(remaining===undefined?{}:{remaining_usage_units:remaining}),
      ...(required===undefined?{}:{required_usage_units:required})
    };
  }
  if(row.status==='failed'){
    await finalizeSourceAccessEvents(userId,row,'failed');
    return {
      status:'failed',
      job_id:row.id,
      error_code:row.error_code,
      message:publicErrorMessage(String(row.error_code??'INTERNAL_ERROR')),
      retryable:Boolean(row.retryable),
      usage_units:0
    };
  }
  return {status:'processing',job_id:row.id,message:`${env().PUBLIC_BRAND_NAME} is reading this link.`,retry_after_seconds:3};
}

export async function usageForTool(userId:string,profile:DistributionProfile='default'){
  await recordActivationEvent(userId,'connector_enabled',{distributionProfile:profile,metadata:{inferred_from:'usage_tool_call'}});
  const usage=await getUsageSnapshot(userId);
  const publicUsage={
    plan:usage.plan,
    used_usage_units:usage.used_usage_units,
    limit_usage_units:usage.limit_usage_units,
    remaining_usage_units:usage.remaining_usage_units,
    period_end:usage.period_end
  };
  if(profile==='openai')return publicUsage;
  return {
    ...publicUsage,
    concurrent_jobs:usage.concurrent_jobs,
    concurrency_limit:usage.concurrency_limit,
    quota_exempt:usage.quota_exempt,
    used_seconds:usage.used_seconds,
    limit_seconds:usage.limit_seconds,
    remaining_seconds:usage.remaining_seconds,
    used_links:usage.used_videos,
    limit_links:usage.limit_videos,
    remaining_links:usage.remaining_videos
  };
}
