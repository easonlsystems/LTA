import type { MediaMetadata } from '../media/types.js';
import type { ParsedMediaUrl } from '../media/url.js';
import { env } from '../config/env.js';
import { asLink2AIError } from '../util/errors.js';
import { ExternalProviderResolver } from './external.js';
import { YtDlpResolver } from './ytdlp.js';
import { runProviderChain, type ProviderAttempt } from './providerChain.js';
import { shouldTryExternalFallback } from './fallback.js';
import { XSyndicationResolver } from './xSyndication.js';
import { normalizeAudioForAsr, probeMediaDurationSeconds, validateAudioStream } from '../media/audio.js';

export interface ResolvedAudio {path:string;durationSeconds:number}

function shouldFailoverFromXSyndicationAudio(error:unknown):boolean{
  const code=asLink2AIError(error).code;
  return shouldTryExternalFallback(error)||code==='DOWNLOAD_TOO_LARGE'||code==='MEDIA_NOT_FOUND';
}

export class ResolverOrchestrator {
  private readonly xSyndication=new XSyndicationResolver();

  private externalMetadataAttempt(input:ParsedMediaUrl):ProviderAttempt<MediaMetadata>[]{
    if(!env().MEDIA_PROVIDER_URL)return [];
    return [{
      name:'external',
      run:()=>new ExternalProviderResolver(input.platform).resolveMetadata(input,{timeoutMs:env().EXTRACTION_TIMEOUT_MS})
    }];
  }

  private externalAudioAttempt(input:ParsedMediaUrl,outputDir:string):ProviderAttempt<ResolvedAudio>[]{
    if(!env().MEDIA_PROVIDER_URL)return [];
    return [{
      name:'external',
      run:async()=>{
        const file=await new ExternalProviderResolver(input.platform).downloadAudio(input,outputDir,{timeoutMs:env().AUDIO_EXTRACTION_TIMEOUT_MS});
        await validateAudioStream(file);
        const durationSeconds=await probeMediaDurationSeconds(file);
        return {path:await normalizeAudioForAsr(file,outputDir),durationSeconds};
      }
    }];
  }

  async probeXVideoMetadata(input:ParsedMediaUrl):Promise<MediaMetadata|null>{
    if(input.platform!=='x')return null;
    return await runProviderChain<MediaMetadata|null>({
      platform:'x',
      operation:'metadata',
      attempts:[
        {
          name:'x_syndication',
          run:()=>this.xSyndication.probeMetadata(input,{timeoutMs:env().EXTRACTION_TIMEOUT_MS})
        },
        ...this.externalMetadataAttempt(input)
      ]
    });
  }

  async metadata(input:ParsedMediaUrl):Promise<MediaMetadata>{
    const attempts:ProviderAttempt<MediaMetadata>[]=input.platform==='x'
      ?[
          {
            name:'x_syndication',
            run:()=>this.xSyndication.resolveMetadata(input,{timeoutMs:env().EXTRACTION_TIMEOUT_MS})
          },
          ...this.externalMetadataAttempt(input)
        ]
      :[
          {
            name:'ytdlp',
            run:()=>new YtDlpResolver(input.platform).resolveMetadata(input,{timeoutMs:env().EXTRACTION_TIMEOUT_MS})
          },
          ...this.externalMetadataAttempt(input)
        ];
    return await runProviderChain({platform:input.platform,operation:'metadata',attempts});
  }

  async audio(input:ParsedMediaUrl,outputDir:string):Promise<ResolvedAudio>{
    const usable=async(download:()=>Promise<string>):Promise<ResolvedAudio>=>{
      const file=await download();
      await validateAudioStream(file);
      const durationSeconds=await probeMediaDurationSeconds(file);
      return {path:await normalizeAudioForAsr(file,outputDir),durationSeconds};
    };
    const attempts:ProviderAttempt<ResolvedAudio>[]=input.platform==='x'
      ?[
          {
            name:'x_syndication',
            run:()=>usable(()=>this.xSyndication.downloadAudio(input,outputDir,{timeoutMs:env().AUDIO_EXTRACTION_TIMEOUT_MS})),
            shouldFailover:shouldFailoverFromXSyndicationAudio
          },
          {
            name:'ytdlp',
            run:()=>usable(()=>new YtDlpResolver('x').downloadAudio(input,outputDir,{timeoutMs:env().AUDIO_EXTRACTION_TIMEOUT_MS}))
          },
          ...this.externalAudioAttempt(input,outputDir)
        ]
      :[
          {
            name:'ytdlp',
            run:()=>usable(()=>new YtDlpResolver(input.platform).downloadAudio(input,outputDir,{timeoutMs:env().AUDIO_EXTRACTION_TIMEOUT_MS}))
          },
          ...this.externalAudioAttempt(input,outputDir)
        ];
    return await runProviderChain({platform:input.platform,operation:'audio',attempts});
  }
}
