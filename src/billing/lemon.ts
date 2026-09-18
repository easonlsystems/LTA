import type { PoolClient } from 'pg';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { hmacSha256, timingSafeEqualHex } from '../util/crypto.js';
import { Link2AIError } from '../util/errors.js';
import { PLAN_LIMITS } from '../quota/plans.js';
import { canonicalLemonStatus, lemonBillingPeriod, shouldApplySubscriptionLifecycleEvent } from './order.js';
import { reconcileFoundingOffer, releaseFoundingSlotForInitialRefund } from './founding.js';
import { foundingBonusUnits, type FoundingPlan } from './foundingPolicy.js';

export type PaidPlan = 'basic' | 'pro';
export type TopupPack = '500' | '1500';

const TOPUP_UNITS:Record<TopupPack,number>={500:500,1500:1500};
function topupVariantId(pack:TopupPack):string|undefined{
  return pack==='500'?env().LEMONSQUEEZY_TOPUP_500_VARIANT_ID:env().LEMONSQUEEZY_TOPUP_1500_VARIANT_ID;
}
function topupPackFromVariant(variantIdRaw:unknown):TopupPack|null{
  const id=String(variantIdRaw??'');
  if(env().LEMONSQUEEZY_TOPUP_500_VARIANT_ID&&id===String(env().LEMONSQUEEZY_TOPUP_500_VARIANT_ID))return '500';
  if(env().LEMONSQUEEZY_TOPUP_1500_VARIANT_ID&&id===String(env().LEMONSQUEEZY_TOPUP_1500_VARIANT_ID))return '1500';
  return null;
}

export function topupConfigured():boolean{
  return Boolean(env().LEMONSQUEEZY_API_KEY&&env().LEMONSQUEEZY_STORE_ID&&env().LEMONSQUEEZY_TOPUP_500_VARIANT_ID&&env().LEMONSQUEEZY_TOPUP_1500_VARIANT_ID);
}

export async function canPurchaseTopup(userId:string):Promise<boolean>{
  if(!topupConfigured())return false;
  const r=await pool.query(`SELECT 1 FROM subscriptions WHERE user_id=$1 AND provider='lemonsqueezy' AND status IN ('active','trialing') LIMIT 1`,[userId]);
  return Boolean(r.rowCount);
}

function variantId(plan: PaidPlan): string | undefined {
  return plan === 'basic' ? env().LEMONSQUEEZY_BASIC_VARIANT_ID : env().LEMONSQUEEZY_PRO_VARIANT_ID;
}

async function lemonRequest(method:'GET'|'POST'|'PATCH', path:string, body?:unknown):Promise<any>{
  const apiKey=env().LEMONSQUEEZY_API_KEY;
  if(!apiKey)throw new Link2AIError('INTERNAL_ERROR','Billing is not configured.',503);
  const response=await fetch(`https://api.lemonsqueezy.com/v1${path}`,{
    method,
    headers:{
      accept:'application/vnd.api+json',
      authorization:`Bearer ${apiKey}`,
      ...(body?{'content-type':'application/vnd.api+json'}:{})
    },
    body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(20_000)
  });
  const text=await response.text();
  let parsed:any; try{parsed=JSON.parse(text);}catch{parsed={raw:text};}
  if(!response.ok)throw new Link2AIError('INTERNAL_ERROR',`Billing request failed (HTTP ${response.status}).`,502,false,{provider:'lemonsqueezy',response:parsed});
  return parsed;
}

async function rememberResume(userId:string,jobId:string|undefined,targetPlan:PaidPlan):Promise<void>{
  if(!jobId)return;
  await pool.query(
    `INSERT INTO billing_resume_intents(user_id,job_id,target_plan,expires_at)
     VALUES($1,$2,$3,now()+interval '1 hour')
     ON CONFLICT(user_id) DO UPDATE SET job_id=EXCLUDED.job_id,target_plan=EXCLUDED.target_plan,expires_at=EXCLUDED.expires_at,created_at=now()`,
    [userId,jobId,targetPlan]
  );
}

async function activeSubscription(userId:string):Promise<{provider_subscription_id:string;plan:PaidPlan}|null>{
  const r=await pool.query<{provider_subscription_id:string;plan:PaidPlan}>(
    `SELECT provider_subscription_id,plan FROM subscriptions
     WHERE user_id=$1 AND provider='lemonsqueezy' AND status IN ('active','trialing','past_due')
     ORDER BY CASE WHEN status IN ('active','trialing') THEN 0 ELSE 1 END,
              CASE WHEN plan='pro' THEN 0 ELSE 1 END,
              updated_at DESC LIMIT 1`,[userId]
  );
  return r.rows[0]??null;
}

