import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseMediaUrl } from '../media/url.js';
import { fetchBestCaption } from '../media/captions.js';
import { normalizeAudioForAsr, probeMediaDurationSeconds } from '../media/audio.js';
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

function captionDurationSeconds(segments:Array<{start:number;end:number;text:string}>):number{
  let maxEnd=0;
  for(const segment of segments){
    if(Number.isFinite(segment.end)&&segment.end>maxEnd)maxEnd=segment.end;
  }
  return maxEnd>0?Math.ceil(maxEnd):0;
}

export async function processJob(job:JobRow):Promise<void>{
  let reserved=false;
  let tmp:string|undefined;
  let mediaClaim=false;
  const startedAt=Date.now();
  const heartbeat=setInterval(()=>void heartbeatJob(job.id).catch(()=>{}),60_000);
  try{
    const parsed=parseMediaUrl(job.normalized_url);
    let metadata=await resolver.metadata(parsed);

    const applyDuration=async(seconds:number):Promise<void>=>{
      const duration=Math.max(1,Math.ceil(seconds));
      metadata={...metadata,durationSeconds:duration};
      job.duration_seconds=duration;
      await setJobMetadata(job.id,metadata.canonicalMediaId,duration);
    };

    logEvent('resolver_metadata_success',{
      job_id:job.id,platform:job.platform,resolver:metadata.resolver??'unknown',
      duration_seconds:metadata.durationSeconds||null,duration_pending:metadata.durationSeconds<=0
    });
    await setJobMetadata(job.id,metadata.canonicalMediaId,metadata.durationSeconds>0?metadata.durationSeconds:null);
    if(metadata.durationSeconds>0)job.duration_seconds=metadata.durationSeconds;

    // Different share/short URLs can resolve to the same canonical video. If this user
    // already paid quota for that video while its transcript is still cached, reuse it
    // without charging the same person twice. A cached duration also safely repairs
    // platform metadata that omitted duration (currently common on some Instagram reels).
    const userExisting=await findUserCompletedCache(job.user_id,job.platform,metadata.canonicalMediaId);
    if(userExisting){
      if(metadata.durationSeconds<=0)await applyDuration(userExisting.duration_seconds);
      await markCompleted(job.id,userExisting.id,metadata.durationSeconds);
      logEvent('job_completed',{job_id:job.id,platform:job.platform,source:'user_cache',resolver:metadata.resolver??'unknown',duration_seconds:metadata.durationSeconds,processing_ms:Date.now()-startedAt});
      return;
    }

    // Look up shared cache before reservation so a missing platform duration can be
    // recovered from a previous successful transcript. New users are still charged.
    const existing=await findCache(job.platform,metadata.canonicalMediaId,job.language);
    if(existing){
      if(metadata.durationSeconds<=0)await applyDuration(existing.duration_seconds);
      await reserveQuota(job.user_id,job.id,metadata.durationSeconds);
      reserved=true;
      await finalizeQuota(job.user_id,job.id); reserved=false;
      await markCompleted(job.id,existing.id,metadata.durationSeconds);
      logEvent('job_completed',{job_id:job.id,platform:job.platform,source:'cache',resolver:metadata.resolver??'unknown',duration_seconds:metadata.durationSeconds,processing_ms:Date.now()-startedAt});
      return;
    }

    // Normal path reserves before extraction. If duration is still unknown, delay only
    // the reservation until we can derive a real duration from captions or downloaded
    // audio. ASR never starts until quota is reserved.
    if(metadata.durationSeconds>0){
      await reserveQuota(job.user_id,job.id,metadata.durationSeconds);
      reserved=true;
    }

    mediaClaim=await acquireMediaClaim(job.platform,metadata.canonicalMediaId,job.language,job.id);
    if(!mediaClaim){
      if(reserved){await releaseQuota(job.id);reserved=false;}
      await deferJob(job.id,3);
      logEvent('job_deferred_for_media_claim',{job_id:job.id,platform:job.platform});
      return;
    }

    // Re-check after winning the claim: another job may have finished between our first
    // cache lookup and claim acquisition.
    const afterClaimCache=await findCache(job.platform,metadata.canonicalMediaId,job.language);
    if(afterClaimCache){
      if(metadata.durationSeconds<=0)await applyDuration(afterClaimCache.duration_seconds);
      if(!reserved){await reserveQuota(job.user_id,job.id,metadata.durationSeconds);reserved=true;}
      await finalizeQuota(job.user_id,job.id); reserved=false;
      await markCompleted(job.id,afterClaimCache.id,metadata.durationSeconds);
      logEvent('job_completed',{job_id:job.id,platform:job.platform,source:'cache_after_claim',resolver:metadata.resolver??'unknown',duration_seconds:metadata.durationSeconds,processing_ms:Date.now()-startedAt});
      return;
    }

    const caption=await fetchBestCaption(metadata.subtitles,metadata.automaticCaptions,job.language,metadata.originalLanguage);
    if(caption?.transcript&&metadata.durationSeconds<=0){
      const captionDuration=captionDurationSeconds(caption.segments);
      if(captionDuration>0)await applyDuration(captionDuration);
    }

    if(caption?.transcript&&metadata.durationSeconds>0){
      if(!reserved){await reserveQuota(job.user_id,job.id,metadata.durationSeconds);reserved=true;}
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

    // Some public Instagram reels currently resolve successfully but omit duration in
    // yt-dlp metadata. Probe the actual downloaded media before quota reservation. This
    // prevents both false failures and under-counting / max-duration bypasses.
    if(metadata.durationSeconds<=0){
      const probedDuration=await probeMediaDurationSeconds(audio);
      await applyDuration(probedDuration);
      logEvent('resolver_duration_recovered',{job_id:job.id,platform:job.platform,duration_seconds:metadata.durationSeconds,source:'ffprobe'});
    }
    if(!reserved){await reserveQuota(job.user_id,job.id,metadata.durationSeconds);reserved=true;}

    // If captions existed but had no usable timing, the audio probe supplied the missing
    // duration. Prefer those captions now instead of spending an ASR request.
    if(caption?.transcript){
      const cache=await saveCache({
        platform:job.platform,canonicalMediaId:metadata.canonicalMediaId,sourceUrl:metadata.webpageUrl,
        title:metadata.title,creator:metadata.creator,caption:metadata.description,durationSeconds:metadata.durationSeconds,
        language:caption.language,transcript:caption.transcript,segments:caption.segments,source:'caption'
      });
      await finalizeQuota(job.user_id,job.id); reserved=false;
      await markCompleted(job.id,cache.id,metadata.durationSeconds);
      logEvent('job_completed',{job_id:job.id,platform:job.platform,source:'caption_after_duration_probe',resolver:metadata.resolver??'unknown',duration_seconds:metadata.durationSeconds,processing_ms:Date.now()-startedAt});
      return;
    }

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
      const duration=Number(job.duration_seconds??(err.details?.max_video_seconds as number|undefined)??0);
      const checkout=await paymentUrl(job,duration,err.code).catch(()=>null);
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
