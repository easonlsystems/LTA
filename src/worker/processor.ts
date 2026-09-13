import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseMediaUrl } from '../media/url.js';
import { fetchBestCaption } from '../media/captions.js';
import { normalizeAudioForAsr } from '../media/audio.js';
import { ResolverOrchestrator } from '../resolvers/orchestrator.js';
import { transcribeAudio } from '../transcription/router.js';
import { reserveQuota, finalizeQuota, releaseQuota } from '../quota/service.js';
import { saveCache, findCache, findUserCompletedCache } from './cache.js';
import { asLink2AIError } from '../util/errors.js';
import { createCheckoutSession } from '../billing/lemon.js';
import { logEvent, logErrorEvent } from '../util/log.js';
import { deferJob, heartbeatJob, markAwaitingPayment, markCompleted, markFailed, markRetry, planForUser, setJobMetadata, type JobRow } from './jobs.js';
import { acquireMediaClaim, releaseMediaClaim } from './mediaClaims.js';

const resolver=new ResolverOrchestrator();

async function paymentUrl(job:JobRow,duration:number,code:string):Promise<string|null>{
  const plan=await planForUser(job.user_id);
  if(plan==='pro')return null;
  const target=plan==='trial' && duration<=30*60 && code!=='DURATION_LIMIT_EXCEEDED'?'basic':'pro';
  return await createCheckoutSession(job.user_id,target,job.id);
}

export async function processJob(job:JobRow):Promise<void>{
  let reserved=false;
  let tmp:string|undefined;
  let mediaClaim=false;
  const startedAt=Date.now();
  const heartbeat=setInterval(()=>void heartbeatJob(job.id).catch(()=>{}),60_000);
  try{
    const parsed=parseMediaUrl(job.normalized_url);
    const metadata=await resolver.metadata(parsed);
    logEvent('resolver_metadata_success',{job_id:job.id,platform:job.platform,resolver:metadata.resolver??'unknown',duration_seconds:metadata.durationSeconds});
    await setJobMetadata(job.id,metadata.canonicalMediaId,metadata.durationSeconds);

    // Different share/short URLs can resolve to the same canonical video. If this user
    // already paid quota for that video while its transcript is still cached, reuse it
    // without charging the same person twice.
    const userExisting=await findUserCompletedCache(job.user_id,job.platform,metadata.canonicalMediaId);
    if(userExisting){
      await markCompleted(job.id,userExisting.id,metadata.durationSeconds);
      logEvent('job_completed',{job_id:job.id,platform:job.platform,source:'user_cache',resolver:metadata.resolver??'unknown',duration_seconds:metadata.durationSeconds,processing_ms:Date.now()-startedAt});
      return;
    }

    await reserveQuota(job.user_id,job.id,metadata.durationSeconds);
    reserved=true;

    // Canonical id may differ after resolving a TikTok short URL.
    const existing=await findCache(job.platform,metadata.canonicalMediaId,job.language);
    if(existing){
      await finalizeQuota(job.user_id,job.id); reserved=false;
      await markCompleted(job.id,existing.id,metadata.durationSeconds);
      logEvent('job_completed',{job_id:job.id,platform:job.platform,source:'cache',resolver:metadata.resolver??'unknown',duration_seconds:metadata.durationSeconds,processing_ms:Date.now()-startedAt});
      return;
    }

    mediaClaim=await acquireMediaClaim(job.platform,metadata.canonicalMediaId,job.language,job.id);
    if(!mediaClaim){
      await releaseQuota(job.id); reserved=false;
      await deferJob(job.id,3);
      logEvent('job_deferred_for_media_claim',{job_id:job.id,platform:job.platform});
      return;
    }

    // Re-check after winning the claim: another job may have finished between our first cache lookup and claim acquisition.
    const afterClaimCache=await findCache(job.platform,metadata.canonicalMediaId,job.language);
    if(afterClaimCache){
      await finalizeQuota(job.user_id,job.id); reserved=false;
      await markCompleted(job.id,afterClaimCache.id,metadata.durationSeconds);
      logEvent('job_completed',{job_id:job.id,platform:job.platform,source:'cache_after_claim',resolver:metadata.resolver??'unknown',duration_seconds:metadata.durationSeconds,processing_ms:Date.now()-startedAt});
      return;
    }

    const caption=await fetchBestCaption(metadata.subtitles,metadata.automaticCaptions,job.language,metadata.originalLanguage);
    if(caption?.transcript){
      const cache=await saveCache({
        platform:job.platform,canonicalMediaId:metadata.canonicalMediaId,sourceUrl:metadata.webpageUrl,
        title:metadata.title,creator:metadata.creator,caption:metadata.description,durationSeconds:metadata.durationSeconds,
        language:caption.language,transcript:caption.transcript,segments:caption.segments,source:'caption'
      });
      await finalizeQuota(job.user_id,job.id); reserved=false;
      await markCompleted(job.id,cache.id,metadata.durationSeconds);
      logEvent('job_completed',{job_id:job.id,platform:job.platform,source:'caption',resolver:metadata.resolver??'unknown',duration_seconds:metadata.durationSeconds,processing_ms:Date.now()-startedAt});
      return;
    }

    const tmpDir=await fs.mkdtemp(path.join(os.tmpdir(),'link2ai-'));
    tmp=tmpDir;
    const audio=await resolver.audio(parsed,tmpDir);
    const preparedAudio=await normalizeAudioForAsr(audio,tmpDir);
    const asr=await transcribeAudio(preparedAudio,job.language);
    const cache=await saveCache({
      platform:job.platform,canonicalMediaId:metadata.canonicalMediaId,sourceUrl:metadata.webpageUrl,
      title:metadata.title,creator:metadata.creator,caption:metadata.description,durationSeconds:metadata.durationSeconds,
      language:asr.language,transcript:asr.transcript,segments:asr.segments,source:'asr'
    });
    await finalizeQuota(job.user_id,job.id); reserved=false;
    await markCompleted(job.id,cache.id,metadata.durationSeconds);
    logEvent('job_completed',{job_id:job.id,platform:job.platform,source:'asr',resolver:metadata.resolver??'unknown',transcription_provider:asr.provider,duration_seconds:metadata.durationSeconds,processing_ms:Date.now()-startedAt});
  }catch(e){
    if(reserved)await releaseQuota(job.id).catch(()=>{});
    const err=asLink2AIError(e);
    logErrorEvent('job_error',e,{job_id:job.id,platform:job.platform,error_code:err.code,retryable:err.retryable,attempt:job.attempts,processing_ms:Date.now()-startedAt});
    if(err.code==='QUOTA_EXCEEDED'||err.code==='DURATION_LIMIT_EXCEEDED'){
      const duration=Number((err.details?.max_video_seconds as number|undefined)??job.duration_seconds??0);
      const checkout=await paymentUrl(job,job.duration_seconds??duration,err.code).catch(()=>null);
      if(checkout){await markAwaitingPayment(job.id,err.code,err.message,checkout);return;}
      await markFailed(job.id,err.code,err.message,false);return;
    }
    if(err.retryable&&job.attempts<3){await markRetry(job,err.code,err.message);return;}
    await markFailed(job.id,err.code,err.message,err.retryable);
  }finally{
    clearInterval(heartbeat);
    if(mediaClaim)await releaseMediaClaim(job.id).catch(()=>{});
    if(tmp)await fs.rm(tmp,{recursive:true,force:true}).catch(()=>{});
  }
}
