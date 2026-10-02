import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pool } from '../db/pool.js';
import { safeGetBuffer } from '../util/safeHttp.js';
import { sha256 } from '../util/crypto.js';
import { Link2AIError, asLink2AIError, publicErrorMessage } from '../util/errors.js';
import { clipExternalText } from '../media/text.js';
import { normalizeAudioForAsr, probeMediaDurationSeconds } from '../media/audio.js';
import { transcribeAudio } from '../transcription/router.js';
import { generalAudienceBlockReason } from '../safety/generalAudience.js';
import { estimateTokens, videoUsageUnits } from '../content/limits.js';
import { reserveQuota, finalizeQuota, releaseQuota } from '../quota/service.js';
import { saveCache } from '../worker/cache.js';
import { markCompleted, markFailed } from '../worker/jobs.js';

const MAX_USER_AUDIO_BYTES=50_000_000;
const MAX_USER_AUDIO_SECONDS=30*60;
const AUDIO_MIME_TYPES=new Set([
  'audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/aac',
  'audio/wav','audio/x-wav','audio/flac','audio/ogg','audio/webm'
]);
const AUDIO_EXTENSIONS=new Set(['mp3','m4a','aac','wav','flac','ogg','oga','webm']);

export interface OpenAiFileInput{
  download_url:string;
  file_id:string;
  mime_type?:string;
  file_name?:string;
}

export interface UserAudioResult{
  status:'processing'|'completed'|'failed';
  job_id:string;
  file_name?:string;
  duration_seconds?:number;
  language?:string;
  transcript?:string;
  segments?:Array<{start:number;end:number;text:string}>;
  usage_units?:number;
  error_code?:string|null;
  message?:string;
  retryable?:boolean;
}

function audioName(input:OpenAiFileInput):string{
  return clipExternalText(input.file_name,200)??'audio';
}

function validateAudioInput(input:OpenAiFileInput):void{
  if(!input||typeof input!=='object')throw new Link2AIError('UNSUPPORTED_URL','Attach an audio file to use this LTA tool.',400,false);
  if(typeof input.file_id!=='string'||!input.file_id.trim())throw new Link2AIError('UNSUPPORTED_URL','The ChatGPT file reference is missing.',400,false);
  let url:URL;
  try{url=new URL(input.download_url);}catch{throw new Link2AIError('UNSUPPORTED_URL','The ChatGPT file download reference is invalid.',400,false);}
  if(url.protocol!=='https:')throw new Link2AIError('UNSUPPORTED_URL','Only ChatGPT-provided HTTPS file downloads are accepted.',400,false);
  const mime=String(input.mime_type??'').toLowerCase().split(';')[0].trim();
  const name=String(input.file_name??'');
  const ext=name.toLowerCase().match(/\.([a-z0-9]{2,6})$/)?.[1]??'';
  if((mime&&!AUDIO_MIME_TYPES.has(mime))||(!mime&&ext&&!AUDIO_EXTENSIONS.has(ext))){
    throw new Link2AIError('UNSUPPORTED_URL','This ChatGPT submission accepts user-provided audio files only.',415,false);
  }
  if(!mime&&!ext)throw new Link2AIError('UNSUPPORTED_URL','The audio file type could not be verified.',415,false);
}

function canonicalAudioId(userId:string,fileId:string):string{
  return 'upload_'+sha256(userId+'\u0000'+fileId).slice(0,40);
}

async function existingAudioJob(userId:string,canonicalId:string):Promise<string|null>{
  const r=await pool.query<{id:string}>(
    `SELECT id FROM transcript_jobs
     WHERE user_id=$1 AND platform='upload' AND canonical_media_id=$2
       AND status IN ('processing','completed')
     ORDER BY created_at DESC LIMIT 1`,
    [userId,canonicalId]
  );
  return r.rows[0]?.id??null;
}

export async function getUserAudioResult(userId:string,jobId:string):Promise<UserAudioResult>{
  const r=await pool.query<any>(
    `SELECT j.id,j.status,j.error_code,j.retryable,j.duration_seconds,
            c.title,c.language,c.transcript,c.segments,c.usage_units
       FROM transcript_jobs j
       LEFT JOIN transcript_cache c ON c.id=j.transcript_cache_id
      WHERE j.id=$1 AND j.user_id=$2 AND j.platform='upload'`,
    [jobId,userId]
  );
  if(!r.rowCount)throw new Link2AIError('JOB_NOT_FOUND','This uploaded-audio job is no longer available.',404,false);
  const row=r.rows[0];
  if(row.status==='processing')return {status:'processing',job_id:row.id,message:'LTA is transcribing the attached audio.'};
  if(row.status==='completed'&&row.transcript){
    const reason=generalAudienceBlockReason({title:row.title,text:row.transcript});
    if(reason){
      return {status:'failed',job_id:row.id,error_code:'CONTENT_RESTRICTED',message:publicErrorMessage('CONTENT_RESTRICTED'),retryable:false,usage_units:0};
    }
    return {
      status:'completed',job_id:row.id,file_name:row.title??undefined,
      duration_seconds:Number(row.duration_seconds??0)||undefined,
      language:row.language??'und',transcript:String(row.transcript),
      segments:Array.isArray(row.segments)?row.segments:[],
      usage_units:Number(row.usage_units??0)||0
    };
  }
  return {
    status:'failed',job_id:row.id,error_code:row.error_code??'TRANSCRIPTION_FAILED',
    message:publicErrorMessage(String(row.error_code??'TRANSCRIPTION_FAILED')),
    retryable:Boolean(row.retryable),usage_units:0
  };
}

