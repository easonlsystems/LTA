import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import type { MediaMetadata } from '../media/types.js';
import { clipExternalText, METADATA_LIMITS } from '../media/text.js';
import type { ParsedMediaUrl, Platform } from '../media/url.js';
import { Link2AIError } from '../util/errors.js';
import { runProcess } from '../util/process.js';
import type { MediaResolver, ResolveContext } from './base.js';

type JsonRecord=Record<string,unknown>;
function object(value:unknown):JsonRecord|null{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as JsonRecord:null;}

function parsePayload(stdout:string):unknown{
  try{return JSON.parse(stdout);}
  catch{
    const lines=stdout.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    try{return lines.map(line=>JSON.parse(line));}
    catch{throw new Link2AIError('EXTRACTION_FAILED','gallery-dl returned invalid media metadata.',502,true,{cause_code:'gallery_dl_invalid_json'});}
  }
}

interface GalleryFacts{ids:string[];titles:string[];creators:string[];descriptions:string[];durations:number[];}

function collectFacts(value:unknown,out:GalleryFacts):void{
  if(Array.isArray(value)){for(const item of value)collectFacts(item,out);return;}
  const node=object(value);if(!node)return;
  for(const key of ['id','video_id','post_id','shortcode','post_shortcode']){
    const raw=node[key];
    if(typeof raw==='string'||typeof raw==='number'){const text=String(raw).trim();if(text)out.ids.push(text);}
  }
  for(const key of ['title','headline']){const raw=node[key];if(typeof raw==='string'&&raw.trim())out.titles.push(raw);}
  for(const key of ['username','author','uploader','owner']){
    const raw=node[key];
    if(typeof raw==='string'&&raw.trim())out.creators.push(raw);
    else{
      const nested=object(raw);const name=nested?.username??nested?.name??nested?.nick;
      if(typeof name==='string'&&name.trim())out.creators.push(name);
    }
  }
  for(const key of ['description','caption','content','post_text']){
    const raw=node[key];if(typeof raw==='string'&&raw.trim())out.descriptions.push(raw);
  }
  for(const key of ['duration','video_duration']){
    const raw=Number(node[key]);if(Number.isFinite(raw)&&raw>0)out.durations.push(raw);
  }
  const durationMs=Number(node.duration_ms);
  if(Number.isFinite(durationMs)&&durationMs>0)out.durations.push(durationMs/1000);
  for(const nested of Object.values(node))if(nested&&typeof nested==='object')collectFacts(nested,out);
}

function normalizeId(value:string):string{return value.trim().replace(/^post_/,'').replace(/^photo_/,'');}

function mapGalleryError(stderr:string):Link2AIError{
  const text=stderr.toLowerCase();
  if(text.includes('429')||text.includes('rate limit')||text.includes('too many requests')){
    return new Link2AIError('RATE_LIMITED','The secondary media extractor was rate-limited.',429,true,{cause_code:'gallery_dl_rate_limited'});
  }
  if(text.includes('cookie')||text.includes('login')||text.includes('sign in')){
    return new Link2AIError('EXTRACTION_FAILED','The secondary media extractor could not access this public source.',502,true,{cause_code:'gallery_dl_auth_boundary'});
  }
  return new Link2AIError('EXTRACTION_FAILED','The secondary media extractor could not read this source.',502,true,{cause_code:'gallery_dl_failed'});
}

export class GalleryDlMediaResolver implements MediaResolver{
  constructor(public readonly platform:Platform){}

  private async probe(input:ParsedMediaUrl,ctx:ResolveContext):Promise<GalleryFacts>{
    if(input.platform!=='instagram'&&input.platform!=='tiktok'){
      throw new Link2AIError('UNSUPPORTED_URL','gallery-dl media fallback is only enabled for Instagram and TikTok.',400);
    }
    const result=await runProcess('gallery-dl',['--no-input','--no-colors','--simulate','--dump-json',input.normalizedUrl],{
      timeoutMs:ctx.timeoutMs,maxOutputBytes:20_000_000
    });
    if(result.code!==0||!result.stdout.trim())throw mapGalleryError(result.stderr||result.stdout);
    const facts:GalleryFacts={ids:[],titles:[],creators:[],descriptions:[],durations:[]};
    collectFacts(parsePayload(result.stdout),facts);
    const expected=normalizeId(input.canonicalMediaId);
    const ids=[...new Set(facts.ids.map(normalizeId).filter(Boolean))];
    if(!ids.includes(expected)){
      throw new Link2AIError('EXTRACTION_FAILED','The secondary media extractor could not verify that it returned the requested media item.',502,true,{cause_code:'gallery_dl_identity_unverified'});
    }
    return facts;
  }

  async resolveMetadata(input:ParsedMediaUrl,ctx:ResolveContext):Promise<MediaMetadata>{
    const facts=await this.probe(input,ctx);
    const durationSeconds=facts.durations.length?Math.ceil(Math.max(...facts.durations)):0;
    return {
      platform:this.platform,resolver:'gallery_dl',canonicalMediaId:input.canonicalMediaId,webpageUrl:input.normalizedUrl,
      title:clipExternalText(facts.titles.find(Boolean),METADATA_LIMITS.title),
      creator:clipExternalText(facts.creators.find(Boolean),METADATA_LIMITS.creator),
      description:clipExternalText(facts.descriptions.sort((a,b)=>b.length-a.length)[0],METADATA_LIMITS.description),
      durationSeconds,subtitles:{},automaticCaptions:{}
    };
  }

  async downloadAudio(input:ParsedMediaUrl,outputDir:string,ctx:ResolveContext):Promise<string>{
    await this.probe(input,ctx);
    const result=await runProcess('gallery-dl',[
      '--no-input','--no-colors','--range','1','--directory',outputDir,
      '--filename','gallery-media.{extension}',input.normalizedUrl
    ],{timeoutMs:ctx.timeoutMs,maxOutputBytes:4_000_000});
    if(result.code!==0)throw mapGalleryError(result.stderr||result.stdout);
    const entries=await fs.readdir(outputDir,{withFileTypes:true});
    const file=entries.find(entry=>entry.isFile()&&entry.name.startsWith('gallery-media.'));
    if(!file)throw new Link2AIError('EXTRACTION_FAILED','The secondary media extractor completed without a media file.',502,true,{cause_code:'gallery_dl_no_media'});
    const fullPath=path.join(outputDir,file.name);
    const stat=await fs.stat(fullPath);
    if(stat.size<=0){
      await fs.rm(fullPath,{force:true}).catch(()=>{});
      throw new Link2AIError('EXTRACTION_FAILED','The secondary media extractor returned an empty media file.',502,true,{cause_code:'gallery_dl_empty_media'});
    }
    if(stat.size>env().MAX_DOWNLOAD_BYTES){
      await fs.rm(fullPath,{force:true}).catch(()=>{});
      throw new Link2AIError('DOWNLOAD_TOO_LARGE','The extracted media exceeds the transcription safety limit.',413);
    }
    return fullPath;
  }
}
