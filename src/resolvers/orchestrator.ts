import type { MediaMetadata } from '../media/types.js';
import type { ParsedMediaUrl } from '../media/url.js';
import { env } from '../config/env.js';
import { asLink2AIError } from '../util/errors.js';
import { ExternalProviderResolver } from './external.js';
import { GalleryDlMediaResolver } from './galleryDl.js';
import { YtDlpResolver } from './ytdlp.js';
import { runProviderChain, type ProviderAttempt } from './providerChain.js';
import { shouldTryExternalFallback } from './fallback.js';
import { XSyndicationResolver } from './xSyndication.js';

function shouldFailoverFromXSyndicationAudio(error:unknown):boolean{
  const code=asLink2AIError(error).code;
  return shouldTryExternalFallback(error)||code==='DOWNLOAD_TOO_LARGE'||code==='MEDIA_NOT_FOUND';
}

export class ResolverOrchestrator {
  private readonly xSyndication=new XSyndicationResolver();

  private externalMetadataAttempt(input:ParsedMediaUrl):ProviderAttempt<MediaMetadata>[]{
    if(!env().MEDIA_PROVIDER_URL)return [];
    return [{
      name:'external',family:'external:media_default',
      run:()=>new ExternalProviderResolver(input.platform).resolveMetadata(input,{timeoutMs:env().EXTRACTION_TIMEOUT_MS})
    }];
  }

  private externalAudioAttempt(input:ParsedMediaUrl,outputDir:string):ProviderAttempt<string>[]{
    if(!env().MEDIA_PROVIDER_URL)return [];
    return [{
      name:'external',family:'external:media_default',
      run:()=>new ExternalProviderResolver(input.platform).downloadAudio(input,outputDir,{timeoutMs:env().AUDIO_EXTRACTION_TIMEOUT_MS})
    }];
  }

  private galleryMetadataAttempt(input:ParsedMediaUrl):ProviderAttempt<MediaMetadata>[]{
    if(input.platform!=='instagram'&&input.platform!=='tiktok')return [];
    return [{name:'gallery_dl_media',family:'local:gallery_dl',run:()=>new GalleryDlMediaResolver(input.platform).resolveMetadata(input,{timeoutMs:env().EXTRACTION_TIMEOUT_MS})}];
  }

  private galleryAudioAttempt(input:ParsedMediaUrl,outputDir:string):ProviderAttempt<string>[]{
    if(input.platform!=='instagram'&&input.platform!=='tiktok')return [];
    return [{name:'gallery_dl_media',family:'local:gallery_dl',run:()=>new GalleryDlMediaResolver(input.platform).downloadAudio(input,outputDir,{timeoutMs:env().AUDIO_EXTRACTION_TIMEOUT_MS})}];
  }

  async probeXVideoMetadata(input:ParsedMediaUrl):Promise<MediaMetadata|null>{
    if(input.platform!=='x')return null;
    return await runProviderChain<MediaMetadata|null>({
      platform:'x',
      operation:'metadata',
      attempts:[
        {
          name:'x_syndication',family:'public:x_syndication',
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
            name:'x_syndication',family:'public:x_syndication',
            run:()=>this.xSyndication.resolveMetadata(input,{timeoutMs:env().EXTRACTION_TIMEOUT_MS})
          },
          ...this.externalMetadataAttempt(input)
        ]
      :[
          {
            name:'ytdlp',family:'local:yt_dlp',
            run:()=>new YtDlpResolver(input.platform).resolveMetadata(input,{timeoutMs:env().EXTRACTION_TIMEOUT_MS})
          },
          ...this.galleryMetadataAttempt(input),
          ...this.externalMetadataAttempt(input)
        ];
    return await runProviderChain({platform:input.platform,operation:'metadata',attempts});
  }

  async visual(input:ParsedMediaUrl,outputDir:string):Promise<string>{
    const attempts:ProviderAttempt<string>[]=input.platform==='x'
      ?[
          {
            name:'x_syndication_visual',family:'public:x_syndication',
            run:()=>this.xSyndication.downloadAudio(input,outputDir,{timeoutMs:env().AUDIO_EXTRACTION_TIMEOUT_MS}),
            shouldFailover:shouldFailoverFromXSyndicationAudio
          },
          {
            name:'ytdlp_visual',family:'local:yt_dlp',
            run:()=>new YtDlpResolver('x').downloadVideo(input,outputDir,{timeoutMs:env().AUDIO_EXTRACTION_TIMEOUT_MS})
          }
        ]
      :[
          {
            name:'ytdlp_visual',family:'local:yt_dlp',
            run:()=>new YtDlpResolver(input.platform).downloadVideo(input,outputDir,{timeoutMs:env().AUDIO_EXTRACTION_TIMEOUT_MS})
          },
          ...(input.platform==='instagram'||input.platform==='tiktok'
            ?[{
                name:'gallery_dl_visual',family:'local:gallery_dl' as const,
                run:()=>new GalleryDlMediaResolver(input.platform).downloadVideo(input,outputDir,{timeoutMs:env().AUDIO_EXTRACTION_TIMEOUT_MS})
              }]
            :[])
        ];
    return await runProviderChain({platform:input.platform,operation:'visual',attempts});
  }

  async audio(input:ParsedMediaUrl,outputDir:string):Promise<string>{
    const attempts:ProviderAttempt<string>[]=input.platform==='x'
      ?[
          {
            name:'x_syndication',family:'public:x_syndication',
            run:()=>this.xSyndication.downloadAudio(input,outputDir,{timeoutMs:env().AUDIO_EXTRACTION_TIMEOUT_MS}),
            shouldFailover:shouldFailoverFromXSyndicationAudio
          },
          {
            name:'ytdlp',family:'local:yt_dlp',
            run:()=>new YtDlpResolver('x').downloadAudio(input,outputDir,{timeoutMs:env().AUDIO_EXTRACTION_TIMEOUT_MS})
          },
          ...this.externalAudioAttempt(input,outputDir)
        ]
      :[
          {
            name:'ytdlp',family:'local:yt_dlp',
            run:()=>new YtDlpResolver(input.platform).downloadAudio(input,outputDir,{timeoutMs:env().AUDIO_EXTRACTION_TIMEOUT_MS})
          },
          ...this.galleryAudioAttempt(input,outputDir),
          ...this.externalAudioAttempt(input,outputDir)
        ];
    return await runProviderChain({platform:input.platform,operation:'audio',attempts});
  }
}
