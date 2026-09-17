from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    assert old in s, f"missing patch anchor in {path}: {old[:120]!r}"
    p.write_text(s.replace(old, new, 1))


Path("src/billing/foundingPolicy.ts").write_text("""export type FoundingPlan='basic'|'pro';

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
""")

Path("src/billing/founding.ts").write_text("""import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { FOUNDING_CYCLES, FOUNDING_LIMIT, foundingProgressText, type FoundingPlan } from './foundingPolicy.js';

interface FoundingUserRow{
  founding_plan:FoundingPlan|null;
  founding_claimed_at:Date|null;
  founding_cycles_used:number;
  founding_period_start:Date|null;
  founding_ended_at:Date|null;
  founding_slot_released_at:Date|null;
}

export interface FoundingOfferStatus{
  claimed:number;
  remaining:number;
  open:boolean;
  progressText:string|null;
}

export async function getFoundingOfferStatus():Promise<FoundingOfferStatus>{
  const r=await pool.query<{count:string}>(`SELECT COUNT(*)::text count FROM users WHERE founding_claimed_at IS NOT NULL AND founding_slot_released_at IS NULL`);
  const claimed=Math.max(0,Number(r.rows[0]?.count??0)||0);
  return {claimed,remaining:Math.max(0,FOUNDING_LIMIT-claimed),open:claimed<FOUNDING_LIMIT,progressText:foundingProgressText(claimed)};
}

export async function reconcileFoundingOffer(client:PoolClient,input:{userId:string;plan:FoundingPlan;status:string;periodStart:Date|null;firstSubscription:boolean}):Promise<void>{
  const user=await client.query<FoundingUserRow>(
    `SELECT founding_plan,founding_claimed_at,founding_cycles_used,founding_period_start,founding_ended_at,founding_slot_released_at FROM users WHERE id=$1 FOR UPDATE`,
    [input.userId]
  );
  if(!user.rowCount)return;
  const row=user.rows[0];
  if(row.founding_claimed_at){
    if(row.founding_slot_released_at||row.founding_ended_at)return;
    if(row.founding_plan!==input.plan){
      await client.query(`UPDATE users SET founding_ended_at=COALESCE(founding_ended_at,now()),updated_at=now() WHERE id=$1`,[input.userId]);
      return;
    }
    if(input.status==='canceled'){
      await client.query(`UPDATE users SET founding_ended_at=COALESCE(founding_ended_at,now()),updated_at=now() WHERE id=$1`,[input.userId]);
      return;
    }
    if(input.status!=='active'&&input.status!=='trialing')return;
    if(!input.periodStart)return;
    const last=row.founding_period_start;
    if(!last){
      await client.query(`UPDATE users SET founding_period_start=$2,founding_cycles_used=GREATEST(1,founding_cycles_used),updated_at=now() WHERE id=$1`,[input.userId,input.periodStart]);
      return;
    }
    if(input.periodStart.getTime()<=last.getTime())return;
    if(row.founding_cycles_used>=FOUNDING_CYCLES){
      await client.query(`UPDATE users SET founding_ended_at=COALESCE(founding_ended_at,now()),updated_at=now() WHERE id=$1`,[input.userId]);
      return;
    }
    await client.query(`UPDATE users SET founding_cycles_used=founding_cycles_used+1,founding_period_start=$2,updated_at=now() WHERE id=$1`,[input.userId,input.periodStart]);
    return;
  }
  if(!input.firstSubscription||(input.status!=='active'&&input.status!=='trialing'))return;
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('link2ai:founding-offer:v1'))`);
  const count=await client.query<{count:string}>(`SELECT COUNT(*)::text count FROM users WHERE founding_claimed_at IS NOT NULL AND founding_slot_released_at IS NULL`);
  if(Number(count.rows[0]?.count??0)>=FOUNDING_LIMIT)return;
  await client.query(
    `UPDATE users SET founding_plan=$2,founding_claimed_at=now(),founding_cycles_used=1,founding_period_start=$3,founding_ended_at=NULL,founding_slot_released_at=NULL,updated_at=now() WHERE id=$1 AND founding_claimed_at IS NULL`,
    [input.userId,input.plan,input.periodStart]
  );
}

export async function releaseFoundingSlotForInitialRefund(userId:string):Promise<void>{
  await pool.query(
    `UPDATE users SET founding_slot_released_at=COALESCE(founding_slot_released_at,now()),founding_ended_at=COALESCE(founding_ended_at,now()),updated_at=now() WHERE id=$1 AND founding_claimed_at IS NOT NULL AND founding_cycles_used<=1 AND founding_slot_released_at IS NULL`,
    [userId]
  );
}
""")

