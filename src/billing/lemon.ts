import type { PoolClient } from 'pg';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { hmacSha256, timingSafeEqualHex } from '../util/crypto.js';
import { Link2AIError } from '../util/errors.js';
import { canonicalLemonStatus, lemonBillingPeriod, shouldApplySubscriptionLifecycleEvent } from './order.js';

export type PaidPlan = 'basic' | 'pro';

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
  const maxSeconds=plan==='pro'?120*60:30*60;
  await client.query(
    `UPDATE transcript_jobs SET status='queued',priority=$3,next_attempt_at=now(),error_code=NULL,error_message=NULL,checkout_url=NULL,updated_at=now()
     WHERE user_id=$1 AND status='awaiting_payment'
       AND (duration_seconds IS NULL AND id=$4 OR duration_seconds IS NOT NULL AND duration_seconds <= $2)`,
    [userId,maxSeconds,priority,explicitJobId??null]
  );
  if(plan==='pro'){
    await client.query(`UPDATE transcript_jobs SET status='queued',priority=$2,next_attempt_at=now(),error_code=NULL,error_message=NULL,checkout_url=NULL,updated_at=now() WHERE user_id=$1 AND status='awaiting_payment'`,[userId,priority]);
    await client.query('DELETE FROM billing_resume_intents WHERE user_id=$1',[userId]);
  }else{
    await client.query(`DELETE FROM billing_resume_intents WHERE user_id=$1 AND target_plan='basic'`,[userId]);
  }
}

export async function processLemonEvent(event:any):Promise<void>{
  const eventName=String(event?.meta?.event_name??'');
  const obj=event?.data;
  if(!eventName||obj?.type!=='subscriptions'||!obj?.id)return;
  const attrs=obj.attributes??{};
  const subscriptionId=String(obj.id);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    // A row-level lock cannot serialize concurrent first events because the row
    // does not exist yet. Lock the provider id before reading/inserting it.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 510214))`,[subscriptionId]);
    const existing=await client.query<{user_id:string;plan:PaidPlan;status:string;provider_event_at:Date|null}>(
      `SELECT user_id,plan,status,provider_event_at FROM subscriptions WHERE provider_subscription_id=$1 FOR UPDATE`,[subscriptionId]
    );
    const custom=event?.meta?.custom_data??{};
    const userId=String(custom.user_id??existing.rows[0]?.user_id??'');
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
    await client.query(
      `INSERT INTO subscriptions(user_id,provider,provider_subscription_id,plan,status,current_period_start,current_period_end,provider_event_at)
       VALUES($1,'lemonsqueezy',$2,$3,$4,$5,$6,$7)
       ON CONFLICT(provider_subscription_id) DO UPDATE SET
         user_id=EXCLUDED.user_id,provider='lemonsqueezy',plan=EXCLUDED.plan,status=EXCLUDED.status,
         current_period_start=EXCLUDED.current_period_start,current_period_end=EXCLUDED.current_period_end,
         provider_event_at=EXCLUDED.provider_event_at,updated_at=now()`,
      [userId,subscriptionId,plan,status,period.start,period.end,updatedAt]
    );
    const entitlement=await reconcileUserEntitlement(client,userId);
    const resumeJobId=custom.resume_job_id?String(custom.resume_job_id):undefined;
    if(entitlement.plan!=='trial'&&entitlement.accountStatus!=='canceled')await resumePendingJobs(client,userId,entitlement.plan,resumeJobId);
    else if(entitlement.plan==='trial')await client.query('DELETE FROM billing_resume_intents WHERE user_id=$1',[userId]);
    await client.query('COMMIT');
  }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
}
