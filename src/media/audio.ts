import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { Link2AIError } from '../util/errors.js';
import { runProcess } from '../util/process.js';

// 24 kbps keeps the maximum supported video length (120 minutes) around 21.6 MB, below the 25 MB
// upload ceiling used by lower transcription tiers while remaining adequate for speech ASR.
const MAX_ASR_FILE_BYTES=24_000_000;

export async function normalizeAudioForAsr(inputPath:string,outputDir:string):Promise<string>{
  const output=path.join(outputDir,'asr-16k-mono.mp3');
  const result=await runProcess(env().FFMPEG_BIN,[
    '-hide_banner','-loglevel','error','-xerror','-y','-i',inputPath,'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','libmp3lame','-b:a','24k',output
  ],{timeoutMs:env().AUDIO_EXTRACTION_TIMEOUT_MS,maxOutputBytes:2_000_000});
  if(result.code!==0)throw new Link2AIError('EXTRACTION_FAILED','Audio preprocessing failed.',502,false,{cause_code:'audio_preprocessing_failed',ffmpeg:result.stderr.slice(-1000)});
  const stat=await fs.stat(output).catch(()=>null);
  if(!stat||stat.size<=0)throw new Link2AIError('EXTRACTION_FAILED','Audio preprocessing produced no output.',502,false,{cause_code:'audio_preprocessing_empty'});
  if(stat.size>MAX_ASR_FILE_BYTES)throw new Link2AIError('DOWNLOAD_TOO_LARGE','The prepared audio exceeds the transcription safety limit.',413);
  return output;
}

export async function validateAudioStream(inputPath:string):Promise<void>{
  const result=await runProcess(ffprobeBin(env().FFMPEG_BIN),[
    '-v','error','-select_streams','a:0','-show_entries','stream=codec_name','-of','default=noprint_wrappers=1:nokey=1',inputPath
  ],{timeoutMs:30_000,maxOutputBytes:128_000});
  if(result.code!==0)throw new Link2AIError('EXTRACTION_FAILED','The downloaded media could not be inspected.',502,false,{cause_code:'audio_stream_probe_failed'});
  if(!result.stdout.trim())throw new Link2AIError('EXTRACTION_FAILED','The downloaded media has no audio stream.',422,false,{cause_code:'no_audio_stream'});
  if(['unknown','none'].includes(result.stdout.trim().toLowerCase()))throw new Link2AIError('EXTRACTION_FAILED','The downloaded audio codec is unsupported.',422,false,{cause_code:'unsupported_audio_codec'});
}

function ffprobeBin(ffmpegBin:string):string{
  const base=path.basename(ffmpegBin);
  return base==='ffmpeg'?path.join(path.dirname(ffmpegBin),'ffprobe'):'ffprobe';
}

export async function probeMediaDurationSeconds(inputPath:string):Promise<number>{
  const result=await runProcess(ffprobeBin(env().FFMPEG_BIN),[
    '-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',inputPath
  ],{timeoutMs:30_000,maxOutputBytes:128_000});
  if(result.code!==0){
    throw new Link2AIError('EXTRACTION_FAILED','The downloaded media duration could not be determined.',502,false,{cause_code:'duration_probe_failed',ffprobe:result.stderr.slice(-1000)});
  }
  const seconds=Number(result.stdout.trim());
  if(!Number.isFinite(seconds)||seconds<=0){
    throw new Link2AIError('EXTRACTION_FAILED','The downloaded media duration could not be determined.',502,false,{cause_code:'duration_missing'});
  }
  // Round up so quota and per-item duration limits are never under-counted.
  return Math.max(1,Math.ceil(seconds));
}

