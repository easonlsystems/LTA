import { asLink2AIError } from '../util/errors.js';
import { logEvent } from '../util/log.js';

export type ProviderOperation='metadata'|'audio'|'transcript'|'text';

export interface ProviderOutcomeInput{
  platform:string;
  operation:ProviderOperation;
  provider:string;
  family?:string;
  outcome:'success'|'failed';
  durationMs:number;
  error?:unknown;
  attemptIndex?:number;
}

function clean(value:string,max:number):string{
  return value.trim().slice(0,max);
}

export async function recordProviderOutcome(input:ProviderOutcomeInput):Promise<void>{
  const durationMs=Math.max(0,Math.round(input.durationMs));
  const err=input.error===undefined?null:asLink2AIError(input.error);
  const errorCode=err?.code??null;
  const causeCode=typeof err?.details?.cause_code==='string'?String(err.details.cause_code).slice(0,80):null;
  const retryable=Boolean(err?.retryable);

  logEvent('source_provider_attempt',{
    platform:clean(input.platform,48),
    operation:input.operation,
    provider:clean(input.provider,64),
    ...(input.family?{provider_family:clean(input.family,64)}:{}),
    outcome:input.outcome,
    duration_ms:durationMs,
    ...(input.attemptIndex!==undefined?{attempt_index:input.attemptIndex}:{}),
    ...(errorCode?{error_code:errorCode}:{}),
    ...(causeCode?{cause_code:causeCode}:{}),
    ...(err?{retryable}: {})
  });

  const params=[
    clean(input.platform,48),
    input.operation,
    clean(input.provider,64),
    input.outcome==='success'?1:0,
    input.outcome==='failed'?1:0,
    input.outcome==='failed'&&retryable?1:0,
    durationMs,
    errorCode,
    causeCode
  ];
  // Delay loading the database module until a real provider attempt occurs. This keeps
  // parsers and pure tests independent of production DB/env configuration.
  void import('../db/pool.js').then(({pool})=>pool.query(
    `INSERT INTO provider_health_hourly(
       bucket_start,platform,operation,provider,attempts,successes,failures,retryable_failures,total_duration_ms,last_error_code,last_cause_code
     ) VALUES(
       date_trunc('hour',now()),$1,$2,$3,1,$4,$5,$6,$7,$8,$9
     )
     ON CONFLICT(bucket_start,platform,operation,provider) DO UPDATE SET
       attempts=provider_health_hourly.attempts+1,
       successes=provider_health_hourly.successes+EXCLUDED.successes,
       failures=provider_health_hourly.failures+EXCLUDED.failures,
       retryable_failures=provider_health_hourly.retryable_failures+EXCLUDED.retryable_failures,
       total_duration_ms=provider_health_hourly.total_duration_ms+EXCLUDED.total_duration_ms,
       last_error_code=COALESCE(EXCLUDED.last_error_code,provider_health_hourly.last_error_code),
       last_cause_code=COALESCE(EXCLUDED.last_cause_code,provider_health_hourly.last_cause_code),
       updated_at=now()`,
    params
  )).catch(()=>{
    // Provider telemetry must never block source extraction or failover.
  });
}
