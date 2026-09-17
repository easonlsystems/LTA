import fs from 'node:fs/promises';
import path from 'node:path';
import type { MediaMetadata } from '../media/types.js';
import { clipExternalText, METADATA_LIMITS } from '../media/text.js';
import type { ParsedMediaUrl, Platform } from '../media/url.js';
import { env } from '../config/env.js';
import { Link2AIError } from '../util/errors.js';
import type { MediaResolver, ResolveContext } from './base.js';
import { validateResolvedMediaIdentity } from './identity.js';

async function readLimitedJson(response:Response,maxBytes=2_000_000):Promise<any>{
  if(!response.body)throw new Link2AIError('EXTRACTION_FAILED','External extractor returned an empty response.',502,true);
  const declared=Number(response.headers.get('content-length')??0);
  if(Number.isFinite(declared)&&declared>maxBytes){
    await response.body.cancel().catch(()=>{});
    throw new Link2AIError('EXTRACTION_FAILED','External extractor metadata exceeded safety limit.',502,true);
  }
  const reader=response.body.getReader();
  const chunks:Uint8Array[]=[];let total=0;
  while(true){
    const {done,value}=await reader.read();if(done)break;if(!value)continue;
    total+=value.byteLength;
    if(total>maxBytes){await reader.cancel().catch(()=>{});throw new Link2AIError('EXTRACTION_FAILED','External extractor metadata exceeded safety limit.',502,true);}
    chunks.push(value);
  }
  const bytes=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}
  catch{throw new Link2AIError('EXTRACTION_FAILED','External extractor returned invalid JSON.',502,true);}
}

/**
 * Optional paid/managed fallback. The provider contract is deliberately tiny:
 * POST {url, mode:"metadata"} -> MediaMetadata-like JSON
 * POST {url, mode:"audio"} -> audio bytes
 * This keeps Link2AI independent of any extraction vendor.
 */
export class ExternalProviderResolver implements MediaResolver {
  constructor(public readonly platform: Platform) {}

  private headers(): Record<string,string> {
    return {
      'content-type': 'application/json',
      ...(env().MEDIA_PROVIDER_API_KEY ? { authorization: `Bearer ${env().MEDIA_PROVIDER_API_KEY}` } : {})
    };
  }

  async resolveMetadata(input: ParsedMediaUrl, ctx: ResolveContext): Promise<MediaMetadata> {
    const providerUrl=env().MEDIA_PROVIDER_URL;
    if (!providerUrl) throw new Link2AIError('EXTRACTION_FAILED', 'No external extraction provider is configured.', 502, true);
    let response: Response;
    try {
      response = await fetch(providerUrl, {
        method: 'POST', headers: this.headers(),
        body: JSON.stringify({ url: input.normalizedUrl, mode: 'metadata', platform: this.platform }),
        signal: AbortSignal.timeout(ctx.timeoutMs)
      });
    } catch (error) {
      throw new Link2AIError('EXTRACTION_FAILED', 'External extractor request failed before a response was received.', 502, true, {
        cause: error instanceof Error ? error.name : 'network_error'
      });
    }
    if (!response.ok) throw new Link2AIError('EXTRACTION_FAILED', `External extractor returned HTTP ${response.status}.`, 502, true);
    const data = await readLimitedJson(response) as Partial<MediaMetadata>;
    const duration=Math.round(Number(data.durationSeconds));
    const canonicalMediaId=clipExternalText(data.canonicalMediaId,METADATA_LIMITS.canonicalId)??'';
    if (!Number.isFinite(duration)||duration<=0||!canonicalMediaId) throw new Link2AIError('EXTRACTION_FAILED', 'External extractor returned incomplete metadata.', 502, true);
    const webpageUrl=clipExternalText(data.webpageUrl,METADATA_LIMITS.subtitleUrl);
    validateResolvedMediaIdentity(input,canonicalMediaId,webpageUrl);
    return {
      platform: this.platform,
      resolver: 'external',
      canonicalMediaId,
      webpageUrl: webpageUrl??input.normalizedUrl,
      originalLanguage: clipExternalText(data.originalLanguage,METADATA_LIMITS.language),
      title: clipExternalText(data.title,METADATA_LIMITS.title),
      creator: clipExternalText(data.creator,METADATA_LIMITS.creator),
      description: clipExternalText(data.description,METADATA_LIMITS.description),
      durationSeconds: duration,
      subtitles: data.subtitles && typeof data.subtitles==='object' ? data.subtitles : {},
      automaticCaptions: data.automaticCaptions && typeof data.automaticCaptions==='object' ? data.automaticCaptions : {}
    };
  }

  async downloadAudio(input: ParsedMediaUrl, outputDir: string, ctx: ResolveContext): Promise<string> {
    const providerUrl=env().MEDIA_PROVIDER_URL;
    if (!providerUrl) throw new Link2AIError('EXTRACTION_FAILED', 'No external extraction provider is configured.', 502, true);
    let response: Response;
    try {
      response = await fetch(providerUrl, {
        method: 'POST', headers: this.headers(),
        body: JSON.stringify({ url: input.normalizedUrl, mode: 'audio', platform: this.platform }),
        signal: AbortSignal.timeout(ctx.timeoutMs)
      });
    } catch (error) {
      throw new Link2AIError('EXTRACTION_FAILED', 'External audio extractor request failed before a response was received.', 502, true, {
        cause: error instanceof Error ? error.name : 'network_error'
      });
    }
    if (!response.ok || !response.body) throw new Link2AIError('EXTRACTION_FAILED', `External audio extractor returned HTTP ${response.status}.`, 502, true);
    const declaredLength=Number(response.headers.get('content-length')??0);
    if(Number.isFinite(declaredLength)&&declaredLength>env().MAX_DOWNLOAD_BYTES){
      await response.body.cancel().catch(()=>{});
      throw new Link2AIError('DOWNLOAD_TOO_LARGE','External audio exceeded safety limit.',413);
    }
    const file = path.join(outputDir, 'audio-provider.mp3');
    const handle=await fs.open(file,'w');
    let total=0;
    try{
      const reader=response.body.getReader();
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        if(!value)continue;
        total+=value.byteLength;
        if(total>env().MAX_DOWNLOAD_BYTES){
          await reader.cancel().catch(()=>{});
          throw new Link2AIError('DOWNLOAD_TOO_LARGE','External audio exceeded safety limit.',413);
        }
        await handle.write(value);
      }
      if(total<=0)throw new Link2AIError('EXTRACTION_FAILED','External audio extractor returned an empty body.',502,true);
      return file;
    }catch(err){
      await fs.rm(file,{force:true}).catch(()=>{});
      throw err;
    }finally{
      await handle.close().catch(()=>{});
    }
  }
}
