import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import type { MediaMetadata } from '../media/types.js';
import type { ParsedMediaUrl } from '../media/url.js';
import { Link2AIError } from '../util/errors.js';
import { safeGetBuffer } from '../util/safeHttp.js';
import type { MediaResolver, ResolveContext } from './base.js';
import { parseXSyndicationVideo, xSyndicationToken } from './xSyndicationPure.js';

export { parseXSyndicationVideo, xSyndicationToken, type XSyndicationVideo } from './xSyndicationPure.js';

const UA='Link2AI/1.2 public-link-reader (+https://api-production-0383e.up.railway.app/support)';

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
      ...(video.sensitive?{sensitive:true}:{}),
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
