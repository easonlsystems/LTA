import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseMediaUrl } from '../media/url.js';
import { extractTextLink, resolveRedditSharePost } from '../content/linkText.js';
import { fetchBestCaption } from '../media/captions.js';
import { normalizeAudioForAsr, probeMediaDurationSeconds } from '../media/audio.js';
import { ResolverOrchestrator } from '../resolvers/orchestrator.js';
import { resolveYouTubeTranscriptFallback } from '../resolvers/youtubeTranscript.js';
import type { MediaMetadata, TranscriptSegment } from '../media/types.js';
import { transcribeAudio } from '../transcription/router.js';
import { availableUsageUnits, reserveQuota, finalizeQuota, releaseQuota } from '../quota/service.js';
import { saveCache, findCache, findUserCompletedCache } from './cache.js';
import { asLink2AIError } from '../util/errors.js';
import { canPurchaseTopup, createCheckoutSession, createTopupCheckoutSession } from '../billing/lemon.js';
import { logEvent, logErrorEvent } from '../util/log.js';
import { deferJob, deferJobToRegion, heartbeatJob, markAwaitingPayment, markCompleted, markFailed, markRetry, planForUser, setJobMetadata, type JobRow } from './jobs.js';
import { acquireMediaClaim, releaseMediaClaim } from './mediaClaims.js';
import { estimateTokens, textUsageUnits, videoUsageUnits } from '../content/limits.js';
import { regionalFallbackTarget } from './regions.js';

const resolver=new ResolverOrchestrator();

export function videoCompleteness(text:string,durationSeconds:number,segments?:Array<{end:number}>){
  const coverage=segments?.reduce((max,segment)=>Number.isFinite(segment.end)?Math.max(max,segment.end):max,0)??durationSeconds;
  const truncated=durationSeconds>0&&coverage>0&&coverage<durationSeconds-30&&coverage/durationSeconds<0.9;
  return {truncated,extractedTokenEstimate:estimateTokens(text),usageUnits:videoUsageUnits(durationSeconds),...(truncated?{truncationReason:'caption_timeline_incomplete',contentSectionsTruncated:['caption_timeline']}: {})};
}
function cachedUsageUnits(cache:{usage_units:number;source:string;transcript:string;duration_seconds:number}):number{
  return cache.usage_units>0?cache.usage_units:(cache.source==='post'||cache.source==='page'?textUsageUnits(estimateTokens(cache.transcript)):videoUsageUnits(cache.duration_seconds));
}

