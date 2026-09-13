import type { MediaMetadata } from '../media/types.js';
import type { ParsedMediaUrl, Platform } from '../media/url.js';

export interface ResolveContext {
  timeoutMs: number;
}

export interface MediaResolver {
  readonly platform: Platform;
  resolveMetadata(input: ParsedMediaUrl, ctx: ResolveContext): Promise<MediaMetadata>;
  downloadAudio(input: ParsedMediaUrl, outputDir: string, ctx: ResolveContext): Promise<string>;
}
