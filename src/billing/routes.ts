import type { FastifyInstance, FastifyReply } from 'fastify';
import { createBillingPortalSession, createCheckoutSession, processLemonEvent, verifyLemonSignature, type PaidPlan } from './lemon.js';
import { csrfTokenFromSessionCookie, userFromSessionCookie, verifyCsrfToken } from '../auth/service.js';
import { getUsageSnapshot } from '../quota/service.js';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

function esc(v:unknown){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!));}
function page(body:string){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(env().PUBLIC_BRAND_NAME)}</title><link rel="icon" href="/logo.svg"><style>
:root{color-scheme:light;--ink:#17151f;--muted:#706a78;--line:rgba(44,39,55,.12);--purple:#6f54e8;--purple2:#8d77ff;--bg:#fbfaf8}
*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:34px 20px 50px;background:radial-gradient(circle at 72% -10%,rgba(135,112,255,.20),transparent 34%),radial-gradient(circle at 4% 92%,rgba(239,154,98,.13),transparent 28%),var(--bg);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink)}
.shell{width:min(760px,100%);margin:0 auto}.topbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:22px}.brand{display:flex;align-items:center;gap:11px;font-size:22px;font-weight:900;letter-spacing:-.04em}.brand img{width:38px;height:38px;border-radius:11px}.email{font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:52vw}
.hero{background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:28px;padding:28px;box-shadow:0 24px 70px rgba(39,31,64,.11);backdrop-filter:blur(16px)}.eyebrow{display:inline-flex;padding:7px 10px;border-radius:999px;background:#f0edff;color:#5a45bc;font-size:11px;font-weight:850}.planrow{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin:15px 0 22px}h1,h2,h3,p{margin-top:0}h1{font-size:34px;line-height:1.05;letter-spacing:-.045em;margin-bottom:6px}h2{font-size:24px;letter-spacing:-.035em;margin-bottom:5px}.muted{color:var(--muted)}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.stat{border:1px solid var(--line);border-radius:18px;padding:17px;background:#fff}.stat strong{display:block;font-size:25px;letter-spacing:-.035em}.stat span{display:block;margin-top:3px;color:var(--muted);font-size:12px;font-weight:700}.progress{height:9px;background:#efedf2;border-radius:999px;overflow:hidden;margin:12px 0 8px}.progress>span{display:block;height:100%;background:linear-gradient(90deg,var(--purple),var(--purple2));border-radius:999px}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}a.btn,button{appearance:none;border:0;border-radius:13px;padding:12px 15px;font:inherit;font-weight:820;cursor:pointer;text-decoration:none}.primary{background:linear-gradient(135deg,var(--purple),var(--purple2));color:#fff;box-shadow:0 8px 20px rgba(111,84,232,.18)}.secondary,button.secondary{background:#f3f1f5;color:var(--ink)}button{background:#17151f;color:#fff}.fine{font-size:12px;color:#8b8491;line-height:1.55;margin:17px 0 0}.legacy{margin:16px 0}.card{border:1px solid var(--line);border-radius:18px;padding:18px;margin:16px 0;background:#fff}a{color:inherit}@media(max-width:620px){html,body{max-width:100%;overflow-x:hidden}body{padding:18px 13px 32px}.shell{width:100%}.topbar{align-items:flex-start;flex-direction:column;gap:10px;margin-bottom:16px}.brand{font-size:20px}.brand img{width:34px;height:34px}.email{max-width:100%;white-space:normal;overflow-wrap:anywhere;line-height:1.35}.hero{padding:20px 17px;border-radius:22px}.planrow{flex-direction:column;margin:14px 0 18px}.stats{grid-template-columns:1fr;gap:9px;margin:15px 0}.stat{padding:15px;border-radius:16px}.stat strong{font-size:24px}h1{font-size:30px}.actions{display:grid;grid-template-columns:1fr;gap:9px}.actions>a.btn,.actions form,.actions form button{width:100%}a.btn,button{min-height:48px;text-align:center}.card{padding:16px;border-radius:16px}.fine{overflow-wrap:anywhere}}
@media(max-width:360px){body{padding-left:10px;padding-right:10px}.hero{padding:18px 14px}h1{font-size:28px}}
</style></head><body><main class="shell">${body}</main></body></html>`;}

async function requireWebUser(req:any, reply:FastifyReply, returnTo?:string){
  const user=await userFromSessionCookie(req.headers.cookie);
  if(!user){reply.redirect(`/signup?return_to=${encodeURIComponent(returnTo??req.raw.url??'/account')}`);return null;}
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
    const returnUrl=`/pricing${Object.keys(q).length?`?${new URLSearchParams(q).toString()}`:''}`;
    if(!user)return reply.code(302).redirect(`/signup?return_to=${encodeURIComponent(returnUrl)}`);
    if(!user.email)return reply.code(302).redirect(`/signup?return_to=${encodeURIComponent(returnUrl)}`);
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
    if(!user.email)return reply.redirect(`/signup?return_to=${encodeURIComponent(returnTo)}`);
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
    const legacyIdentity=!user.email?`<div class="legacy card"><h2>Finish your account</h2><p class="muted">Add an email and password so your usage and Claude connection follow you across devices.</p><a class="btn primary" href="/signup?return_to=%2Faccount">Add email account</a></div>`:'';
    const pct=minsLimit>0?Math.min(100,Math.max(0,Math.round((minsUsed/minsLimit)*100))):0;
    const planLabel=usage.plan[0].toUpperCase()+usage.plan.slice(1);
    const renew=usage.period_end?`<p class="fine">Renews ${esc(new Date(usage.period_end).toLocaleDateString('en-US',{month:'short',day:'numeric'}))}</p>`:'';
    const trialActions=usage.plan==='trial'
      ? `<div class="actions"><a class="btn primary" href="/pricing">Upgrade to Basic</a><a class="btn secondary" href="/connect">Open setup</a></div>`
      : `<div class="actions"><form method="post" action="/billing/portal">${csrf}<button>Manage subscription</button></form><a class="btn secondary" href="/connect">Connection setup</a></div>`;
    return reply.type('text/html').send(page(`<div class="topbar"><div class="brand"><img src="/logo.svg" alt=""><span>${esc(env().PUBLIC_BRAND_NAME)}</span></div>${user.email?`<div class="email">${esc(user.email)}</div>`:''}</div>${legacyIdentity}<section class="hero"><span class="eyebrow">Your account</span><div class="planrow"><div><h1>${esc(planLabel)}</h1><p class="muted">Your Link2AI usage and plan at a glance.</p></div></div><div class="stats"><div class="stat"><strong>${minsUsed} / ${minsLimit}</strong><span>minutes used</span></div><div class="stat"><strong>${usage.plan==='trial'?esc(usage.remaining_videos):esc(planLabel)}</strong><span>${usage.plan==='trial'?'free links remaining':'current plan'}</span></div></div><div class="progress"><span style="width:${pct}%"></span></div><p class="fine">${pct}% of your current minute allowance used.</p>${renew}${trialActions}<p class="fine">${esc(env().PUBLIC_BRAND_NAME)} keeps temporary media/audio only while processing. Transcript cache expires automatically.</p><div class="actions"><form method="post" action="/auth/logout">${csrf}<button class="secondary">Sign out</button></form></div></section>`));
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

