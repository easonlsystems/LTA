import type { ProviderOperation } from './providerTelemetry.js';

interface NamedProvider{name:string;}
export interface ProviderHealthAggregate{
  provider:string;
  attempts:number;
  successes:number;
  retryableFailures:number;
}

interface HealthCacheEntry{expiresAt:number;rows:ProviderHealthAggregate[];}
const CACHE_MS=30_000;
const cache=new Map<string,HealthCacheEntry>();

function num(value:unknown):number{
  const n=Number(value);return Number.isFinite(n)&&n>=0?n:0;
}

export function providerIsDegraded(row:ProviderHealthAggregate):boolean{
  if(row.attempts<5)return false;
  const successRate=row.successes/Math.max(1,row.attempts);
  const retryableRate=row.retryableFailures/Math.max(1,row.attempts);
  return successRate<0.5||retryableRate>=0.6;
}

export function orderProvidersByHealth<T extends NamedProvider>(attempts:T[],rows:ProviderHealthAggregate[]):T[]{
  if(attempts.length<2||!rows.length)return [...attempts];
  const health=new Map(rows.map(row=>[row.provider,row]));
  return attempts
    .map((attempt,index)=>({attempt,index,degraded:providerIsDegraded(health.get(attempt.name)??{provider:attempt.name,attempts:0,successes:0,retryableFailures:0})}))
    .sort((a,b)=>Number(a.degraded)-Number(b.degraded)||a.index-b.index)
    .map(item=>item.attempt);
}

export async function orderProviderAttemptsByRecentHealth<T extends NamedProvider>(
  platform:string,operation:ProviderOperation,attempts:T[]
):Promise<T[]>{
  if(attempts.length<2)return [...attempts];
  const names=attempts.map(attempt=>attempt.name);
  const key=`${platform}:${operation}:${names.join(',')}`;
  const now=Date.now();
  const cached=cache.get(key);
  if(cached&&cached.expiresAt>now)return orderProvidersByHealth(attempts,cached.rows);

  try{
    const {pool}=await import('../db/pool.js');
    const query=pool.query<any>(
      `SELECT provider,
              SUM(attempts)::bigint AS attempts,
              SUM(successes)::bigint AS successes,
              SUM(retryable_failures)::bigint AS retryable_failures
         FROM provider_health_hourly
        WHERE bucket_start>=now()-interval '2 hours'
          AND platform=$1 AND operation=$2
          AND provider=ANY($3::text[])
        GROUP BY provider`,
      [platform,operation,names]
    );
    const result=await Promise.race([
      query,
      new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('provider_health_timeout')),200))
    ]);
    const rows:ProviderHealthAggregate[]=result.rows.map((row:any)=>({
      provider:String(row.provider??''),
      attempts:num(row.attempts),successes:num(row.successes),retryableFailures:num(row.retryable_failures)
    })).filter(row=>row.provider);
    cache.set(key,{expiresAt:now+CACHE_MS,rows});
    return orderProvidersByHealth(attempts,rows);
  }catch{
    // Health telemetry is advisory. Extraction must never depend on the health query.
    return [...attempts];
  }
}

export function resetProviderHealthCacheForTests():void{cache.clear();}
