import { env } from '../config/env.js';
import type { MediaMetadata, TranscriptSegment } from '../media/types.js';
import type { ParsedMediaUrl } from '../media/url.js';
import { Link2AIError } from '../util/errors.js';
import { runProcess } from '../util/process.js';
import { safeGetBuffer } from '../util/safeHttp.js';

interface HelperSuccess { ok:true; language:string; generated:boolean; segments:Array<{start:number;end:number;text:string}> }
interface HelperFailure { ok:false; error_type?:string; message?:string }
type HelperResult=HelperSuccess|HelperFailure;

function transcriptText(segments:TranscriptSegment[]):string{
  return segments.map(segment=>segment.text.trim()).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
}

async function youtubeOEmbed(input:ParsedMediaUrl,timeoutMs:number):Promise<{title?:string;creator?:string}|null>{
  const endpoint=`https://www.youtube.com/oembed?url=${encodeURIComponent(input.normalizedUrl)}&format=json`;
  try{
    const response=await safeGetBuffer(endpoint,{maxBytes:128_000,timeoutMs:Math.min(timeoutMs,12_000),maxRedirects:2,accept:'application/json'});
    const data=JSON.parse(response.bytes.toString('utf8')) as Record<string,unknown>;
    return {
      title:typeof data.title==='string'?data.title.slice(0,1000):undefined,
      creator:typeof data.author_name==='string'?data.author_name.slice(0,500):undefined
    };
  }catch{return null;}
}

function fallbackError(result:HelperFailure,exists:boolean):Link2AIError{
  const type=String(result.error_type??'');
  const message=String(result.message??'').toLowerCase();
  if(message.includes('not made this video available in your country')||message.includes('not available in your country')){
    return new Link2AIError('GEO_BLOCKED','This YouTube video is not available from Link2AI’s current server region.',451,false,{transport:'youtube_transcript'});
  }
  if(type==='RequestBlocked'||type==='IpBlocked'||message.includes('blocking requests from your ip')||message.includes('confirm you’re not a bot')||message.includes("confirm you're not a bot")){
    return new Link2AIError('PLATFORM_BLOCKED','YouTube temporarily blocked transcript access from this server. Link2AI can retry without charging a failed read.',502,true,{transport:'youtube_transcript'});
  }
  if(type==='TranscriptsDisabled'||type==='NoTranscriptFound'||type==='NoTranscriptAvailable'){
    return new Link2AIError('EXTRACTION_FAILED','No usable public YouTube transcript was available for this video.',502,true,{transport:'youtube_transcript'});
  }
  if(exists){
    return new Link2AIError('PLATFORM_BLOCKED','The YouTube video exists, but YouTube did not expose usable transcript or media access to this server.',502,true,{transport:'youtube_transcript'});
  }
  return new Link2AIError('MEDIA_NOT_FOUND','The YouTube video could not be found or is no longer publicly available.',404,false,{transport:'youtube_transcript'});
}

export async function resolveYouTubeTranscriptFallback(input:ParsedMediaUrl,requestedLanguage:string,timeoutMs:number):Promise<{
  metadata:MediaMetadata;
  caption:{language:string;transcript:string;segments:TranscriptSegment[]};
}>{
  if(input.platform!=='youtube')throw new Link2AIError('UNSUPPORTED_URL','YouTube transcript fallback only accepts YouTube videos.',400);
  const oEmbed=await youtubeOEmbed(input,timeoutMs);
  const result=await runProcess('python3',['assets/youtube_transcript.py',input.canonicalMediaId,requestedLanguage||'auto'],{
    timeoutMs:Math.min(timeoutMs,25_000),maxOutputBytes:12_000_000
  });
  if(result.code!==0){
    if(oEmbed)throw new Link2AIError('PLATFORM_BLOCKED','The YouTube video exists, but the transcript fallback could not run on this server.',502,true,{transport:'youtube_transcript'});
    throw new Link2AIError('EXTRACTION_FAILED','YouTube transcript fallback failed before returning a result.',502,true,{transport:'youtube_transcript'});
  }
  let parsed:HelperResult;
  try{parsed=JSON.parse(result.stdout) as HelperResult;}
  catch{throw new Link2AIError('EXTRACTION_FAILED','YouTube transcript fallback returned invalid data.',502,true,{transport:'youtube_transcript'});}
  if(!parsed.ok)throw fallbackError(parsed,Boolean(oEmbed));
  const segments=parsed.segments.flatMap(segment=>{
    const start=Number(segment.start),end=Number(segment.end),text=String(segment.text??'').trim();
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||!text)return [];
    return [{start,end,text} satisfies TranscriptSegment];
  });
  const transcript=transcriptText(segments);
  if(!transcript||!segments.length)throw new Link2AIError('EXTRACTION_FAILED','YouTube transcript fallback returned an empty transcript.',502,true,{transport:'youtube_transcript'});
  const durationSeconds=Math.max(1,Math.ceil(segments.reduce((max,segment)=>Math.max(max,segment.end),0)));
  const metadata:MediaMetadata={
    platform:'youtube',resolver:'external',canonicalMediaId:input.canonicalMediaId,webpageUrl:input.normalizedUrl,
    originalLanguage:parsed.language,title:oEmbed?.title,creator:oEmbed?.creator,durationSeconds,
    subtitles:{},automaticCaptions:{}
  };
  return {metadata,caption:{language:parsed.language,transcript,segments}};
}
