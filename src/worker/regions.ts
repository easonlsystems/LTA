export const DEFAULT_PRODUCTION_REGION_ORDER=[
  'europe-west4-drams3a',
  'asia-southeast1-eqsg3a',
  'us-west2'
] as const;

export function workerRegionRuntime(source:Record<string,string|undefined>=process.env):{currentRegion:string;regionOrder:string[];primaryRegion:string}{
  const currentRegion=(source.RAILWAY_REPLICA_REGION??'').trim()||'local';
  const configured=(source.WORKER_REGION_ORDER??'').split(',').map(v=>v.trim()).filter(Boolean);
  const productionDefault=DEFAULT_PRODUCTION_REGION_ORDER.includes(currentRegion as any)?[...DEFAULT_PRODUCTION_REGION_ORDER]:[currentRegion];
  const regionOrder=configured.length?Array.from(new Set(configured)):productionDefault;
  if(!regionOrder.includes(currentRegion)&&configured.length)regionOrder.push(currentRegion);
  return {currentRegion,regionOrder,primaryRegion:regionOrder[0]??currentRegion};
}

export function regionalFallbackTarget(input:{platform:string;errorCode:string;regionOrder:string[];attemptedRegions:string[];currentRegion:string}):string|null{
  if(input.platform!=='youtube'||input.errorCode!=='GEO_BLOCKED')return null;
  const attempted=new Set([...input.attemptedRegions,input.currentRegion]);
  return input.regionOrder.find(region=>!attempted.has(region))??null;
}