Path("src/worker/regions.ts").write_text("""export const DEFAULT_PRODUCTION_REGION_ORDER=[
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
""")

Path("railway.worker.json").write_text("""{
  "$schema": "https://railway.com/railway.schema.json",
  "deploy": {
    "startCommand": "npm run start:worker",
    "preDeployCommand": ["npm run db:migrate:prod"],
    "healthcheckPath": "/healthz",
    "healthcheckTimeout": 120,
    "restartPolicyType": "ON_FAILURE",
    "multiRegionConfig": {
      "europe-west4-drams3a": {"numReplicas": 1},
      "asia-southeast1-eqsg3a": {"numReplicas": 1},
      "us-west2": {"numReplicas": 1}
    }
  }
}
""")

replace_once(
    "sql/001_init.sql",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS analytics_excluded boolean NOT NULL DEFAULT false;\n",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS analytics_excluded boolean NOT NULL DEFAULT false;\nALTER TABLE users ADD COLUMN IF NOT EXISTS founding_plan text;\nALTER TABLE users ADD COLUMN IF NOT EXISTS founding_claimed_at timestamptz;\nALTER TABLE users ADD COLUMN IF NOT EXISTS founding_cycles_used integer NOT NULL DEFAULT 0;\nALTER TABLE users ADD COLUMN IF NOT EXISTS founding_period_start timestamptz;\nALTER TABLE users ADD COLUMN IF NOT EXISTS founding_ended_at timestamptz;\nALTER TABLE users ADD COLUMN IF NOT EXISTS founding_slot_released_at timestamptz;\nALTER TABLE users DROP CONSTRAINT IF EXISTS users_founding_plan_check;\nALTER TABLE users ADD CONSTRAINT users_founding_plan_check CHECK (founding_plan IS NULL OR founding_plan IN ('basic','pro'));\nALTER TABLE users DROP CONSTRAINT IF EXISTS users_founding_cycles_used_check;\nALTER TABLE users ADD CONSTRAINT users_founding_cycles_used_check CHECK (founding_cycles_used >= 0 AND founding_cycles_used <= 3);\nCREATE INDEX IF NOT EXISTS users_founding_claim_idx ON users(founding_claimed_at) WHERE founding_claimed_at IS NOT NULL AND founding_slot_released_at IS NULL;\n",
)
replace_once(
    "sql/001_init.sql",
    "CREATE INDEX IF NOT EXISTS transcript_jobs_queue_idx ON transcript_jobs(status, next_attempt_at, priority DESC, created_at);\n",
    "ALTER TABLE transcript_jobs ADD COLUMN IF NOT EXISTS preferred_region text;\nALTER TABLE transcript_jobs ADD COLUMN IF NOT EXISTS attempted_regions text[] NOT NULL DEFAULT ARRAY[]::text[];\nCREATE INDEX IF NOT EXISTS transcript_jobs_queue_idx ON transcript_jobs(status, next_attempt_at, priority DESC, created_at);\nCREATE INDEX IF NOT EXISTS transcript_jobs_region_queue_idx ON transcript_jobs(status, preferred_region, next_attempt_at, priority DESC, created_at);\n",
)

