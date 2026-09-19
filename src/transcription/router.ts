import { env } from '../config/env.js';
import { asLink2AIError, Link2AIError } from '../util/errors.js';
import { runProviderChain, type ProviderAttempt } from '../resolvers/providerChain.js';
import { OpenAICompatibleTranscriber } from './openaiCompatible.js';
import type { TranscriptionResult } from './types.js';
import { transcriptionResponseFormat } from './format.js';

export async function transcribeAudio(
  filePath:string,
  requestedLanguage='auto',
  platform='media'
):Promise<TranscriptionResult>{
  const attempts:ProviderAttempt<TranscriptionResult>[]=[];

  if(env().GROQ_API_KEY){
    const provider=new OpenAICompatibleTranscriber({
      name:'groq',endpoint:'https://api.groq.com/openai/v1/audio/transcriptions',
      apiKey:env().GROQ_API_KEY!,model:env().GROQ_TRANSCRIPTION_MODEL,
      responseFormat:transcriptionResponseFormat('groq',env().GROQ_TRANSCRIPTION_MODEL)
    });
    attempts.push({
      name:'groq_asr',family:'asr_groq',
      run:()=>provider.transcribe(filePath,requestedLanguage)
    });
  }

  if(env().OPENAI_API_KEY){
    const provider=new OpenAICompatibleTranscriber({
      name:'openai',endpoint:'https://api.openai.com/v1/audio/transcriptions',
      apiKey:env().OPENAI_API_KEY!,model:env().OPENAI_TRANSCRIPTION_MODEL,
      responseFormat:transcriptionResponseFormat('openai',env().OPENAI_TRANSCRIPTION_MODEL)
    });
    attempts.push({
      name:'openai_asr',family:'asr_openai',
      run:()=>provider.transcribe(filePath,requestedLanguage)
    });
  }

  if(!attempts.length){
    throw new Link2AIError('TRANSCRIPTION_FAILED','No speech-to-text provider is configured.',503);
  }

  return await runProviderChain({
    platform,operation:'transcript',attempts,
    // A provider-specific transcription failure may still succeed at another ASR vendor.
    // ProviderChain only trips the circuit for retryable/provider-level failures.
    shouldFailover:error=>asLink2AIError(error).code==='TRANSCRIPTION_FAILED'
  });
}
