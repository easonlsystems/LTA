import { asLink2AIError } from '../util/errors.js';
import { logEvent } from '../util/log.js';
import { shouldTryExternalFallback } from './fallback.js';
import { noteProviderFailure, noteProviderSuccess, orderProviderAttempts } from './providerCircuit.js';
import { recordProviderOutcome, type ProviderOperation, type ProviderOutcomeInput } from './providerTelemetry.js';

export type ProviderFamily=
  |'official_api'
  |'public_structured'
  |'platform_transcript'
  |'public_html'
  |'local_extractor'
  |'external_provider'
  |'asr_groq'
  |'asr_openai'
  |'other';

export interface ProviderAttempt<T>{
  name:string;
  family?:ProviderFamily;
  run:()=>Promise<T>;
  shouldFailover?:(error:unknown)=>boolean;
}

export interface ProviderChainInput<T>{
  platform:string;
  operation:ProviderOperation;
  attempts:Array<ProviderAttempt<T>>;
  shouldFailover?:(error:unknown)=>boolean;
  telemetry?:(input:ProviderOutcomeInput)=>Promise<void>;
}

function providerFamily<T>(attempt:ProviderAttempt<T>):ProviderFamily{return attempt.family??'other';}

export async function runProviderChain<T>(input:ProviderChainInput<T>):Promise<T>{
  if(!input.attempts.length)throw new Error('Provider chain requires at least one provider.');
  const shouldFailover=input.shouldFailover??shouldTryExternalFallback;
  const telemetry=input.telemetry??recordProviderOutcome;
  const attempts=orderProviderAttempts(input.platform,input.operation,input.attempts);

  if(attempts.length>1&&attempts.some((attempt,index)=>attempt!==input.attempts[index])){
    const deferred=input.attempts.find((attempt,index)=>attempt!==attempts[index]);
    if(deferred){
      logEvent('source_provider_circuit_deferred',{
        platform:input.platform,operation:input.operation,
        provider:deferred.name,provider_family:providerFamily(deferred)
      });
    }
  }

  for(let i=0;i<attempts.length;i++){
    const attempt=attempts[i];
    const family=providerFamily(attempt);
    const started=Date.now();
    try{
      const result=await attempt.run();
      noteProviderSuccess(input.platform,input.operation,attempt);
      await telemetry({
        platform:input.platform,operation:input.operation,provider:attempt.name,family,
        outcome:'success',durationMs:Date.now()-started,attemptIndex:i
      });
      if(i>0){
        logEvent('source_provider_failover_success',{
          platform:input.platform,operation:input.operation,provider:attempt.name,
          provider_family:family,attempt_index:i
        });
      }
      return result;
    }catch(error){
      const attemptShouldFailover=attempt.shouldFailover??shouldFailover;
      const canFailover=attemptShouldFailover(error);
      const mapped=asLink2AIError(error);
      // Content-specific misses can still fall through to another provider, but they
      // must not poison global provider health. Only transient/provider-level failures
      // contribute to the circuit breaker.
      const countsTowardCircuit=canFailover&&(mapped.retryable||mapped.code==='RATE_LIMITED'||mapped.code==='PLATFORM_BLOCKED');
      const circuit=noteProviderFailure(input.platform,input.operation,attempt,countsTowardCircuit);
      await telemetry({
        platform:input.platform,operation:input.operation,provider:attempt.name,family,
        outcome:'failed',durationMs:Date.now()-started,error,attemptIndex:i
      });
      if(circuit.opened){
        logEvent('source_provider_circuit_open',{
          platform:input.platform,operation:input.operation,provider:attempt.name,
          provider_family:family,cooldown_seconds:120
        });
      }
      const next=attempts[i+1];
      if(!next||!canFailover)throw error;
      logEvent('source_provider_failover',{
        platform:input.platform,operation:input.operation,
        from_provider:attempt.name,from_provider_family:family,
        to_provider:next.name,to_provider_family:providerFamily(next),
        error_code:mapped.code,retryable:mapped.retryable,attempt_index:i
      });
    }
  }
  throw new Error('Provider chain exhausted unexpectedly.');
}