p=Path("src/quota/service.ts")
s=p.read_text()
s=s.replace("import { usageUnitsToLegacySeconds } from '../content/limits.js';", "import { usageUnitsToLegacySeconds } from '../content/limits.js';\nimport { foundingBonusUnits, type FoundingPlan } from '../billing/foundingPolicy.js';")
old="""  const user = await client.query<{plan:Plan;trial_eligible:boolean;admin_bonus_seconds:number;admin_bonus_videos:number}>('SELECT plan,trial_eligible,admin_bonus_seconds,admin_bonus_videos FROM users WHERE id=$1 FOR UPDATE', [userId]);
  if (!user.rowCount) throw new Link2AIError('AUTH_REQUIRED', 'User account not found.', 401);
  const plan = user.rows[0].plan;
  const trialEligible=Boolean(user.rows[0].trial_eligible);
  const bonusSeconds=Math.max(0,Number(user.rows[0].admin_bonus_seconds??0)||0);
  const bonusVideos=Math.max(0,Number(user.rows[0].admin_bonus_videos??0)||0);
"""
new="""  const user = await client.query<{plan:Plan;trial_eligible:boolean;admin_bonus_seconds:number;admin_bonus_videos:number;founding_plan:FoundingPlan|null;founding_claimed_at:Date|null;founding_cycles_used:number;founding_ended_at:Date|null;founding_slot_released_at:Date|null}>(
    'SELECT plan,trial_eligible,admin_bonus_seconds,admin_bonus_videos,founding_plan,founding_claimed_at,founding_cycles_used,founding_ended_at,founding_slot_released_at FROM users WHERE id=$1 FOR UPDATE', [userId]
  );
  if (!user.rowCount) throw new Link2AIError('AUTH_REQUIRED', 'User account not found.', 401);
  const plan = user.rows[0].plan;
  const trialEligible=Boolean(user.rows[0].trial_eligible);
  const foundingActive=plan!=='trial'&&Boolean(user.rows[0].founding_claimed_at)&&!user.rows[0].founding_ended_at&&!user.rows[0].founding_slot_released_at&&user.rows[0].founding_plan===plan&&user.rows[0].founding_cycles_used>=1&&user.rows[0].founding_cycles_used<=3;
  const foundingBonusSeconds=foundingActive?foundingBonusUnits(plan as FoundingPlan)*60:0;
  const bonusSeconds=Math.max(0,Number(user.rows[0].admin_bonus_seconds??0)||0)+foundingBonusSeconds;
  const bonusVideos=Math.max(0,Number(user.rows[0].admin_bonus_videos??0)||0);
"""
assert old in s
p.write_text(s.replace(old,new,1))

p=Path("src/billing/lemon.ts")
s=p.read_text()
s=s.replace("import { canonicalLemonStatus, lemonBillingPeriod, shouldApplySubscriptionLifecycleEvent } from './order.js';", "import { canonicalLemonStatus, lemonBillingPeriod, shouldApplySubscriptionLifecycleEvent } from './order.js';\nimport { reconcileFoundingOffer, releaseFoundingSlotForInitialRefund } from './founding.js';")
old="""  const eventName=String(event?.meta?.event_name??'');
  const obj=event?.data;
  if(!eventName||obj?.type!=='subscriptions'||!obj?.id)return;
"""
new="""  const eventName=String(event?.meta?.event_name??'');
  const obj=event?.data;
  if(!eventName||!obj?.id)return;
  if(eventName==='order_refunded'&&obj?.type==='orders'){
    const refundedUserId=String(event?.meta?.custom_data?.user_id??'');
    if(refundedUserId)await releaseFoundingSlotForInitialRefund(refundedUserId);
    return;
  }
  if(obj?.type!=='subscriptions')return;
"""
assert old in s
s=s.replace(old,new,1)
replace="""    const period=lemonBillingPeriod(attrs);
    const priorSubscriptions=await client.query('SELECT 1 FROM subscriptions WHERE user_id=$1 LIMIT 1',[userId]);
    const firstSubscription=priorSubscriptions.rowCount===0;
    await client.query(
"""
s=s.replace("""    const period=lemonBillingPeriod(attrs);
    await client.query(
""",replace,1)
old="""      [userId,subscriptionId,plan,status,period.start,period.end,updatedAt]
    );
    const entitlement=await reconcileUserEntitlement(client,userId);
"""
new="""      [userId,subscriptionId,plan,status,period.start,period.end,updatedAt]
    );
    await reconcileFoundingOffer(client,{userId,plan,status,periodStart:period.start,firstSubscription});
    const entitlement=await reconcileUserEntitlement(client,userId);
"""
assert old in s
p.write_text(s.replace(old,new,1))

