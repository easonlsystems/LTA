import type { TranscriptSegment } from '../media/types.js';

export interface TranscriptionResult {
  language: string;
  transcript: string;
  segments: TranscriptSegment[];
  provider: string;
}

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(filePath: string, requestedLanguage?: string): Promise<TranscriptionResult>;
}
