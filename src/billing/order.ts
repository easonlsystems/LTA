export const TERMINAL_SUBSCRIPTION_STATUSES = new Set(['canceled']);

export function isTerminalSubscriptionStatus(status:string):boolean{
  return TERMINAL_SUBSCRIPTION_STATUSES.has(status);
}

export interface SubscriptionLifecycleState {
  status:string;
  eventCreated:number;
}

/**
 * Billing providers do not guarantee webhook delivery order. Only a newer lifecycle event
 * may replace the stored lifecycle state. At an equal timestamp, terminal state
 * wins so an active/trialing/past_due event cannot resurrect a canceled sub.
 */
export function shouldApplySubscriptionLifecycleEvent(
  current:SubscriptionLifecycleState|null,
  incoming:SubscriptionLifecycleState
):boolean{
  if(!current)return true;
  if(incoming.eventCreated>current.eventCreated)return true;
  if(incoming.eventCreated<current.eventCreated)return false;
  if(isTerminalSubscriptionStatus(current.status)&&!isTerminalSubscriptionStatus(incoming.status))return false;
  return true;
}

export type LemonSubscriptionStatus='trialing'|'active'|'past_due'|'canceled';

export function canonicalLemonStatus(raw:string):LemonSubscriptionStatus{
  switch(raw){
    case 'on_trial': return 'trialing';
    case 'active':
    case 'paused':
    case 'cancelled': return 'active';
    case 'past_due':
    case 'unpaid': return 'past_due';
    case 'expired':
    default: return 'canceled';
  }
}

export function lemonBillingPeriod(attrs:{ends_at?:unknown;renews_at?:unknown;billing_anchor?:unknown}):{start:Date|null;end:Date|null}{
  const raw=attrs.ends_at??attrs.renews_at;
  if(!raw)return {start:null,end:null};
  const end=new Date(String(raw));
  if(Number.isNaN(end.getTime()))return {start:null,end:null};
  const parsedAnchor=Number(attrs.billing_anchor);
  const anchor=Number.isInteger(parsedAnchor)&&parsedAnchor>=1&&parsedAnchor<=31?parsedAnchor:end.getUTCDate();
  const priorMonth=end.getUTCMonth()===0?11:end.getUTCMonth()-1;
  const priorYear=end.getUTCMonth()===0?end.getUTCFullYear()-1:end.getUTCFullYear();
  const lastDay=new Date(Date.UTC(priorYear,priorMonth+1,0)).getUTCDate();
  const start=new Date(end);
  start.setUTCFullYear(priorYear,priorMonth,Math.min(anchor,lastDay));
  return {start,end};
}
