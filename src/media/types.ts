import type { Platform } from './url.js';
import type { CompletenessMetadata } from '../content/limits.js';

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
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
  source: 'caption' | 'asr' | 'visual' | 'hybrid' | 'post' | 'page';
  completeness: CompletenessMetadata;
}

export interface MediaMetadata {
  platform: Platform;
  resolver?: 'ytdlp' | 'gallery_dl' | 'external' | 'x_syndication';
  canonicalMediaId: string;
  webpageUrl: string;
  originalLanguage?: string;
  title?: string;
  creator?: string;
  description?: string;
  durationSeconds: number;
  subtitles: Record<string, Array<{ url: string; ext?: string; name?: string }>>;
  automaticCaptions: Record<string, Array<{ url: string; ext?: string; name?: string }>>;
}