export async function transcribeUserAudioFile(userId:string,input:OpenAiFileInput):Promise<UserAudioResult>{
  validateAudioInput(input);
  const canonicalId=canonicalAudioId(userId,input.file_id.trim());
  const existing=await existingAudioJob(userId,canonicalId);
  if(existing)return await getUserAudioResult(userId,existing);

  const tmpDir=await fs.mkdtemp(path.join(os.tmpdir(),'lta-user-audio-'));
  let jobId:string|undefined;
  let reserved=false;
  try{
    const downloaded=await safeGetBuffer(input.download_url,{
      maxBytes:MAX_USER_AUDIO_BYTES,timeoutMs:60_000,maxRedirects:5,
      userAgent:'LTA/1.0 ChatGPT-user-file',
      accept:'audio/*,application/octet-stream;q=0.8'
    });
    const inputPath=path.join(tmpDir,'input-audio');
    await fs.writeFile(inputPath,downloaded.bytes);

    const duration=await probeMediaDurationSeconds(inputPath);
    if(duration>MAX_USER_AUDIO_SECONDS){
      throw new Link2AIError('DURATION_LIMIT_EXCEEDED','ChatGPT audio-file transcription is currently limited to 30 minutes per file.',413,false,{
        limit_seconds:MAX_USER_AUDIO_SECONDS,duration_seconds:duration
      });
    }

    const pseudoUrl='lta-user-audio://'+canonicalId;
    const inserted=await pool.query<{id:string}>(
      `INSERT INTO transcript_jobs(
         user_id,platform,source_url,normalized_url,canonical_media_id,language,status,priority,
         locked_at,locked_by,duration_seconds,client_source
       ) VALUES($1,'upload',$2,$2,$3,'auto','processing',0,now(),'api:user-audio',$4,'chatgpt')
       RETURNING id`,
      [userId,pseudoUrl,canonicalId,duration]
    );
    jobId=inserted.rows[0].id;

    const usageUnits=videoUsageUnits(duration);
    await reserveQuota(userId,jobId,usageUnits,duration);
    reserved=true;

    const prepared=await normalizeAudioForAsr(inputPath,tmpDir);
    const asr=await transcribeAudio(prepared,'auto');
    const signalChars=(asr.transcript.match(/[\p{L}\p{N}]/gu)??[]).length;
    const minimumSignalChars=Math.min(200,Math.max(8,Math.ceil(duration/60*8)));
    if(signalChars<minimumSignalChars){
      throw new Link2AIError('TRANSCRIPTION_FAILED','The uploaded audio did not contain enough reliable speech to return a transcript.',422,false,{
        cause_code:'transcript_too_sparse'
      });
    }

    const restricted=generalAudienceBlockReason({title:audioName(input),text:asr.transcript});
    if(restricted){
      throw new Link2AIError('CONTENT_RESTRICTED','This uploaded audio is outside the general-audience scope of the ChatGPT distribution.',422,false,{
        cause_code:restricted
      });
    }

    const cache=await saveCache({
      platform:'upload',
      canonicalMediaId:canonicalId,
      sourceUrl:pseudoUrl,
      title:audioName(input),
      durationSeconds:duration,
      language:asr.language,
      transcript:asr.transcript,
      segments:asr.segments,
      source:'asr',
      completeness:{
        truncated:false,
        extractedTokenEstimate:estimateTokens(asr.transcript),
        usageUnits
      }
    });
    await finalizeQuota(userId,jobId);
    reserved=false;
    await markCompleted(jobId,cache.id,duration,false);
    return await getUserAudioResult(userId,jobId);
  }catch(error){
    if(reserved&&jobId)await releaseQuota(jobId).catch(()=>{});
    if(jobId){
      const err=asLink2AIError(error);
      await markFailed(jobId,err.code,publicErrorMessage(err.code),err.retryable).catch(()=>{});
    }
    throw error;
  }finally{
    await fs.rm(tmpDir,{recursive:true,force:true}).catch(()=>{});
  }
}
