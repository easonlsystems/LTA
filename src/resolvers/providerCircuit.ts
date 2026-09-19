import type { ProviderOperation } from './providerTelemetry.js';

export interface CircuitProvider{
  name:string;
  family?:string;
}

interface CircuitState{
  consecutiveFailures:number;
  openUntil:number;
}

const FAILURE_THRESHOLD=3;
const OPEN_MS=2*60_000;
const states=new Map<string,CircuitState>();

function clean(value:string):string{return value.trim().slice(0,80);}

function key(platform:string,operation:ProviderOperation,provider:CircuitProvider):string{
  return [clean(platform),operation,clean(provider.family??'other'),clean(provider.name)].join(':');
}

export function orderProviderAttempts<T extends CircuitProvider>(
  platform:string,
  operation:ProviderOperation,
  attempts:T[],
  now=Date.now()
):T[]{
  if(attempts.length<2)return [...attempts];
  return attempts
    .map((attempt,index)=>{
      const state=states.get(key(platform,operation,attempt));
      const open=Boolean(state&&state.openUntil>now);
      return {attempt,index,open};
    })
    .sort((a,b)=>Number(a.open)-Number(b.open)||a.index-b.index)
    .map(item=>item.attempt);
}

export function noteProviderSuccess(platform:string,operation:ProviderOperation,provider:CircuitProvider):void{
  states.delete(key(platform,operation,provider));
}

export function noteProviderFailure(
  platform:string,
  operation:ProviderOperation,
  provider:CircuitProvider,
  countsTowardCircuit:boolean,
  now=Date.now()
):{opened:boolean;openUntil:number}{
  const k=key(platform,operation,provider);
  if(!countsTowardCircuit)return {opened:false,openUntil:states.get(k)?.openUntil??0};
  const prior=states.get(k)??{consecutiveFailures:0,openUntil:0};
  const consecutiveFailures=prior.consecutiveFailures+1;
  const opened=consecutiveFailures>=FAILURE_THRESHOLD;
  const openUntil=opened?now+OPEN_MS:prior.openUntil;
  states.set(k,{consecutiveFailures,openUntil});
  return {opened,openUntil};
}

export function resetProviderCircuitsForTests():void{
  states.clear();
}