p=Path("src/worker/jobs.ts")
s=p.read_text()
s=s.replace("  checkout_url: string | null;\n}", "  checkout_url: string | null;\n  preferred_region: string | null;\n  attempted_regions: string[];\n}")
s=s.replace("export async function claimNextJob(workerId: string): Promise<JobRow | null> {", "export async function claimNextJob(workerId: string, workerRegion='local', primaryRegion=workerRegion): Promise<JobRow | null> {")
old="""       WHERE j.status='queued'
         AND u.account_status <> 'disabled'
         AND j.next_attempt_at <= now()
         AND (
"""
new="""       WHERE j.status='queued'
         AND u.account_status <> 'disabled'
         AND j.next_attempt_at <= now()
         AND ((j.preferred_region IS NULL AND $1::text=$2::text) OR j.preferred_region=$1::text)
         AND (
"""
assert old in s
s=s.replace(old,new,1)
old="""       FOR UPDATE OF j SKIP LOCKED
       LIMIT 1`
    );
"""
new="""       FOR UPDATE OF j SKIP LOCKED
       LIMIT 1`,
      [workerRegion,primaryRegion]
    );
"""
assert old in s
s=s.replace(old,new,1)
old="""      `UPDATE transcript_jobs SET status='processing', locked_at=now(), locked_by=$2, attempts=attempts+1, updated_at=now() WHERE id=$1`,
      [job.id, workerId]
"""
new="""      `UPDATE transcript_jobs SET status='processing', locked_at=now(), locked_by=$2, attempts=attempts+1,
         attempted_regions=CASE WHEN $3::text=ANY(attempted_regions) THEN attempted_regions ELSE array_append(attempted_regions,$3::text) END,
         updated_at=now() WHERE id=$1`,
      [job.id, workerId, workerRegion]
"""
assert old in s
s=s.replace(old,new,1)
s=s.replace("    return { ...job, status: 'processing', attempts: job.attempts + 1 };", "    const attempted=job.attempted_regions?.includes(workerRegion)?job.attempted_regions:[...(job.attempted_regions??[]),workerRegion];\n    return { ...job, status: 'processing', attempts: job.attempts + 1, attempted_regions: attempted };")
anchor="export async function recoverStaleJobs(): Promise<void> {\n"
insert="""export async function deferJobToRegion(jobId:string,region:string,errorCode:string,message:string):Promise<void>{
  await pool.query(
    `UPDATE transcript_jobs SET status='queued',attempts=GREATEST(attempts-1,0),preferred_region=$2,error_code=$3,error_message=$4,retryable=true,
      locked_at=NULL,locked_by=NULL,next_attempt_at=now(),updated_at=now() WHERE id=$1`,
    [jobId,region,errorCode,message]
  );
}

export async function recoverStaleJobs(): Promise<void> {
"""
assert anchor in s
p.write_text(s.replace(anchor,insert,1))

