import type { FastifyInstance, FastifyReply } from 'fastify';
import { createBillingPortalSession, createCheckoutSession, processLemonEvent, verifyLemonSignature, type PaidPlan } from './lemon.js';
import { csrfTokenFromSessionCookie, userFromSessionCookie, verifyCsrfToken } from '../auth/service.js';
import { getUsageSnapshot } from '../quota/service.js';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

function esc(v:unknown){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!));}
function page(body:string){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(env().PUBLIC_BRAND_NAME)}</title><style>body{font-family:system-ui,sans-serif;max-width:650px;margin:55px auto;padding:0 20px;color:#171717}.card{border:1px solid #ddd;border-radius:14px;padding:20px;margin:16px 0}button{padding:11px 16px;font:inherit;cursor:pointer}.muted{color:#666}a{color:inherit}</style></head><body>${body}</body></html>`;}

async function requireWebUser(req:any, reply:FastifyReply, returnTo?:string){
  const user=await userFromSessionCookie(req.headers.cookie);
  if(!user){reply.redirect(`/login?return_to=${encodeURIComponent(returnTo??req.raw.url??'/account')}`);return null;}
  return user;
}

function csrfField(cookieHeader:string|undefined):string{
  const csrf=csrfTokenFromSessionCookie(cookieHeader);
  return csrf?`<input type="hidden" name="csrf" value="${esc(csrf)}">`:''
}

export async function registerBillingRoutes(app:FastifyInstance):Promise<void>{
  app.get('/pricing',async(req,reply)=>{
    const q=req.query as any;
    const user=await userFromSessionCookie(req.headers.cookie);
    if(!user){
      const returnUrl=`/pricing${Object.keys(q).length?`?${new URLSearchParams(q).toString()}`:''}`;
      return reply.code(302).redirect(`/login?return_to=${encodeURIComponent(returnUrl)}`);
    }
    const resume=q.resume_job_id?String(q.resume_job_id):'';
    const chosen:PaidPlan=q.plan==='pro'?'pro':'basic';
    
    // Check if trial user with no usage and no resume_job_id
    const usage=await getUsageSnapshot(user.id);
    if(usage.plan==='trial'&&!resume){
      const usageRows=await pool.query<{count:string}>("SELECT COUNT(*)::text count FROM usage_ledger WHERE user_id=$1",[user.id]);
      if(Number(usageRows.rows[0].count)===0){
        const csrf=csrfField(req.headers.cookie);
        return reply.type('text/html').send(page(`<h1>Try ${esc(env().PUBLIC_BRAND_NAME)} first</h1><div class="card"><p>3 successful links or 10 total minutes of content free.</p><p>No card required. Supported public links only.</p><p><a href="/connect">Connect to your AI</a></p></div>`));
      }
    }
    
    const csrf=csrfField(req.headers.cookie);
    return reply.type('text/html').send(page(`<h1>Continue with ${esc(env().PUBLIC_BRAND_NAME)}</h1><div class="card"><h2>Basic — $4.99 / month</h2><p>500 minutes of content / month<br>Instagram, TikTok & YouTube<br>ChatGPT + Claude</p><form id="checkout-basic" method="post" action="/billing/checkout">${csrf}<input type="hidden" name="plan" value="basic"><input type="hidden" name="resume_job_id" value="${esc(resume)}"><button>Continue</button></form></div><p class="muted">Need more? Pro — $9.99 / month, 2,000 minutes of content and up to 120 minutes per link.</p><form id="checkout-pro" method="post" action="/billing/checkout">${csrf}<input type="hidden" name="plan" value="pro"><input type="hidden" name="resume_job_id" value="${esc(resume)}"><button>Choose Pro</button></form>`));
  });

  app.post('/billing/checkout',async(req,reply)=>{
    const b=req.body as any; const plan:PaidPlan=b?.plan==='pro'?'pro':'basic';
    const resume=b?.resume_job_id?String(b.resume_job_id):'';
    const returnTo=`/pricing?plan=${encodeURIComponent(plan)}${resume?`&resume_job_id=${encodeURIComponent(resume)}`:''}`;
    const user=await requireWebUser(req,reply,returnTo); if(!user)return;
    if(!verifyCsrfToken(req.headers.cookie,String(b?.csrf??'')))return reply.code(403).type('text/html').send(page(`<h1>${esc(env().PUBLIC_BRAND_NAME)}</h1><p>This payment action expired. Please try again.</p><p><a href="${esc(returnTo)}">Back</a></p>`));
    
    // Check if trial user with no resume_job_id and zero usage_ledger rows
    const usage=await getUsageSnapshot(user.id);
    if(usage.plan==='trial'&&!resume){
      const usageRows=await pool.query<{count:string}>("SELECT COUNT(*)::text count FROM usage_ledger WHERE user_id=$1",[user.id]);
      if(Number(usageRows.rows[0].count)===0){
        return reply.code(409).type('text/html').send(page(`<h1>${esc(env().PUBLIC_BRAND_NAME)}</h1><p>Complete one supported public link first.</p><p>Try reading a supported Instagram, TikTok, or YouTube link to activate your trial, then return here to upgrade.</p><p><a href="/connect">Back to ${esc(env().PUBLIC_BRAND_NAME)}</a></p>`));
      }
    }
    
    const url=await createCheckoutSession(user.id,plan,resume||undefined);
    return reply.redirect(url);
  });

  app.get('/billing/success',async(req,reply)=>{
    const q=req.query as any; const resume=q.resume_job_id?String(q.resume_job_id):null;
    return reply.type('text/html').send(page(`<h1>You're connected.</h1><p>Your subscription is being activated${resume?' and the link you were reading will resume automatically':''}.</p><p>You can return to ChatGPT or Claude.</p><script>setTimeout(()=>location.href='/account',2500)</script>`));
  });

  app.get('/account',async(req,reply)=>{
    const user=await requireWebUser(req,reply); if(!user)return;
    const usage=await getUsageSnapshot(user.id);
    const minsUsed=Math.ceil(usage.used_seconds/60), minsLimit=Math.round(usage.limit_seconds/60);
    const csrf=csrfField(req.headers.cookie);
    return reply.type('text/html').send(page(`<h1>${esc(env().PUBLIC_BRAND_NAME)}</h1><div class="card"><h2>${esc(usage.plan[0].toUpperCase()+usage.plan.slice(1))}</h2><p>${minsUsed} / ${minsLimit} minutes${usage.period_end?`<br>Renews ${esc(new Date(usage.period_end).toLocaleDateString('en-US',{month:'short',day:'numeric'}))}`:''}</p>${usage.plan==='trial'?`<p>${usage.remaining_videos} free links remaining</p><p><a href="/pricing">Continue with Basic</a></p>`:`<form method="post" action="/billing/portal">${csrf}<button>Manage subscription</button></form>`}</div><p class="muted">${esc(env().PUBLIC_BRAND_NAME)} keeps temporary media/audio only while processing. Transcript cache expires automatically.</p>`));
  });


  app.post('/billing/portal',async(req,reply)=>{
    const user=await requireWebUser(req,reply); if(!user)return;
    const b=req.body as any;
    if(!verifyCsrfToken(req.headers.cookie,String(b?.csrf??'')))return reply.code(403).type('text/html').send(page(`<h1>${esc(env().PUBLIC_BRAND_NAME)}</h1><p>This billing action expired. Please try again.</p><p><a href="/account">Back</a></p>`));
    try{return reply.redirect(await createBillingPortalSession(user.id));}
    catch(e){return reply.code(400).type('text/html').send(page(`<h1>${esc(env().PUBLIC_BRAND_NAME)}</h1><p>${esc(e instanceof Error?e.message:'Could not open billing.')}</p><p><a href="/account">Back</a></p>`));}
  });

  app.post('/billing/webhook',async(req,reply)=>{
    const wrapped=req.body as any;
    const raw=typeof wrapped?.__raw==='string'?wrapped.__raw:typeof req.body==='string'?req.body:JSON.stringify(req.body??{});
    const sig=String(req.headers['x-signature']??'');
    if(!verifyLemonSignature(raw,sig))return reply.code(400).send({error:'invalid_signature'});
    await processLemonEvent(JSON.parse(raw));
    return reply.send({received:true});
  });

  app.get('/api/billing/status',async(req,reply)=>{
    const user=await requireWebUser(req,reply); if(!user)return;
    const usage=await getUsageSnapshot(user.id);
    const waiting=await pool.query<{count:string}>("SELECT COUNT(*)::text count FROM transcript_jobs WHERE user_id=$1 AND status='awaiting_payment'",[user.id]);
    return {plan:usage.plan,waiting_jobs:Number(waiting.rows[0].count)};
  });
}