async function paymentUrl(job:JobRow,duration:number,code:string,details?:Record<string,unknown>):Promise<string|null>{
  const plan=await planForUser(job.user_id);
  if(code==='QUOTA_EXCEEDED'&&plan!=='trial'&&await canPurchaseTopup(job.user_id)){
    const remaining=Math.max(0,Number(details?.remaining_usage_units??0)||0);
    const requiredAtLeast=Math.max(remaining+1,Number(details?.required_usage_units_at_least??0)||0);
    const deficit=Math.max(1,requiredAtLeast-remaining);
    return await createTopupCheckoutSession(job.user_id,deficit>500?'1500':'500');
  }
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

export async function processJob(job:JobRow,runtime?:{workerRegion:string;regionOrder:string[]}):Promise<void>{
  let reserved=false;
  let tmp:string|undefined;
  let mediaClaim=false;
  const startedAt=Date.now();
  const workerRegion=runtime?.workerRegion??'local';
  const regionOrder=runtime?.regionOrder??[workerRegion];
  const heartbeat=setInterval(()=>void heartbeatJob(job.id).catch(()=>{}),60_000);
  try{
    let parsed=parseMediaUrl(job.normalized_url);
    if(parsed.platform==='reddit'&&parsed.canonicalMediaId.startsWith('share_')){
      parsed=await resolveRedditSharePost(parsed);
      await setJobMetadata(job.id,parsed.canonicalMediaId,0);
      logEvent('reddit_share_resolved',{job_id:job.id,platform:'reddit',canonical_media_id:parsed.canonicalMediaId});
    }

    if(parsed.kind!=='media'){
      await setJobMetadata(job.id,parsed.canonicalMediaId,0);
      job.duration_seconds=0;

      const userExisting=await findUserCompletedCache(job.user_id,job.platform,parsed.canonicalMediaId);
      if(userExisting){
        await markCompleted(job.id,userExisting.id,0);
        logEvent('job_completed',{job_id:job.id,platform:job.platform,source:'user_cache',content_kind:parsed.kind,duration_seconds:0,processing_ms:Date.now()-startedAt});
        return;
      }

      const existing=await findCache(job.platform,parsed.canonicalMediaId,job.language);
      if(existing){
        await reserveQuota(job.user_id,job.id,cachedUsageUnits(existing));reserved=true;
        await finalizeQuota(job.user_id,job.id);reserved=false;
        await markCompleted(job.id,existing.id,0);
        logEvent('job_completed',{job_id:job.id,platform:job.platform,source:'cache',content_kind:parsed.kind,duration_seconds:0,processing_ms:Date.now()-startedAt});
        return;
      }

      const availability=await availableUsageUnits(job.user_id,job.id);
      if(availability.remaining_usage_units<=0){
        throw new Link2AIError('QUOTA_EXCEEDED','This account has no processing units left for this source. Add processing units and try again.',402,false,{
          cause_code:'no_remaining_units',remaining_usage_units:0,required_usage_units_at_least:1
        });
      }
      mediaClaim=await acquireMediaClaim(job.platform,parsed.canonicalMediaId,job.language,job.id);
      if(!mediaClaim){
        await deferJob(job.id,3);
        logEvent('job_deferred_for_media_claim',{job_id:job.id,platform:job.platform,content_kind:parsed.kind});
        return;
      }

      const afterClaimCache=await findCache(job.platform,parsed.canonicalMediaId,job.language);
      if(afterClaimCache){
        await reserveQuota(job.user_id,job.id,cachedUsageUnits(afterClaimCache));reserved=true;
        await finalizeQuota(job.user_id,job.id);reserved=false;
        await markCompleted(job.id,afterClaimCache.id,0);
        logEvent('job_completed',{job_id:job.id,platform:job.platform,source:'cache_after_claim',content_kind:parsed.kind,duration_seconds:0,processing_ms:Date.now()-startedAt});
        return;
      }

      const content=await extractTextLink(parsed,{maxUsageUnits:availability.remaining_usage_units});
      await reserveQuota(job.user_id,job.id,content.completeness.usageUnits);reserved=true;
      const cache=await saveCache({
        platform:parsed.platform,canonicalMediaId:parsed.canonicalMediaId,sourceUrl:content.sourceUrl,
        title:content.title,creator:content.creator,caption:content.caption,durationSeconds:0,
        language:content.language,transcript:content.text,segments:[],source:content.source,completeness:content.completeness
      });
      await finalizeQuota(job.user_id,job.id);reserved=false;
      await markCompleted(job.id,cache.id,0);
      logEvent('job_completed',{job_id:job.id,platform:job.platform,source:content.source,content_kind:parsed.kind,duration_seconds:0,characters:content.text.length,extracted_token_estimate:content.completeness.extractedTokenEstimate,usage_units:content.completeness.usageUnits,truncated:content.completeness.truncated,truncation_reason:content.completeness.truncationReason??null,items_extracted:content.completeness.itemsExtracted??null,pages_extracted:content.completeness.pagesExtracted??null,processing_ms:Date.now()-startedAt});
      return;
    }

    let directCaption:{language:string;transcript:string;segments:TranscriptSegment[]}|null=null;
    let metadata:MediaMetadata;
    try{
      metadata=await resolver.metadata(parsed);
    }catch(metadataError){
      if(parsed.platform!=='youtube')throw metadataError;
      try{
        const fallback=await resolveYouTubeTranscriptFallback(parsed,job.language,45_000);
        metadata=fallback.metadata;
        directCaption=fallback.caption;
        logEvent('youtube_transcript_fallback_success',{
          job_id:job.id,platform:'youtube',canonical_media_id:metadata.canonicalMediaId,
          duration_seconds:metadata.durationSeconds,language:fallback.caption.language,transport:'youtube_transcript'
        });
      }catch(fallbackError){
        const mapped=asLink2AIError(fallbackError);
        // The fallback can distinguish regional restrictions and cloud-IP blocks that
        // yt-dlp sometimes reports only as the ambiguous "Video unavailable".
        if(['GEO_BLOCKED','PLATFORM_BLOCKED','LOGIN_REQUIRED','MEDIA_NOT_FOUND'].includes(mapped.code))throw mapped;
        throw metadataError;
      }
    }

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
      await reserveQuota(job.user_id,job.id,videoUsageUnits(metadata.durationSeconds),metadata.durationSeconds);
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
      await reserveQuota(job.user_id,job.id,videoUsageUnits(metadata.durationSeconds),metadata.durationSeconds);
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
      if(!reserved){await reserveQuota(job.user_id,job.id,videoUsageUnits(metadata.durationSeconds),metadata.durationSeconds);reserved=true;}
      await finalizeQuota(job.user_id,job.id); reserved=false;
      await markCompleted(job.id,afterClaimCache.id,metadata.durationSeconds);
      logEvent('job_completed',{job_id:job.id,platform:job.platform,source:'cache_after_claim',resolver:metadata.resolver??'unknown',duration_seconds:metadata.durationSeconds,processing_ms:Date.now()-startedAt});
      return;
    }

    const caption=directCaption??await fetchBestCaption(metadata.subtitles,metadata.automaticCaptions,job.language,metadata.originalLanguage);
    if(caption?.transcript&&metadata.durationSeconds<=0){
      const captionDuration=captionDurationSeconds(caption.segments);
      if(captionDuration>0)await applyDuration(captionDuration);
    }

    if(caption?.transcript&&metadata.durationSeconds>0){
      if(!reserved){await reserveQuota(job.user_id,job.id,videoUsageUnits(metadata.durationSeconds),metadata.durationSeconds);reserved=true;}
      const completeness=videoCompleteness(caption.transcript,metadata.durationSeconds,caption.segments);
      if(!completeness.truncated){
        const cache=await saveCache({
          platform:job.platform,canonicalMediaId:metadata.canonicalMediaId,sourceUrl:metadata.webpageUrl,
          title:metadata.title,creator:metadata.creator,caption:metadata.description,durationSeconds:metadata.durationSeconds,
          language:caption.language,transcript:caption.transcript,segments:caption.segments,source:'caption',completeness
        });
        await finalizeQuota(job.user_id,job.id); reserved=false;
        await markCompleted(job.id,cache.id,metadata.durationSeconds);
        logEvent('job_completed',{job_id:job.id,platform:job.platform,source:'caption',resolver:metadata.resolver??'unknown',duration_seconds:metadata.durationSeconds,extracted_token_estimate:estimateTokens(caption.transcript),usage_units:videoUsageUnits(metadata.durationSeconds),truncated:false,processing_ms:Date.now()-startedAt});
        return;
      }
      logEvent('caption_incomplete_fallback_asr',{job_id:job.id,platform:job.platform,duration_seconds:metadata.durationSeconds,truncation_reason:completeness.truncationReason??'caption_timeline_incomplete'});
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
    if(!reserved){await reserveQuota(job.user_id,job.id,videoUsageUnits(metadata.durationSeconds),metadata.durationSeconds);reserved=true;}

    // If captions existed but had no usable timing, the audio probe supplied the missing
    // duration. Prefer those captions now instead of spending an ASR request.
    if(caption?.transcript){
      const completeness=videoCompleteness(caption.transcript,metadata.durationSeconds,caption.segments);
      if(!completeness.truncated){
        const cache=await saveCache({
          platform:job.platform,canonicalMediaId:metadata.canonicalMediaId,sourceUrl:metadata.webpageUrl,
          title:metadata.title,creator:metadata.creator,caption:metadata.description,durationSeconds:metadata.durationSeconds,
          language:caption.language,transcript:caption.transcript,segments:caption.segments,source:'caption',completeness
        });
        await finalizeQuota(job.user_id,job.id); reserved=false;
        await markCompleted(job.id,cache.id,metadata.durationSeconds);
        logEvent('job_completed',{job_id:job.id,platform:job.platform,source:'caption_after_duration_probe',resolver:metadata.resolver??'unknown',duration_seconds:metadata.durationSeconds,truncated:false,processing_ms:Date.now()-startedAt});
        return;
      }
      logEvent('caption_incomplete_fallback_asr',{job_id:job.id,platform:job.platform,duration_seconds:metadata.durationSeconds,truncation_reason:completeness.truncationReason??'caption_timeline_incomplete'});
    }

    const preparedAudio=await normalizeAudioForAsr(audio,tmpDir);
    const asr=await transcribeAudio(preparedAudio,job.language);
    const asrCompleteness=videoCompleteness(asr.transcript,metadata.durationSeconds,asr.segments);
    if(asrCompleteness.truncated){
      throw new Link2AIError('EXTRACTION_FAILED','The full video timeline could not be transcribed reliably. No processing units were charged.',502,true,{
        cause_code:'asr_timeline_incomplete',truncation_reason:asrCompleteness.truncationReason
      });
    }
    const cache=await saveCache({
      platform:job.platform,canonicalMediaId:metadata.canonicalMediaId,sourceUrl:metadata.webpageUrl,
      title:metadata.title,creator:metadata.creator,caption:metadata.description,durationSeconds:metadata.durationSeconds,
      language:asr.language,transcript:asr.transcript,segments:asr.segments,source:'asr',completeness:asrCompleteness
    });
    await finalizeQuota(job.user_id,job.id); reserved=false;
    await markCompleted(job.id,cache.id,metadata.durationSeconds);
    logEvent('job_completed',{job_id:job.id,platform:job.platform,source:'asr',resolver:metadata.resolver??'unknown',transcription_provider:asr.provider,duration_seconds:metadata.durationSeconds,extracted_token_estimate:estimateTokens(asr.transcript),usage_units:videoUsageUnits(metadata.durationSeconds),truncated:false,processing_ms:Date.now()-startedAt});
  }catch(e){
    const err=asLink2AIError(e);
    if(reserved){await releaseQuota(job.id).catch(()=>{});reserved=false;}
    const nextRegion=regionalFallbackTarget({platform:job.platform,errorCode:err.code,regionOrder,attemptedRegions:job.attempted_regions??[],currentRegion:workerRegion});
    if(nextRegion){
      if(mediaClaim){await releaseMediaClaim(job.id).catch(()=>{});mediaClaim=false;}
      await deferJobToRegion(job.id,nextRegion,err.code,err.message);
      logEvent('job_regional_fallback',{job_id:job.id,platform:job.platform,from_region:workerRegion,to_region:nextRegion,error_code:err.code,attempted_regions:job.attempted_regions??[],processing_ms:Date.now()-startedAt});
      return;
    }
    const causeCode=typeof err.details?.cause_code==='string'?err.details.cause_code.slice(0,80):undefined;
    const transport=typeof err.details?.transport==='string'?err.details.transport.slice(0,40):undefined;
    logErrorEvent('job_error',e,{job_id:job.id,platform:job.platform,error_code:err.code,retryable:err.retryable,attempt:job.attempts,processing_ms:Date.now()-startedAt,...(causeCode?{cause_code:causeCode}:{}),...(transport?{transport}:{} )});
    if(err.code==='QUOTA_EXCEEDED'||err.code==='DURATION_LIMIT_EXCEEDED'){
      const duration=Number(job.duration_seconds??(err.details?.max_video_seconds as number|undefined)??0);
      const checkout=await paymentUrl(job,duration,err.code,err.details as Record<string,unknown>|undefined).catch(()=>null);
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