p=Path("src/worker/main.ts")
s=p.read_text()
s=s.replace("import { claimNextJob, deferJob, recoverStaleJobs } from './jobs.js';", "import { claimNextJob, deferJob, recoverStaleJobs } from './jobs.js';\nimport { workerRegionRuntime } from './regions.js';")
s=s.replace("const workerId=`${os.hostname()}:${process.pid}`;", "const regionRuntime=workerRegionRuntime();\nconst workerId=`${os.hostname()}:${process.pid}:${regionRuntime.currentRegion}`;")
s=s.replace("res.end(JSON.stringify({ok:true,service:'link2ai-worker',worker_id:workerId,active_jobs:activeJobs,worker_concurrency:env().WORKER_CONCURRENCY,last_job_at:lastJobAt}));", "res.end(JSON.stringify({ok:true,service:'link2ai-worker',worker_id:workerId,region:regionRuntime.currentRegion,primary_region:regionRuntime.primaryRegion,regional_fallback_order:regionRuntime.regionOrder,active_jobs:activeJobs,worker_concurrency:env().WORKER_CONCURRENCY,last_job_at:lastJobAt}));")
s=s.replace("job=await claimNextJob(`${workerId}:${slotId}`);", "job=await claimNextJob(`${workerId}:${slotId}`,regionRuntime.currentRegion,regionRuntime.primaryRegion);")
s=s.replace("await processJob(job);lastJobAt=new Date().toISOString();", "await processJob(job,{workerRegion:regionRuntime.currentRegion,regionOrder:regionRuntime.regionOrder});lastJobAt=new Date().toISOString();")
s=s.replace("console.log(`[worker] Link2AI worker ${workerId} started with ${env().WORKER_CONCURRENCY} slots`);", "console.log(`[worker] Link2AI worker ${workerId} started with ${env().WORKER_CONCURRENCY} slots; primary=${regionRuntime.primaryRegion}; fallback=${regionRuntime.regionOrder.join(' -> ')}`);")
p.write_text(s)

p=Path("src/worker/processor.ts")
s=p.read_text()
s=s.replace("import { deferJob, heartbeatJob, markAwaitingPayment, markCompleted, markFailed, markRetry, planForUser, setJobMetadata, type JobRow } from './jobs.js';", "import { deferJob, deferJobToRegion, heartbeatJob, markAwaitingPayment, markCompleted, markFailed, markRetry, planForUser, setJobMetadata, type JobRow } from './jobs.js';")
s=s.replace("import { estimateTokens, textUsageUnits, videoUsageUnits } from '../content/limits.js';", "import { estimateTokens, textUsageUnits, videoUsageUnits } from '../content/limits.js';\nimport { regionalFallbackTarget } from './regions.js';")
s=s.replace("export async function processJob(job:JobRow):Promise<void>{", "export async function processJob(job:JobRow,runtime?:{workerRegion:string;regionOrder:string[]}):Promise<void>{")
s=s.replace("  const startedAt=Date.now();\n", "  const startedAt=Date.now();\n  const workerRegion=runtime?.workerRegion??'local';\n  const regionOrder=runtime?.regionOrder??[workerRegion];\n",1)
old="""  }catch(e){
    if(reserved)await releaseQuota(job.id).catch(()=>{});
    const err=asLink2AIError(e);
    const causeCode=typeof err.details?.cause_code==='string'?err.details.cause_code.slice(0,80):undefined;
"""
new="""  }catch(e){
    const err=asLink2AIError(e);
    if(reserved){await releaseQuota(job.id).catch(()=>{});reserved=false;}
    const nextRegion=regionalFallbackTarget({platform:job.platform,errorCode:err.code,regionOrder,attemptedRegions:job.attempted_regions??[],currentRegion:workerRegion});
    if(nextRegion){
      if(mediaClaim){await releaseMediaClaim(job.id).catch(()=>{});mediaClaim=false;}
      await deferJobToRegion(job.id,nextRegion,err.code,err.message);
      logEvent('job_regional_fallback',{job_id:job.id,platform:job.platform,from_region:workerRegion,to_region:nextRegion,error_code:err.code,attempted_regions:job.attempted_regions??[],processing_ms:Date.now()-startedAt});
      return;
    }
    const causeCode=typeof err.details?.cause_code==='string'?err.details.cause_code.slice(0,80):undefined;
"""
assert old in s
p.write_text(s.replace(old,new,1))