export async function createBillingPortalSession(userId:string):Promise<string>{
  const sub=await activeSubscription(userId);
  if(!sub)throw new Link2AIError('INTERNAL_ERROR','No active subscription is connected to this account.',400);
  const response=await lemonRequest('GET',`/subscriptions/${encodeURIComponent(sub.provider_subscription_id)}`);
  const url=response?.data?.attributes?.urls?.customer_portal;
  if(!url)throw new Link2AIError('INTERNAL_ERROR','Billing portal is temporarily unavailable.',502);
  return String(url);
}

async function upgradeSubscription(userId:string,subscriptionId:string,plan:PaidPlan,resumeJobId?:string):Promise<string>{
  const variant=variantId(plan);
  if(!variant)throw new Link2AIError('INTERNAL_ERROR',`${plan} billing variant is not configured.`,503);
  await rememberResume(userId,resumeJobId,plan);
  const response=await lemonRequest('PATCH',`/subscriptions/${encodeURIComponent(subscriptionId)}`,{
    data:{type:'subscriptions',id:subscriptionId,attributes:{variant_id:Number(variant),invoice_immediately:true}}
  });
  const appliedVariant=String(response?.data?.attributes?.variant_id??'');
  if(appliedVariant!==String(variant)){
    const portalUpdate=response?.data?.attributes?.urls?.customer_portal_update_subscription??response?.data?.attributes?.urls?.update_customer_portal;
    if(portalUpdate)return String(portalUpdate);
    throw new Link2AIError('INTERNAL_ERROR','The subscription could not be upgraded automatically. Open billing management and try again.',409);
  }
  const url=new URL('/billing/success',env().PUBLIC_BASE_URL);
  if(resumeJobId)url.searchParams.set('resume_job_id',resumeJobId);
  return url.toString();
}

export async function createCheckoutSession(userId:string,plan:PaidPlan,resumeJobId?:string):Promise<string>{
  const variant=variantId(plan);
  const storeId=env().LEMONSQUEEZY_STORE_ID;
  if(!env().LEMONSQUEEZY_API_KEY||!variant||!storeId){
    const url=new URL('/pricing',env().PUBLIC_BASE_URL);url.searchParams.set('plan',plan);if(resumeJobId)url.searchParams.set('resume_job_id',resumeJobId);return url.toString();
  }
  const user=await pool.query<{email:string|null}>('SELECT email FROM users WHERE id=$1',[userId]);
  if(!user.rowCount)throw new Link2AIError('AUTH_REQUIRED','User not found.',401);
  const existing=await activeSubscription(userId);
  if(existing){
    if(existing.plan==='basic'&&plan==='pro')return upgradeSubscription(userId,existing.provider_subscription_id,'pro',resumeJobId);
    return createBillingPortalSession(userId);
  }
  await rememberResume(userId,resumeJobId,plan);
  const redirect=new URL('/billing/success',env().PUBLIC_BASE_URL);
  if(resumeJobId)redirect.searchParams.set('resume_job_id',resumeJobId);
  const response=await lemonRequest('POST','/checkouts',{
    data:{
      type:'checkouts',
      attributes:{
        product_options:{redirect_url:redirect.toString(),enabled_variants:[Number(variant)]},
        checkout_options:{embed:false,media:false,logo:true,desc:false,discount:false,skip_trial:true,subscription_preview:true},
        checkout_data:{
          ...(user.rows[0].email?{email:user.rows[0].email}:{}),
          custom:{user_id:userId,plan,...(resumeJobId?{resume_job_id:resumeJobId}:{})}
        },
        test_mode:env().LEMONSQUEEZY_TEST_MODE
      },
      relationships:{
        store:{data:{type:'stores',id:String(storeId)}},
        variant:{data:{type:'variants',id:String(variant)}}
      }
    }
  });
  const url=response?.data?.attributes?.url;
  if(!url)throw new Link2AIError('INTERNAL_ERROR','Billing provider did not return a checkout URL.',502);
  return String(url);
}


