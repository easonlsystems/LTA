import { clipExternalText, METADATA_LIMITS } from '../media/text.js';

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
