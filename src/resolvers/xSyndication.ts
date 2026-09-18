import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import type { MediaMetadata } from '../media/types.js';
import type { ParsedMediaUrl } from '../media/url.js';
import { clipExternalText, METADATA_LIMITS } from '../media/text.js';
import { Link2AIError } from '../util/errors.js';
import { safeGetBuffer } from '../util/safeHttp.js';
import type { MediaResolver, ResolveContext } from './base.js';

const UA='Link2AI/1.2 public-link-reader (+https://api-production-0383e.up.railway.app/support)';

type JsonObject=Record<string,unknown>;
function obj(v:unknown):JsonObject|null{return v!==null&&typeof v==='object'&&!Array.isArray(v)?v as JsonObject:null;}
function str(v:unknown):string{return typeof v==='string'?v:'';}
function num(v:unknown):number{return typeof v==='number'&&Number.isFinite(v)?v:0;}

export function xSyndicationToken(id:string):string{
  const n=Number(id);
  if(!Number.isFinite(n)||n<=0)return '0';
  return ((n/1e15)*Math.PI).toString(36).replace(/(0+|\.)/g,'')||'0';
}

export interface XSyndicationVideo{
  videoUrl:string;
  durationSeconds:number;
  title?:string;
  creator?:string;
  description?:string;
}

function pickMp4Variant(variants:unknown):string{
  if(!Array.isArray(variants))return '';
  const parsed=variants.flatMap(raw=>{
    const v=obj(raw);if(!v)return [];
    const type=str(v.content_type)||str(v.type);
    const url=str(v.url)||str(v.src);
    if(!url||(!/video\/mp4/i.test(type)&&!/\.mp4(?:\?|$)/i.test(url)))return [];
    return [{url,bitrate:num(v.bitrate)}];
  });
  parsed.sort((a,b)=>b.bitrate-a.bitrate);
  return parsed[0]?.url??'';
}

export function parseXSyndicationVideo(payload:unknown):XSyndicationVideo|null{
  const root=obj(payload);if(!root)return null;
  const nodes=[root,obj(root.quoted_tweet)].filter((v):v is JsonObject=>Boolean(v));
  for(const node of nodes){
    const video=obj(node.video);
    if(video){
      const videoUrl=pickMp4Variant(video.variants);
      if(videoUrl){
        const user=obj(node.user);
        return {
          videoUrl,
          durationSeconds:Math.max(0,Math.ceil(num(video.durationMs)/1000)),
          title:clipExternalText(str(node.text),METADATA_LIMITS.title),
          creator:clipExternalText(str(user?.name)||str(user?.screen_name),METADATA_LIMITS.creator),
          description:clipExternalText(str(node.text),METADATA_LIMITS.description)
        };
      }
    }
    if(Array.isArray(node.mediaDetails)){
      for(const raw of node.mediaDetails){
        const media=obj(raw);if(!media||str(media.type)!=='video')continue;
        const info=obj(media.video_info);if(!info)continue;
        const videoUrl=pickMp4Variant(info.variants);
        if(!videoUrl)continue;
        const user=obj(node.user);
        return {
          videoUrl,
          durationSeconds:Math.max(0,Math.ceil(num(info.duration_millis)/1000)),
          title:clipExternalText(str(node.text),METADATA_LIMITS.title),
          creator:clipExternalText(str(user?.name)||str(user?.screen_name),METADATA_LIMITS.creator),
          description:clipExternalText(str(node.text),METADATA_LIMITS.description)
        };
      }
    }
  }
  return null;
}

async function fetchTweet(input:ParsedMediaUrl,ctx:ResolveContext):Promise<unknown>{
  const token=xSyndicationToken(input.canonicalMediaId);
  const endpoint=`https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(input.canonicalMediaId)}&lang=en&token=${encodeURIComponent(token)}`;
  const response=await safeGetBuffer(endpoint,{maxBytes:2_000_000,timeoutMs:ctx.timeoutMs,maxRedirects:3,userAgent:UA,accept:'application/json'});
  try{return JSON.parse(response.bytes.toString('utf8'));}
  catch{throw new Link2AIError('EXTRACTION_FAILED','X returned invalid structured post metadata.',502,true,{cause_code:'x_syndication_invalid_json'});}
}

export class XSyndicationResolver implements MediaResolver{
  readonly platform='x' as const;

  async probeMetadata(input:ParsedMediaUrl,ctx:ResolveContext):Promise<MediaMetadata|null>{
    const video=parseXSyndicationVideo(await fetchTweet(input,ctx));
    if(!video)return null;
    return {
      platform:'x',
      resolver:'x_syndication',
      canonicalMediaId:input.canonicalMediaId,
      webpageUrl:input.normalizedUrl,
      title:video.title,
      creator:video.creator,
      description:video.description,
      durationSeconds:video.durationSeconds,
      subtitles:{},
      automaticCaptions:{}
    };
  }

  async resolveMetadata(input:ParsedMediaUrl,ctx:ResolveContext):Promise<MediaMetadata>{
    const metadata=await this.probeMetadata(input,ctx);
    if(!metadata)throw new Link2AIError('EXTRACTION_FAILED','This X post does not expose a readable video track.',422,false,{cause_code:'x_no_video'});
    return metadata;
  }

  async downloadAudio(input:ParsedMediaUrl,outputDir:string,ctx:ResolveContext):Promise<string>{
    const video=parseXSyndicationVideo(await fetchTweet(input,ctx));
    if(!video)throw new Link2AIError('EXTRACTION_FAILED','This X post does not expose a readable video track.',422,false,{cause_code:'x_no_video'});
    const response=await safeGetBuffer(video.videoUrl,{maxBytes:env().MAX_DOWNLOAD_BYTES,timeoutMs:ctx.timeoutMs,maxRedirects:5,userAgent:UA,accept:'video/mp4,video/*;q=0.9,*/*;q=0.2'});
    const output=path.join(outputDir,'x-video.mp4');
    await fs.writeFile(output,response.bytes);
    return output;
  }
}
