export type TranscriptionResponseFormat = 'verbose_json' | 'json';

/**
 * Whisper-style models expose segment timestamps in verbose_json.
 * OpenAI's newer GPT transcription models intentionally support JSON-only output,
 * so never manufacture timestamp segments for those responses.
 */
export function transcriptionResponseFormat(provider: string, model: string): TranscriptionResponseFormat {
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedModel = model.trim().toLowerCase();
  if (normalizedProvider === 'openai' && (normalizedModel.startsWith('gpt-') || normalizedModel.includes('transcribe-diarize'))) {
    return 'json';
  }
  return 'verbose_json';
}
