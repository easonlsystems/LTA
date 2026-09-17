export type FoundingPlan='basic'|'pro';

export const FOUNDING_LIMIT=50;
export const FOUNDING_CYCLES=3;

export function foundingBonusUnits(plan:FoundingPlan):number{
  return plan==='basic'?250:1000;
}

export function foundingProgressText(claimed:number):string|null{
  const safe=Math.max(0,Math.min(FOUNDING_LIMIT,Math.floor(claimed)));
  if(safe>=FOUNDING_LIMIT)return 'Founding offer closed';
  if(safe<10)return null;
  if(safe<25)return `${safe} / ${FOUNDING_LIMIT} founding spots claimed`;
  if(safe===25)return 'Half of founding spots are claimed';
  if(safe<38)return 'More than half of founding spots are claimed';
  return `Only ${FOUNDING_LIMIT-safe} founding ${FOUNDING_LIMIT-safe===1?'spot':'spots'} left`;
}