p=Path("src/billing/routes.ts")
s=p.read_text()
s=s.replace("import { trackWebsiteVisit } from '../analytics/visitors.js';", "import { trackWebsiteVisit } from '../analytics/visitors.js';\nimport { getFoundingOfferStatus } from './founding.js';\nimport { FOUNDING_LIMIT } from './foundingPolicy.js';")
css_anchor='.usage-rule strong{display:block;color:#3f3946;margin-bottom:3px}.public-cta{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}'
css_new='.usage-rule strong{display:block;color:#3f3946;margin-bottom:3px}.founding-banner{display:flex;align-items:center;justify-content:space-between;gap:18px;margin:14px 0 18px;padding:14px 16px;border:1px solid rgba(111,84,232,.20);border-radius:16px;background:rgba(244,241,255,.72)}.founding-banner>div:first-child{display:grid;gap:3px}.founding-kicker{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.09em;color:#6f54e8}.founding-banner strong{font-size:13px}.founding-banner span:last-child{font-size:11px;color:var(--muted)}.founding-progress{flex:0 0 auto;font-size:11px;font-weight:850;color:#5a45bc;white-space:nowrap}.usage-details{margin-top:18px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.62);overflow:hidden}.usage-details summary{cursor:pointer;list-style:none;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:14px;font-size:12px;color:var(--muted)}.usage-details summary::-webkit-details-marker{display:none}.usage-details summary strong{color:#3f3946}.usage-details[open] summary{border-bottom:1px solid var(--line)}.usage-details .usage-rule{margin:0;padding:14px}.usage-examples{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:0 14px 14px}.usage-example{padding:10px 11px;border-radius:12px;background:#fff;border:1px solid var(--line);font-size:11px;color:var(--muted)}.usage-example strong{display:block;color:#3f3946;font-size:13px;margin-bottom:2px}.usage-details .plan-note{padding:0 14px 14px;margin:0}.public-cta{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}'
assert css_anchor in s
s=s.replace(css_anchor,css_new,1)
s=s.replace('@media(max-width:760px){.plan-grid,.usage-rule{grid-template-columns:1fr}', '@media(max-width:760px){.plan-grid,.usage-rule,.usage-examples{grid-template-columns:1fr}')
s=s.replace("    const chosen:PaidPlan=q.plan==='pro'?'pro':'basic';", "    const chosen:PaidPlan=q.plan==='pro'?'pro':'basic';\n    const founding=await getFoundingOfferStatus().catch(()=>({claimed:0,remaining:FOUNDING_LIMIT,open:true,progressText:null}));\n    const foundingBanner=founding.open?`<div class=\"founding-banner\"><div><span class=\"founding-kicker\">Founding offer</span><strong>First ${FOUNDING_LIMIT} paid users get 50% more usage for their first 3 paid billing cycles.</strong><span>No coupon required · bonus resets each billing cycle · changing plans ends the remaining bonus.</span></div>${founding.progressText?`<div class=\"founding-progress\">${esc(founding.progressText)}</div>`:''}</div>`:'';")
s=s.replace('const plans=(actions:string)=>`<div class="plan-grid">', 'const plans=(actions:string)=>`${foundingBanner}<div class="plan-grid">',1)
s=s.replace('<li>500 processing units / month</li>', "${founding.open?'<li><strong>750 processing units / month for the first 3 paid billing cycles</strong></li><li>Then 500 processing units / month</li>':'<li>500 processing units / month</li>'}",1)
s=s.replace('<li>2,000 processing units / month</li>', "${founding.open?'<li><strong>3,000 processing units / month for the first 3 paid billing cycles</strong></li><li>Then 2,000 processing units / month</li>':'<li>2,000 processing units / month</li>'}",1)
old='<div class="usage-rule"><div><strong>Text-based links</strong>About 2,500 estimated tokens successfully returned to the AI = 1 processing unit. Successful reads use at least 1 unit.</div><div><strong>Video</strong>Each started minute successfully processed = 1 processing unit, subject to your plan’s per-video limit.</div><div><strong>Failed / partial reads</strong>Unsupported, inaccessible, login-required, empty or failed reads use 0 units. Truncated reads charge only the content actually processed and tell the AI the source was partial.</div></div><p class="plan-note"><strong>Quick examples:</strong> a 9-minute processed video uses 9 units; an approximately 1,800-token article uses 1 unit; an approximately 6,100-token discussion uses about 3 units. Text token counts are deterministic estimates used for billing, not the host AI’s exact tokenizer.</p>'
new='<details class="usage-details"><summary><strong>What does 1 processing unit mean?</strong><span>1 started video minute · ~2,500 estimated text tokens · failed read = 0</span></summary><div class="usage-rule"><div><strong>Units depend on content size, not platform</strong>YouTube, TikTok, Instagram, X, Bluesky, GitHub, HN, PDFs and webpages follow the same video/text rules.</div><div><strong>Video</strong>0:01–1:00 = 1 unit · 1:01–2:00 = 2 units. Each started minute successfully processed counts as 1 unit.</div><div><strong>Text</strong>About 2,500 estimated tokens successfully returned to the AI = 1 unit. Successful reads use at least 1 unit.</div></div><div class="usage-examples"><div class="usage-example"><strong>1 unit</strong>30 sec Short / Reel / TikTok</div><div class="usage-example"><strong>5 units</strong>5 minute video</div><div class="usage-example"><strong>2 units</strong>~5,000 estimated text tokens</div><div class="usage-example"><strong>0 units</strong>Failed / unsupported / inaccessible read</div></div><p class="plan-note">Text token counts are deterministic estimates used for billing, not the host AI’s exact tokenizer. Truncated reads charge only the content actually processed and tell the AI the source was partial.</p></details>'
assert old in s
p.write_text(s.replace(old,new,1))

