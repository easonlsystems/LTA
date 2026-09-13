import fs from 'node:fs/promises';
import path from 'node:path';
import type { TranscriptSegment } from '../media/types.js';
import { Link2AIError } from '../util/errors.js';
import { env } from '../config/env.js';
import type { TranscriptionProvider, TranscriptionResult } from './types.js';

interface Options {
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
  responseFormat: 'verbose_json' | 'json';
}

export class OpenAICompatibleTranscriber implements TranscriptionProvider {
  readonly name: string;
  constructor(private readonly options: Options) { this.name = options.name; }

  async transcribe(filePath: string, requestedLanguage?: string): Promise<TranscriptionResult> {
    const bytes = await fs.readFile(filePath);
    const form = new FormData();
    form.set('file', new Blob([bytes]), path.basename(filePath));
    form.set('model', this.options.model);
    form.set('response_format', this.options.responseFormat);
    if (requestedLanguage && requestedLanguage !== 'auto') form.set('language', requestedLanguage.split('-')[0]);

    let response: Response;
    try {
      response = await fetch(this.options.endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.options.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(env().TRANSCRIPTION_TIMEOUT_MS)
      });
    } catch (error) {
      throw new Link2AIError('TRANSCRIPTION_FAILED', `${this.name} transcription request failed before a response was received.`, 502, true, {
        cause: error instanceof Error ? error.name : 'network_error'
      });
    }
    if (!response.ok) {
      const body = await response.text();
      throw new Link2AIError('TRANSCRIPTION_FAILED', `${this.name} transcription failed (HTTP ${response.status}).`, 502, response.status >= 500 || response.status === 429, { body: body.slice(0, 1000) });
    }
    const data = await response.json() as Record<string, unknown>;
    const transcript = String(data.text ?? '').trim();
    if (!transcript) throw new Link2AIError('TRANSCRIPTION_FAILED', `${this.name} returned an empty transcript.`, 502, true);
    const segments: TranscriptSegment[] = Array.isArray(data.segments)
      ? data.segments.flatMap((s: unknown) => {
          if (!s || typeof s !== 'object') return [];
          const x = s as Record<string, unknown>;
          const text = String(x.text ?? '').trim();
          const start = Number(x.start);
          const end = Number(x.end);
          if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return [];
          return [{ start, end, text }];
        })
      : [];
    return {
      language: typeof data.language === 'string' ? data.language : requestedLanguage && requestedLanguage !== 'auto' ? requestedLanguage : 'und',
      transcript,
      segments,
      provider: this.name
    };
  }
}