export async function createTopupCheckoutSession(userId:string,pack:TopupPack):Promise<string>{
  const variant=topupVariantId(pack);
  const storeId=env().LEMONSQUEEZY_STORE_ID;
  if(!env().LEMONSQUEEZY_API_KEY||!variant||!storeId)throw new Link2AIError('INTERNAL_ERROR','Top-up billing is not configured yet.',503);
  if(!await canPurchaseTopup(userId))throw new Link2AIError('AUTH_REQUIRED','An active Basic or Pro subscription is required to buy extra units.',403);
  const user=await pool.query<{email:string|null}>('SELECT email FROM users WHERE id=$1',[userId]);
  if(!user.rowCount)throw new Link2AIError('AUTH_REQUIRED','User not found.',401);
  const redirect=new URL('/billing/topup/success',env().PUBLIC_BASE_URL);
  redirect.searchParams.set('pack',pack);
  const response=await lemonRequest('POST','/checkouts',{
    data:{
      type:'checkouts',
      attributes:{
        product_options:{redirect_url:redirect.toString(),enabled_variants:[Number(variant)]},
        checkout_options:{embed:false,media:false,logo:true,desc:false,discount:false,skip_trial:true,subscription_preview:false},
        checkout_data:{
          ...(user.rows[0].email?{email:user.rows[0].email}:{}),
          custom:{user_id:userId,purpose:'topup',topup_pack:pack,units:String(TOPUP_UNITS[pack])}
        },
        test_mode:env().LEMONSQUEEZY_TEST_MODE
      },
      relationships:{
        store:{data:{type:'stores',id:String(storeId)}},
        variant:{data:{type:'variants',id:String(variant)}}
      }
    }
  });
  const url=response?.data?.attributes?.url;
  if(!url)throw new Link2AIError('INTERNAL_ERROR','Billing provider did not return a top-up checkout URL.',502);
  return String(url);
}

export function verifyLemonSignature(rawBody:string,signatureHeader:string):boolean{
  const secret=env().LEMONSQUEEZY_WEBHOOK_SECRET;
  if(!secret||!signatureHeader)return false;
  return timingSafeEqualHex(hmacSha256(secret,rawBody),signatureHeader);
}

function planFromObject(obj:any):PaidPlan|null{
  const id=String(obj?.attributes?.variant_id??'');
  if(env().LEMONSQUEEZY_PRO_VARIANT_ID&&id===String(env().LEMONSQUEEZY_PRO_VARIANT_ID))return 'pro';
  if(env().LEMONSQUEEZY_BASIC_VARIANT_ID&&id===String(env().LEMONSQUEEZY_BASIC_VARIANT_ID))return 'basic';
  const custom=obj?.meta?.custom_data?.plan;
  return custom==='basic'||custom==='pro'?custom:null;
}

interface RolloverUserRow{
  admin_bonus_seconds:number;
  paid_rollover_seconds:number;
  paid_rollover_settled_period_start:Date|null;
  founding_plan:FoundingPlan|null;
  founding_claimed_at:Date|null;
  founding_cycles_used:number;
  founding_period_start:Date|null;
  founding_ended_at:Date|null;
  founding_slot_released_at:Date|null;
}

function sameInstant(a:Date|null,b:Date|null):boolean{
  return Boolean(a&&b&&a.getTime()===b.getTime());
}

function foundingBonusSecondsForPeriod(row:RolloverUserRow,plan:PaidPlan,periodStart:Date):number{
  const active=Boolean(row.founding_claimed_at)&&!row.founding_ended_at&&!row.founding_slot_released_at&&row.founding_plan===plan&&row.founding_cycles_used>=1&&row.founding_cycles_used<=3&&sameInstant(row.founding_period_start,periodStart);
  return active?foundingBonusUnits(plan)*60:0;
}

async function settlePaidRolloverPeriod(client:PoolClient,input:{userId:string;plan:PaidPlan;periodStart:Date|null;periodEnd:Date|null}):Promise<void>{
  if(!input.periodStart)return;
  const user=await client.query<RolloverUserRow>(
    `SELECT admin_bonus_seconds,paid_rollover_seconds,paid_rollover_settled_period_start,founding_plan,founding_claimed_at,founding_cycles_used,founding_period_start,founding_ended_at,founding_slot_released_at
     FROM users WHERE id=$1 FOR UPDATE`,[input.userId]
  );
  if(!user.rowCount)return;
  const row=user.rows[0];
  if(sameInstant(row.paid_rollover_settled_period_start,input.periodStart))return;
  const end=input.periodEnd??new Date();
  const usage=await client.query<{seconds:string}>(
    `SELECT COALESCE(SUM(seconds),0)::text seconds FROM usage_ledger
     WHERE user_id=$1 AND created_at >= $2 AND created_at < $3`,[input.userId,input.periodStart,end]
  );
  const usedSeconds=Math.max(0,Number(usage.rows[0]?.seconds??0)||0);
  const expiringBonusSeconds=Math.max(0,Number(row.admin_bonus_seconds??0)||0)+foundingBonusSecondsForPeriod(row,input.plan,input.periodStart);
  // Expiring promotional/admin bonus is consumed first. Only paid base units and older
  // rollover balance survive into the wallet.
  const persistentUsed=Math.max(0,usedSeconds-expiringBonusSeconds);
  const persistentAvailable=Math.max(0,Number(row.paid_rollover_seconds??0)||0)+PLAN_LIMITS[input.plan].secondsPerPeriod;
  const nextRollover=Math.max(0,persistentAvailable-persistentUsed);
  await client.query(
    `UPDATE users SET paid_rollover_seconds=$2,paid_rollover_settled_period_start=$3,updated_at=now() WHERE id=$1`,
    [input.userId,nextRollover,input.periodStart]
  );
}

