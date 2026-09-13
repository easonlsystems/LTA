import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { Link2AIError } from '../util/errors.js';
import { runProcess } from '../util/process.js';

// 24 kbps keeps the V1 maximum (120 minutes) around 21.6 MB, below the 25 MB
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
  if(stat.size>MAX_ASR_FILE_BYTES)throw new Link2AIError('DOWNLOAD_TOO_LARGE','The prepared audio exceeds the V1 transcription limit.',413);
  return output;
}
