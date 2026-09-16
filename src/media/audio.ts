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
    '-hide_banner','-loglevel','error','-y','-i',inputPath,'-vn','-ac','1','-ar','16000','-c:a','libmp3lame','-b:a','24k',output
  ],{timeoutMs:env().AUDIO_EXTRACTION_TIMEOUT_MS,maxOutputBytes:2_000_000});
  if(result.code!==0)throw new Link2AIError('EXTRACTION_FAILED','Audio preprocessing failed.',502,true,{ffmpeg:result.stderr.slice(-1000)});
  const stat=await fs.stat(output).catch(()=>null);
  if(!stat||stat.size<=0)throw new Link2AIError('EXTRACTION_FAILED','Audio preprocessing produced no output.',502,true);
  if(stat.size>MAX_ASR_FILE_BYTES)throw new Link2AIError('DOWNLOAD_TOO_LARGE','The prepared audio exceeds the transcription safety limit.',413);
  return output;
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
    throw new Link2AIError('EXTRACTION_FAILED','The downloaded media duration could not be determined.',502,true,{ffprobe:result.stderr.slice(-1000)});
  }
  const seconds=Number(result.stdout.trim());
  if(!Number.isFinite(seconds)||seconds<=0){
    throw new Link2AIError('EXTRACTION_FAILED','The downloaded media duration could not be determined.',502,true);
  }
  // Round up so quota and per-item duration limits are never under-counted.
  return Math.max(1,Math.ceil(seconds));
}

