const REGION_ALIASES:Record<string,string>={
  ams:'ams',
  'europe-west4-drams3a':'ams',
  sin:'sin',
  'asia-southeast1-eqsg3a':'sin',
  sfo:'sfo',
  'us-west2':'sfo'
};

export const DEFAULT_PRODUCTION_REGION_ORDER=['ams','sin','sfo'] as const;

export function normalizeWorkerRegion(value:string|undefined):string{
  const raw=(value??'').trim();
  if(!raw)return '';
  return REGION_ALIASES[raw.toLowerCase()]??raw;
}

export function workerRegionRuntime(source:Record<string,string|undefined>=process.env):{currentRegion:string;regionOrder:string[];primaryRegion:string}{
  const currentRegion=normalizeWorkerRegion(source.RAILWAY_REPLICA_REGION)||'local';
  const configured=(source.WORKER_REGION_ORDER??'').split(',').map(normalizeWorkerRegion).filter(Boolean);
  const productionDefault=DEFAULT_PRODUCTION_REGION_ORDER.includes(currentRegion as any)?[...DEFAULT_PRODUCTION_REGION_ORDER]:[currentRegion];
  const regionOrder=configured.length?Array.from(new Set(configured)):productionDefault;
  if(!regionOrder.includes(currentRegion)&&configured.length)regionOrder.push(currentRegion);
  return {currentRegion,regionOrder,primaryRegion:regionOrder[0]??currentRegion};
}

export function regionalFallbackTarget(input:{platform:string;errorCode:string;regionOrder:string[];attemptedRegions:string[];currentRegion:string}):string|null{
  if(input.platform!=='youtube'||input.errorCode!=='GEO_BLOCKED')return null;
  const attempted=new Set([...input.attemptedRegions,input.currentRegion].map(normalizeWorkerRegion).filter(Boolean));
  for(const rawRegion of input.regionOrder){
    const region=normalizeWorkerRegion(rawRegion);
    if(region&&!attempted.has(region))return region;
  }
  return null;
}
