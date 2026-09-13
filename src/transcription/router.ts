import { env } from '../config/env.js';
import { Link2AIError } from '../util/errors.js';
import { OpenAICompatibleTranscriber } from './openaiCompatible.js';
import type { TranscriptionResult } from './types.js';
import { transcriptionResponseFormat } from './format.js';

export async function transcribeAudio(filePath: string, requestedLanguage = 'auto'): Promise<TranscriptionResult> {
  const providers: OpenAICompatibleTranscriber[] = [];
  if (env().GROQ_API_KEY) {
    providers.push(new OpenAICompatibleTranscriber({
      name: 'groq', endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
      apiKey: env().GROQ_API_KEY!, model: env().GROQ_TRANSCRIPTION_MODEL,
      responseFormat: transcriptionResponseFormat('groq', env().GROQ_TRANSCRIPTION_MODEL)
    }));
  }
  if (env().OPENAI_API_KEY) {
    providers.push(new OpenAICompatibleTranscriber({
      name: 'openai', endpoint: 'https://api.openai.com/v1/audio/transcriptions',
      apiKey: env().OPENAI_API_KEY!, model: env().OPENAI_TRANSCRIPTION_MODEL,
      responseFormat: transcriptionResponseFormat('openai', env().OPENAI_TRANSCRIPTION_MODEL)
    }));
  }
  if (!providers.length) throw new Link2AIError('TRANSCRIPTION_FAILED', 'No speech-to-text provider is configured.', 503);
  let lastError: unknown;
  for (const provider of providers) {
    try { return await provider.transcribe(filePath, requestedLanguage); }
    catch (err) { lastError = err; }
  }
  throw lastError ?? new Link2AIError('TRANSCRIPTION_FAILED', 'All transcription providers failed.', 502, true);
}