async function reconcileUserEntitlement(client:PoolClient,userId:string):Promise<{plan:'trial'|PaidPlan;accountStatus:'active'|'past_due'|'canceled'}>{
  const active=await client.query<{plan:PaidPlan;status:string}>(
    `SELECT plan,status FROM subscriptions
     WHERE user_id=$1 AND status IN ('active','trialing','past_due')
     ORDER BY CASE WHEN status IN ('active','trialing') THEN 0 ELSE 1 END,
              CASE WHEN plan='pro' THEN 0 ELSE 1 END,
              updated_at DESC LIMIT 1`,[userId]
  );
  if(active.rowCount){
    const row=active.rows[0];
    const accountStatus=row.status==='past_due'?'past_due':'active';
    await client.query(`UPDATE users SET plan=$2,account_status=$3,updated_at=now() WHERE id=$1 AND account_status<>'disabled'`,[userId,row.plan,accountStatus]);
    await client.query(`UPDATE transcript_jobs SET priority=$2,updated_at=now() WHERE user_id=$1 AND status='queued'`,[userId,row.plan==='pro'?20:10]);
    return {plan:row.plan,accountStatus};
  }
  await client.query(`UPDATE users SET plan='trial',account_status='canceled',updated_at=now() WHERE id=$1 AND account_status<>'disabled'`,[userId]);
  await client.query(`UPDATE transcript_jobs SET priority=0,updated_at=now() WHERE user_id=$1 AND status='queued'`,[userId]);
  return {plan:'trial',accountStatus:'canceled'};
}

async function resumePendingJobs(client:PoolClient,userId:string,plan:PaidPlan,explicitJobId?:string):Promise<void>{
  const priority=plan==='pro'?20:10;
  // Paid plans are unit-limited rather than plan-specific video-length-limited. Requeue
  // waiting work and let the quota reservation decide whether the wallet can cover it.
  await client.query(
    `UPDATE transcript_jobs SET status='queued',priority=$2,next_attempt_at=now(),error_code=NULL,error_message=NULL,checkout_url=NULL,updated_at=now()
     WHERE user_id=$1 AND status='awaiting_payment'`,[userId,priority]
  );
  await client.query('DELETE FROM billing_resume_intents WHERE user_id=$1',[userId]);
}