p=Path("test/pure.mjs")
s=p.read_text()
s=s.replace("import { estimateTokens, textUsageUnits, videoUsageUnits, usageUnitsToLegacySeconds, usageUnitsForOutcome, boundExtractedText, EXTRACTION_LIMITS } from '../.pure-dist/src/content/limits.js';", "import { estimateTokens, textUsageUnits, videoUsageUnits, usageUnitsToLegacySeconds, usageUnitsForOutcome, boundExtractedText, EXTRACTION_LIMITS } from '../.pure-dist/src/content/limits.js';\nimport { FOUNDING_LIMIT, foundingBonusUnits, foundingProgressText } from '../.pure-dist/src/billing/foundingPolicy.js';\nimport { DEFAULT_PRODUCTION_REGION_ORDER, regionalFallbackTarget, workerRegionRuntime } from '../.pure-dist/src/worker/regions.js';")
anchor="assert.equal(videoUsageUnits(61),2);\n"
tests="""assert.equal(videoUsageUnits(61),2);
assert.equal(FOUNDING_LIMIT,50);
assert.equal(foundingBonusUnits('basic'),250);
assert.equal(foundingBonusUnits('pro'),1000);
assert.equal(foundingProgressText(9),null);
assert.equal(foundingProgressText(10),'10 / 50 founding spots claimed');
assert.equal(foundingProgressText(25),'Half of founding spots are claimed');
assert.equal(foundingProgressText(26),'More than half of founding spots are claimed');
assert.equal(foundingProgressText(38),'Only 12 founding spots left');
assert.equal(foundingProgressText(49),'Only 1 founding spot left');
assert.equal(foundingProgressText(50),'Founding offer closed');
const regionRuntime=workerRegionRuntime({RAILWAY_REPLICA_REGION:'europe-west4-drams3a'});
assert.deepEqual(regionRuntime.regionOrder,[...DEFAULT_PRODUCTION_REGION_ORDER]);
assert.equal(regionRuntime.primaryRegion,'europe-west4-drams3a');
assert.equal(regionalFallbackTarget({platform:'youtube',errorCode:'GEO_BLOCKED',regionOrder:regionRuntime.regionOrder,attemptedRegions:['europe-west4-drams3a'],currentRegion:'europe-west4-drams3a'}),'asia-southeast1-eqsg3a');
assert.equal(regionalFallbackTarget({platform:'youtube',errorCode:'GEO_BLOCKED',regionOrder:regionRuntime.regionOrder,attemptedRegions:['europe-west4-drams3a','asia-southeast1-eqsg3a'],currentRegion:'asia-southeast1-eqsg3a'}),'us-west2');
assert.equal(regionalFallbackTarget({platform:'youtube',errorCode:'GEO_BLOCKED',regionOrder:regionRuntime.regionOrder,attemptedRegions:[...regionRuntime.regionOrder],currentRegion:'us-west2'}),null);
assert.equal(regionalFallbackTarget({platform:'youtube',errorCode:'PLATFORM_BLOCKED',regionOrder:regionRuntime.regionOrder,attemptedRegions:[],currentRegion:'europe-west4-drams3a'}),null);
"""
assert anchor in s
p.write_text(s.replace(anchor,tests,1))

