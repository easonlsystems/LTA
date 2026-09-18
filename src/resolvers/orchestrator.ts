import type { MediaMetadata } from '../media/types.js';
import type { ParsedMediaUrl } from '../media/url.js';
import { env } from '../config/env.js';
import { ExternalProviderResolver } from './external.js';
import { YtDlpResolver } from './ytdlp.js';
import { shouldTryExternalFallback } from './fallback.js';
import { XSyndicationResolver } from './xSyndication.js';

export class ResolverOrchestrator {
  private readonly xSyndication=new XSyndicationResolver();

  async probeXVideoMetadata(input:ParsedMediaUrl):Promise<MediaMetadata|null>{
    if(input.platform!=='x')return null;
    return await this.xSyndication.probeMetadata(input,{timeoutMs:env().EXTRACTION_TIMEOUT_MS});
  }

  async metadata(input: ParsedMediaUrl): Promise<MediaMetadata> {
    if(input.platform==='x')return await this.xSyndication.resolveMetadata(input,{timeoutMs:env().EXTRACTION_TIMEOUT_MS});
    const direct = new YtDlpResolver(input.platform);
    try {
      return await direct.resolveMetadata(input, { timeoutMs: env().EXTRACTION_TIMEOUT_MS });
    } catch (err) {
      if (!env().MEDIA_PROVIDER_URL || !shouldTryExternalFallback(err)) throw err;
      return await new ExternalProviderResolver(input.platform).resolveMetadata(input, { timeoutMs: env().EXTRACTION_TIMEOUT_MS });
    }
  }

  async audio(input: ParsedMediaUrl, outputDir: string): Promise<string> {
    if(input.platform==='x'){
      try{
        return await this.xSyndication.downloadAudio(input,outputDir,{timeoutMs:env().AUDIO_EXTRACTION_TIMEOUT_MS});
      }catch(primaryError){
        const direct=new YtDlpResolver('x');
        try{
          return await direct.downloadAudio(input,outputDir,{timeoutMs:env().AUDIO_EXTRACTION_TIMEOUT_MS});
        }catch(secondError){
          if(!env().MEDIA_PROVIDER_URL||!shouldTryExternalFallback(secondError))throw primaryError;
          return await new ExternalProviderResolver('x').downloadAudio(input,outputDir,{timeoutMs:env().AUDIO_EXTRACTION_TIMEOUT_MS});
        }
      }
    }
    const direct = new YtDlpResolver(input.platform);
    try {
      return await direct.downloadAudio(input, outputDir, { timeoutMs: env().AUDIO_EXTRACTION_TIMEOUT_MS });
    } catch (err) {
      if (!env().MEDIA_PROVIDER_URL || !shouldTryExternalFallback(err)) throw err;
      return await new ExternalProviderResolver(input.platform).downloadAudio(input, outputDir, { timeoutMs: env().AUDIO_EXTRACTION_TIMEOUT_MS });
    }
  }
}