async function processTopupOrderEvent(eventName:string,event:any,obj:any):Promise<boolean>{
  if(obj?.type!=='orders')return false;
  const custom=event?.meta?.custom_data??{};
  if(String(custom.purpose??'')!=='topup')return false;
  const attrs=obj.attributes??{};
  if(typeof attrs.test_mode==='boolean'&&attrs.test_mode!==env().LEMONSQUEEZY_TEST_MODE)return true;
  const requestedPack=custom.topup_pack==='1500'?'1500':custom.topup_pack==='500'?'500':null;
  const variantPack=topupPackFromVariant(attrs?.first_order_item?.variant_id);
  if(!requestedPack||variantPack!==requestedPack)return true;
  const userId=String(custom.user_id??'');
  const orderId=String(obj.id??'');
  if(!userId||!orderId)return true;
  const units=TOPUP_UNITS[requestedPack];
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 510215))`,[`topup:${orderId}`]);
    if(eventName==='order_created'){
      if(String(attrs.status??'')!=='paid'){await client.query('COMMIT');return true;}
      const exists=await client.query('SELECT 1 FROM users WHERE id=$1',[userId]);
      if(!exists.rowCount){await client.query('COMMIT');return true;}
      const totalCents=Math.max(0,Number(attrs.total??0)||0);
      const inserted=await client.query<{id:string}>(
        `INSERT INTO paid_unit_transactions(user_id,kind,units_delta,source_key,provider,provider_reference_id,provider_total_cents,details)
         VALUES($1,'topup_purchase',$2,$3,'lemonsqueezy',$4,$5,$6::jsonb)
         ON CONFLICT(source_key) DO NOTHING RETURNING id`,
        [userId,units,`lemonsqueezy:order:${orderId}`,orderId,totalCents,JSON.stringify({pack:requestedPack,variant_id:String(attrs?.first_order_item?.variant_id??'')})]
      );
      if(inserted.rowCount){
        await client.query(`UPDATE users SET paid_rollover_seconds=paid_rollover_seconds+$2,updated_at=now() WHERE id=$1`,[userId,units*60]);
        await client.query(
          `UPDATE transcript_jobs j SET status='queued',
             priority=CASE u.plan WHEN 'pro' THEN 20 WHEN 'basic' THEN 10 ELSE 0 END,
             next_attempt_at=now(),error_code=NULL,error_message=NULL,checkout_url=NULL,updated_at=now()
           FROM users u
           WHERE j.user_id=$1 AND u.id=j.user_id AND j.status='awaiting_payment' AND j.error_code='QUOTA_EXCEEDED'`,
          [userId]
        );
      }
      await client.query('COMMIT');
      return true;
    }
    if(eventName==='order_refunded'){
      const purchase=await client.query<{id:string;units_delta:number;provider_total_cents:number;provider_refunded_cents:number}>(
        `SELECT id,units_delta,provider_total_cents,provider_refunded_cents FROM paid_unit_transactions
         WHERE source_key=$1 AND kind='topup_purchase' FOR UPDATE`,[`lemonsqueezy:order:${orderId}`]
      );
      if(!purchase.rowCount){await client.query('COMMIT');return true;}
      const row=purchase.rows[0];
      const total=Math.max(1,Number(row.provider_total_cents??0)||Number(attrs.total??0)||1);
      const previousRefund=Math.max(0,Number(row.provider_refunded_cents??0)||0);
      const currentRefund=Math.max(previousRefund,Math.min(total,Math.max(0,Number(attrs.refunded_amount??0)||0)));
      const purchasedUnits=Math.max(0,Number(row.units_delta??units)||units);
      const previousUnits=Math.min(purchasedUnits,Math.round(purchasedUnits*previousRefund/total));
      const targetUnits=Math.min(purchasedUnits,Math.round(purchasedUnits*currentRefund/total));
      const deltaUnits=Math.max(0,targetUnits-previousUnits);
      if(deltaUnits>0){
        await client.query(`UPDATE users SET paid_rollover_seconds=GREATEST(0,paid_rollover_seconds-$2),updated_at=now() WHERE id=$1`,[userId,deltaUnits*60]);
        await client.query(
          `INSERT INTO paid_unit_transactions(user_id,kind,units_delta,source_key,provider,provider_reference_id,provider_total_cents,provider_refunded_cents,details)
           VALUES($1,'topup_refund',$2,$3,'lemonsqueezy',$4,$5,$6,$7::jsonb) ON CONFLICT(source_key) DO NOTHING`,
          [userId,-deltaUnits,`lemonsqueezy:order:${orderId}:refund:${currentRefund}`,orderId,total,currentRefund,JSON.stringify({pack:requestedPack,cumulative_refunded_cents:currentRefund})]
        );
      }
      await client.query(`UPDATE paid_unit_transactions SET provider_refunded_cents=$2 WHERE id=$1`,[row.id,currentRefund]);
      await client.query('COMMIT');
      return true;
    }
    await client.query('COMMIT');
    return true;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}

export async function processLemonEvent(event:any):Promise<void>{
  const eventName=String(event?.meta?.event_name??'');
  const obj=event?.data;
  if(!eventName||!obj?.id)return;
  if(await processTopupOrderEvent(eventName,event,obj))return;
  if(eventName==='order_refunded'&&obj?.type==='orders'){
    const refundedUserId=String(event?.meta?.custom_data?.user_id??'');
    if(refundedUserId)await releaseFoundingSlotForInitialRefund(refundedUserId);
    return;
  }
  if(obj?.type!=='subscriptions')return;
  const attrs=obj.attributes??{};
  const subscriptionId=String(obj.id);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    // A row-level lock cannot serialize concurrent first events because the row
    // does not exist yet. Lock the provider id before reading/inserting it.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 510214))`,[subscriptionId]);
    const existing=await client.query<{user_id:string;plan:PaidPlan;status:string;provider_event_at:Date|null;current_period_start:Date|null;current_period_end:Date|null}>(
      `SELECT user_id,plan,status,provider_event_at,current_period_start,current_period_end FROM subscriptions WHERE provider_subscription_id=$1 FOR UPDATE`,[subscriptionId]
    );
    const custom=event?.meta?.custom_data??{};
    // A provider subscription is permanently owned by the first local user that
    // observed it. Later signed events may repeat or omit custom data, but must never
    // be able to rebind an existing subscription to another account.
    const userId=String(existing.rows[0]?.user_id??custom.user_id??'');
    const plan=planFromObject({attributes:attrs,meta:event.meta})??existing.rows[0]?.plan??null;
    if(!userId||!plan){await client.query('COMMIT');return;}
    const updatedAtRaw=attrs.updated_at??attrs.created_at;
    const updatedAt=updatedAtRaw?new Date(updatedAtRaw):new Date();
    if(Number.isNaN(updatedAt.getTime())){await client.query('COMMIT');return;}
    if(typeof attrs.test_mode==='boolean'&&attrs.test_mode!==env().LEMONSQUEEZY_TEST_MODE){await client.query('COMMIT');return;}
    const status=canonicalLemonStatus(String(attrs.status??'expired'));
    if(existing.rowCount&&existing.rows[0].provider_event_at){
      const previous=existing.rows[0].provider_event_at;
      if(!shouldApplySubscriptionLifecycleEvent(
        {status:existing.rows[0].status,eventCreated:previous.getTime()},
        {status,eventCreated:updatedAt.getTime()}
      )){await client.query('COMMIT');return;}
    }
    const period=lemonBillingPeriod(attrs);
    const previous=existing.rows[0];
    if(previous?.current_period_start){
      const advanced=Boolean(period.start&&period.start.getTime()>previous.current_period_start.getTime());
      const ended=status==='canceled';
      if(advanced||ended){
        await settlePaidRolloverPeriod(client,{userId,plan:previous.plan,periodStart:previous.current_period_start,periodEnd:previous.current_period_end});
      }
    }
    const priorSubscriptions=await client.query('SELECT 1 FROM subscriptions WHERE user_id=$1 LIMIT 1',[userId]);
    const firstSubscription=priorSubscriptions.rowCount===0;
    await client.query(
      `INSERT INTO subscriptions(user_id,provider,provider_subscription_id,plan,status,current_period_start,current_period_end,provider_event_at)
       VALUES($1,'lemonsqueezy',$2,$3,$4,$5,$6,$7)
       ON CONFLICT(provider_subscription_id) DO UPDATE SET
         user_id=EXCLUDED.user_id,provider='lemonsqueezy',plan=EXCLUDED.plan,status=EXCLUDED.status,
         current_period_start=EXCLUDED.current_period_start,current_period_end=EXCLUDED.current_period_end,
         provider_event_at=EXCLUDED.provider_event_at,updated_at=now()`,
      [userId,subscriptionId,plan,status,period.start,period.end,updatedAt]
    );
    if(period.start&&(status==='active'||status==='trialing')){
      const grantUnits=Math.floor(PLAN_LIMITS[plan].secondsPerPeriod/60);
      await client.query(
        `INSERT INTO paid_unit_transactions(user_id,kind,units_delta,source_key,provider,provider_reference_id,details)
         VALUES($1,'subscription_grant',$2,$3,'lemonsqueezy',$4,$5::jsonb) ON CONFLICT(source_key) DO NOTHING`,
        [userId,grantUnits,`lemonsqueezy:subscription:${subscriptionId}:${period.start.toISOString()}`,subscriptionId,JSON.stringify({plan,period_start:period.start.toISOString()})]
      );
    }
    await reconcileFoundingOffer(client,{userId,plan,status,periodStart:period.start,firstSubscription});
    const entitlement=await reconcileUserEntitlement(client,userId);
    const resumeJobId=custom.resume_job_id?String(custom.resume_job_id):undefined;
    if(entitlement.plan!=='trial'&&entitlement.accountStatus!=='canceled')await resumePendingJobs(client,userId,entitlement.plan,resumeJobId);
    else if(entitlement.plan==='trial')await client.query('DELETE FROM billing_resume_intents WHERE user_id=$1',[userId]);
    await client.query('COMMIT');
  }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
}