p=Path("test/billing.mjs")
s=p.read_text()
old="""      if(text.includes('SELECT user_id,plan,status,provider_event_at'))return existingOwner?{rowCount:1,rows:[{user_id:existingOwner,plan:'basic',status:'active',provider_event_at:new Date('2026-02-01T00:00:00Z')}]}:{rowCount:0,rows:[]};
      if(text.includes('SELECT plan,status FROM subscriptions'))return {rowCount:1,rows:[{plan:'basic',status:'past_due'}]};
      return {rowCount:1,rows:[]};
"""
new="""      if(text.includes('SELECT user_id,plan,status,provider_event_at'))return existingOwner?{rowCount:1,rows:[{user_id:existingOwner,plan:'basic',status:'active',provider_event_at:new Date('2026-02-01T00:00:00Z')}]}:{rowCount:0,rows:[]};
      if(text.includes('SELECT 1 FROM subscriptions WHERE user_id'))return {rowCount:1,rows:[{}]};
      if(text.includes('SELECT founding_plan,founding_claimed_at'))return {rowCount:1,rows:[{founding_plan:null,founding_claimed_at:null,founding_cycles_used:0,founding_period_start:null,founding_ended_at:null,founding_slot_released_at:null}]};
      if(text.includes('SELECT plan,status FROM subscriptions'))return {rowCount:1,rows:[{plan:'basic',status:'past_due'}]};
      return {rowCount:1,rows:[]};
"""
assert old in s
p.write_text(s.replace(old,new,1))

p=Path("test/runtime-smoke.mjs")
s=p.read_text()
s=s.replace("for(const route of ['/','/examples','/use-cases','/sources','/connect','/support','/privacy','/terms']){", "for(const route of ['/','/examples','/use-cases','/sources','/pricing','/connect','/support','/privacy','/terms']){")
anchor="    if(route==='/sources'){assert.match(body,/Supported sources/);assert.match(body,/Video & social/);assert.match(body,/Reddit/);assert.match(body,/Paused until approved Reddit OAuth Data API credentials are configured/);}\n"
repl=anchor+"    if(route==='/pricing'){assert.match(body,/Founding offer/);assert.match(body,/First 50 paid users get 50% more usage/);assert.match(body,/750 processing units/);assert.match(body,/3,000 processing units/);assert.match(body,/What does 1 processing unit mean/);assert.match(body,/Units depend on content size, not platform/);}\n"
assert anchor in s
p.write_text(s.replace(anchor,repl,1))
