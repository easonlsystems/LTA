import { asLink2AIError } from '../util/errors.js';
import { logEvent } from '../util/log.js';
import { shouldTryExternalFallback } from './fallback.js';
import { recordProviderOutcome, type ProviderOperation, type ProviderOutcomeInput } from './providerTelemetry.js';

export interface ProviderAttempt<T>{
  name:string;
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

export async function runProviderChain<T>(input:ProviderChainInput<T>):Promise<T>{
  if(!input.attempts.length)throw new Error('Provider chain requires at least one provider.');
  const shouldFailover=input.shouldFailover??shouldTryExternalFallback;
  const telemetry=input.telemetry??recordProviderOutcome;

  for(let i=0;i<input.attempts.length;i++){
    const attempt=input.attempts[i];
    const started=Date.now();
    try{
      const result=await attempt.run();
      await telemetry({
        platform:input.platform,operation:input.operation,provider:attempt.name,
        outcome:'success',durationMs:Date.now()-started,attemptIndex:i
      });
      if(i>0){
        logEvent('source_provider_failover_success',{
          platform:input.platform,operation:input.operation,provider:attempt.name,attempt_index:i
        });
      }
      return result;
    }catch(error){
      await telemetry({
        platform:input.platform,operation:input.operation,provider:attempt.name,
        outcome:'failed',durationMs:Date.now()-started,error,attemptIndex:i
      });
      const next=input.attempts[i+1];
      const attemptShouldFailover=attempt.shouldFailover??shouldFailover;
      if(!next||!attemptShouldFailover(error))throw error;
      const mapped=asLink2AIError(error);
      logEvent('source_provider_failover',{
        platform:input.platform,operation:input.operation,
        from_provider:attempt.name,to_provider:next.name,
        error_code:mapped.code,retryable:mapped.retryable,attempt_index:i
      });
    }
  }
  throw new Error('Provider chain exhausted unexpectedly.');
}
