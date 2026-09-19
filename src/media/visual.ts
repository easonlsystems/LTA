import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import type { TranscriptSegment } from './types.js';
import { Link2AIError } from '../util/errors.js';
import { runProcess } from '../util/process.js';

const OCR_LANGUAGES='eng+chi_tra+chi_sim+jpn+kor';
const MAX_FRAMES=18;

function ffprobeBin(ffmpegBin:string):string{
  const base=path.basename(ffmpegBin);
  return base==='ffmpeg'?path.join(path.dirname(ffmpegBin),'ffprobe'):'ffprobe';
}

export async function mediaHasVideoStream(inputPath:string):Promise<boolean>{
  const result=await runProcess(ffprobeBin(env().FFMPEG_BIN),[
    '-v','error','-select_streams','v:0','-show_entries','stream=codec_type','-of','csv=p=0',inputPath
  ],{timeoutMs:20_000,maxOutputBytes:64_000}).catch(()=>null);
  return Boolean(result&&result.code===0&&result.stdout.split(/\r?\n/).some(line=>line.trim()==='video'));
}

function cleanOcr(raw:string):string{
  return raw.replace(/\r/g,'').split('\n').map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n').trim();
}
function fingerprint(text:string):string{return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,'').slice(0,1200);}
function meaningfulCharacters(text:string):number{return (text.match(/[\p{L}\p{N}]/gu)??[]).length;}
function clock(seconds:number):string{
  const total=Math.max(0,Math.floor(seconds)),h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;
  return h>0?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

export interface VisualOcrResult{
  transcript:string;
  segments:TranscriptSegment[];
  sampledFrames:number;
  framesWithText:number;
  intervalSeconds:number;
}

export async function extractVisualOcr(mediaPath:string,outputDir:string,durationSeconds:number):Promise<VisualOcrResult>{
  const duration=Math.max(1,Math.ceil(durationSeconds));
  const intervalSeconds=Math.max(3,Math.ceil(duration/MAX_FRAMES));
  const frameDir=path.join(outputDir,'visual-frames');
  await fs.mkdir(frameDir,{recursive:true});
  const framePattern=path.join(frameDir,'frame-%03d.jpg');
  const ffmpeg=await runProcess(env().FFMPEG_BIN,[
    '-hide_banner','-loglevel','error','-y','-i',mediaPath,
    '-vf',`fps=1/${intervalSeconds},scale=1280:-2:force_original_aspect_ratio=decrease`,
    '-frames:v',String(MAX_FRAMES),'-q:v','3',framePattern
  ],{timeoutMs:Math.min(env().AUDIO_EXTRACTION_TIMEOUT_MS,180_000),maxOutputBytes:1_000_000});
  if(ffmpeg.code!==0)throw new Link2AIError('EXTRACTION_FAILED','Visual frame extraction failed.',502,true,{cause_code:'visual_frame_extraction_failed'});

  const frames=(await fs.readdir(frameDir)).filter(name=>/^frame-\d+\.jpg$/.test(name)).sort();
  if(!frames.length)throw new Link2AIError('EXTRACTION_FAILED','This media did not expose sampleable video frames.',502,true,{cause_code:'visual_no_frames'});

  const segments:TranscriptSegment[]=[];
  let previousFingerprint='';
  for(let index=0;index<frames.length;index++){
    const ocr=await runProcess('tesseract',[
      path.join(frameDir,frames[index]),'stdout','-l',OCR_LANGUAGES,'--psm','6','quiet'
    ],{timeoutMs:30_000,maxOutputBytes:1_000_000}).catch(()=>null);
    if(!ocr||ocr.code!==0)continue;
    const text=cleanOcr(ocr.stdout);
    if(meaningfulCharacters(text)<4)continue;
    const current=fingerprint(text);
    if(!current||current===previousFingerprint)continue;
    previousFingerprint=current;
    const start=Math.min(index*intervalSeconds,Math.max(0,duration-1));
    const end=Math.min(duration,Math.max(start+1,start+intervalSeconds));
    segments.push({start,end,text:`[Visual OCR ${clock(start)}] ${text}`});
  }
  if(!segments.length)throw new Link2AIError('EXTRACTION_FAILED','No readable on-screen text was found in sampled video frames.',422,false,{cause_code:'visual_ocr_empty'});
  return {
    transcript:segments.map(segment=>segment.text).join('\n\n'),
    segments,sampledFrames:frames.length,framesWithText:segments.length,intervalSeconds
  };
}
