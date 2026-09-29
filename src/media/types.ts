import type { Platform } from './url.js';
import type { CompletenessMetadata } from '../content/limits.js';

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface VisualAssetRef {
  kind: 'image' | 'video';
  url: string;
  mimeType?: string;
  width?: number;
  height?: number;
  position: number;
}

export interface TranscriptPayload {
  platform: Platform;
  canonicalMediaId: string;
  sourceUrl: string;
  title?: string;
  creator?: string;
  caption?: string;
  durationSeconds: number;
  language: string;
  transcript: string;
  segments: TranscriptSegment[];
  source: 'caption' | 'asr' | 'post' | 'page';
  visualAssets?: VisualAssetRef[];
  completeness: CompletenessMetadata;
}

export interface MediaMetadata {
  platform: Platform;
  resolver?: 'ytdlp' | 'external' | 'x_syndication';
  canonicalMediaId: string;
  webpageUrl: string;
  originalLanguage?: string;
  title?: string;
  creator?: string;
  description?: string;
  ageLimit?: number;
  sensitive?: boolean;
  durationSeconds: number;
  subtitles: Record<string, Array<{ url: string; ext?: string; name?: string }>>;
  automaticCaptions: Record<string, Array<{ url: string; ext?: string; name?: string }>>;
}
