import type { MediaMetadata } from '../media/types.js';
import type { ParsedMediaUrl } from '../media/url.js';
import { env } from '../config/env.js';
import { ExternalProviderResolver } from './external.js';
import { YtDlpResolver } from './ytdlp.js';
import { shouldTryExternalFallback } from './fallback.js';

export class ResolverOrchestrator {
  async metadata(input: ParsedMediaUrl): Promise<MediaMetadata> {
    const direct = new YtDlpResolver(input.platform);
    try {
      return await direct.resolveMetadata(input, { timeoutMs: env().EXTRACTION_TIMEOUT_MS });
    } catch (err) {
      if (!env().MEDIA_PROVIDER_URL || !shouldTryExternalFallback(err)) throw err;
      return await new ExternalProviderResolver(input.platform).resolveMetadata(input, { timeoutMs: env().EXTRACTION_TIMEOUT_MS });
    }
  }

  async audio(input: ParsedMediaUrl, outputDir: string): Promise<string> {
    const direct = new YtDlpResolver(input.platform);
    try {
      return await direct.downloadAudio(input, outputDir, { timeoutMs: env().AUDIO_EXTRACTION_TIMEOUT_MS });
    } catch (err) {
      if (!env().MEDIA_PROVIDER_URL || !shouldTryExternalFallback(err)) throw err;
      return await new ExternalProviderResolver(input.platform).downloadAudio(input, outputDir, { timeoutMs: env().AUDIO_EXTRACTION_TIMEOUT_MS });
    }
  }
}
