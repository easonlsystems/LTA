import type { FastifyInstance, FastifyReply } from 'fastify';
import { createBillingPortalSession, createCheckoutSession, processLemonEvent, verifyLemonSignature, type PaidPlan } from './lemon.js';
import { csrfTokenFromSessionCookie, userFromSessionCookie, verifyCsrfToken } from '../auth/service.js';
import { getUsageSnapshot } from '../quota/service.js';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { trackWebsiteVisit } from '../analytics/visitors.js';

function esc(v:unknown){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!));}
function page(body:string,title=`${env().PUBLIC_BRAND_NAME}`){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(title)}</title><meta name="description" content="Simple Link2AI pricing for turning supported public links into source context inside your AI."><meta name="theme-color" content="#fbfaf8"><link rel="icon" href="/logo.svg"><style>
:root{color-scheme:light;--ink:#17151f;--muted:#706a78;--line:rgba(44,39,55,.12);--purple:#6f54e8;--purple2:#8d77ff;--bg:#fbfaf8}
*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:34px 20px 50px;background:radial-gradient(circle at 72% -10%,rgba(135,112,255,.20),transparent 34%),radial-gradient(circle at 4% 92%,rgba(239,154,98,.13),transparent 28%),var(--bg);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink)}
.shell{width:min(920px,100%);margin:0 auto}.topbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:22px}.brand{display:flex;align-items:center;gap:11px;font-size:22px;font-weight:900;letter-spacing:-.04em}.brand img{width:38px;height:38px;border-radius:11px}.email{font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:52vw}.brand a{text-decoration:none;display:flex;align-items:center;gap:11px;color:inherit}.toplinks{display:flex;gap:14px;align-items:center;font-size:13px;font-weight:750}.toplinks a{text-decoration:none;color:#5f5868}.pricing-intro{max-width:670px;margin-bottom:20px}.pricing-intro p{font-size:16px;line-height:1.6}.plan-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0}.plan-card{position:relative;border:1px solid var(--line);border-radius:20px;padding:20px;background:#fff}.plan-card.featured{border-color:rgba(111,84,232,.30);background:linear-gradient(180deg,#fff,#faf8ff);box-shadow:0 14px 38px rgba(111,84,232,.08)}.plan-name{font-size:13px;font-weight:850;color:#625b6b}.plan-price{font-size:31px;font-weight:900;letter-spacing:-.045em;margin:9px 0}.plan-price small{font-size:12px;color:var(--muted);font-weight:650;letter-spacing:0}.plan-list{list-style:none;padding:0;margin:15px 0 0;display:grid;gap:8px;font-size:13px;color:var(--muted);line-height:1.45}.plan-list li:before{content:"✓";color:#158f67;font-weight:900;margin-right:7px}.plan-fit{font-size:11px;font-weight:850;color:#6f54e8;margin-top:7px}.plan-card form{margin-top:16px}.plan-card button,.plan-card .btn{width:100%;display:inline-flex;justify-content:center}.plan-note{font-size:12px;color:#8b8491;line-height:1.55;margin-top:15px}.usage-rule{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:16px}.usage-rule div{border:1px solid var(--line);border-radius:14px;padding:12px 13px;background:rgba(255,255,255,.76);font-size:12px;line-height:1.45;color:var(--muted)}.usage-rule strong{display:block;color:#3f3946;margin-bottom:3px}.public-cta{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}
.hero{background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:28px;padding:28px;box-shadow:0 24px 70px rgba(39,31,64,.11);backdrop-filter:blur(16px)}.eyebrow{display:inline-flex;padding:7px 10px;border-radius:999px;background:#f0edff;color:#5a45bc;font-size:11px;font-weight:850}.planrow{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin:15px 0 22px}h1,h2,h3,p{margin-top:0}h1{font-size:34px;line-height:1.05;letter-spacing:-.045em;margin-bottom:6px}h2{font-size:24px;letter-spacing:-.035em;margin-bottom:5px}.muted{color:var(--muted)}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0}.stat{border:1px solid var(--line);border-radius:18px;padding:17px;background:#fff}.stat strong{display:block;font-size:25px;letter-spacing:-.035em}.stat span{display:block;margin-top:3px;color:var(--muted);font-size:12px;font-weight:700}.progress{height:9px;background:#efedf2;border-radius:999px;overflow:hidden;margin:12px 0 8px}.progress>span{display:block;height:100%;background:linear-gradient(90deg,var(--purple),var(--purple2));border-radius:999px}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}a.btn,button{appearance:none;border:0;border-radius:13px;padding:12px 15px;font:inherit;font-weight:820;cursor:pointer;text-decoration:none}a:focus-visible,button:focus-visible{outline:3px solid rgba(111,84,232,.28);outline-offset:3px}.primary{background:linear-gradient(135deg,var(--purple),var(--purple2));color:#fff;box-shadow:0 8px 20px rgba(111,84,232,.18)}.secondary,button.secondary{background:#f3f1f5;color:var(--ink)}button{background:#17151f;color:#fff}.fine{font-size:12px;color:#8b8491;line-height:1.55;margin:17px 0 0}.legacy{margin:16px 0}.card{border:1px solid var(--line);border-radius:18px;padding:18px;margin:16px 0;background:#fff}a{color:inherit}@media(max-width:760px){.plan-grid,.usage-rule{grid-template-columns:1fr}.toplinks{display:none}}@media(max-width:620px){html,body{max-width:100%;overflow-x:hidden}body{padding:18px 13px 32px}.shell{width:100%}.topbar{align-items:flex-start;flex-direction:column;gap:10px;margin-bottom:16px}.brand{font-size:20px}.brand img{width:34px;height:34px}.email{max-width:100%;white-space:normal;overflow-wrap:anywhere;line-height:1.35}.hero{padding:20px 17px;border-radius:22px}.planrow{flex-direction:column;margin:14px 0 18px}.stats{grid-template-columns:1fr;gap:9px;margin:15px 0}.stat{padding:15px;border-radius:16px}.stat strong{font-size:24px}h1{font-size:30px}.actions{display:grid;grid-template-columns:1fr;gap:9px}.actions>a.btn,.actions form,.actions form button{width:100%}a.btn,button{min-height:48px;text-align:center}.card{padding:16px;border-radius:16px}.fine{overflow-wrap:anywhere}}
@media(max-width:360px){body{padding-left:10px;padding-right:10px}.hero{padding:18px 14px}h1{font-size:28px}}
</style></head><body><main class="shell">${body}${env().SUPPORT_EMAIL?`<p class="fine" style="text-align:center;margin-top:18px">Need help? <a href="mailto:${esc(env().SUPPORT_EMAIL)}"><strong>${esc(env().SUPPORT_EMAIL)}</strong></a></p>`:''}</main></body></html>`;}

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
    await trackWebsiteVisit(req,reply,'/pricing');
    const q=req.query as any;
    const user=await userFromSessionCookie(req.headers.cookie);
    const returnUrl=`/pricing${Object.keys(q).length?`?${new URLSearchParams(q).toString()}`:''}`;
    const resume=q.resume_job_id?String(q.resume_job_id):'';
    const chosen:PaidPlan=q.plan==='pro'?'pro':'basic';
    const topbar=(email?:string|null)=>`<div class="topbar"><div class="brand"><a href="/"><img src="/logo.svg" alt=""><span>${esc(env().PUBLIC_BRAND_NAME)}</span></a></div>${email?`<div class="email">${esc(email)}</div>`:`<div class="toplinks"><a href="/">Home</a><a href="/#supported">Supported links</a><a href="/support">Support</a></div>`}</div>`;
    const plans=(actions:string)=>`<div class="plan-grid"><div class="plan-card"><div class="plan-name">Trial</div><div class="plan-fit">Best for: proving the workflow</div><div class="plan-price">$0</div><ul class="plan-list"><li>10 processing units</li><li>Same supported content types</li><li>No card required</li></ul>${actions==='public'?`<div class="actions"><a class="btn secondary" href="/connect">Start free</a></div>`:''}</div><div class="plan-card ${chosen==='basic'?'featured':''}"><div class="plan-name">Basic</div><div class="plan-fit">Best for: regular personal use</div><div class="plan-price">$4.99 <small>/ month</small></div><ul class="plan-list"><li>500 processing units / month</li><li>No fixed link-count limit</li><li>Up to 30 minutes per video</li><li>2 concurrent jobs</li></ul>${actions==='public'?`<div class="actions"><a class="btn primary" href="/connect">Start free first</a></div>`:actions==='checkout'?`<form id="checkout-basic" method="post" action="/billing/checkout">${csrfField(req.headers.cookie)}<input type="hidden" name="plan" value="basic"><input type="hidden" name="resume_job_id" value="${esc(resume)}"><button class="primary">Choose Basic</button></form>`:''}</div><div class="plan-card ${chosen==='pro'?'featured':''}"><div class="plan-name">Pro</div><div class="plan-fit">Best for: heavier research + long videos</div><div class="plan-price">$9.99 <small>/ month</small></div><ul class="plan-list"><li>2,000 processing units / month</li><li>No fixed link-count limit</li><li>Up to 120 minutes per video</li><li>4 concurrent jobs</li></ul>${actions==='public'?`<div class="actions"><a class="btn secondary" href="/connect">Start free first</a></div>`:actions==='checkout'?`<form id="checkout-pro" method="post" action="/billing/checkout">${csrfField(req.headers.cookie)}<input type="hidden" name="plan" value="pro"><input type="hidden" name="resume_job_id" value="${esc(resume)}"><button>Choose Pro</button></form>`:''}</div></div><div class="usage-rule"><div><strong>Text-based links</strong>About 2,500 estimated tokens successfully returned to the AI = 1 processing unit. Successful reads use at least 1 unit.</div><div><strong>Video</strong>Each started minute successfully processed = 1 processing unit, subject to your plan’s per-video limit.</div><div><strong>Failed / partial reads</strong>Unsupported, inaccessible, login-required, empty or failed reads use 0 units. Truncated reads charge only the content actually processed and tell the AI the source was partial.</div></div><p class="plan-note"><strong>Quick examples:</strong> a 9-minute processed video uses 9 units; an approximately 1,800-token article uses 1 unit; an approximately 6,100-token discussion uses about 3 units. Text token counts are deterministic estimates used for billing, not the host AI’s exact tokenizer.</p>`;
    if(!user){
      return reply.type('text/html').send(page(`${topbar()}<section class="hero"><span class="eyebrow">Pricing</span><div class="pricing-intro"><h1>Start free. Upgrade only when you know what you need.</h1><p class="muted">First, try one real supported link. If the workflow is useful, choose Basic for regular use or Pro when you need more monthly processing capacity, longer videos and more concurrency.</p></div>${plans('public')}<p class="plan-note">Supported public links only. There is no fixed link-count limit on Basic or Pro. Failed or unsupported reads use 0 processing units. Very large sources may be partially processed with a truncation notice. Paid upgrades become available after you have successfully used the trial workflow once.</p></section>`,`${esc(env().PUBLIC_BRAND_NAME)} Pricing`));
    }
    if(!user.email)return reply.code(302).redirect(`/signup?return_to=${encodeURIComponent(returnUrl)}`);
    const usage=await getUsageSnapshot(user.id);
    if(usage.plan==='trial'&&!resume){
      const usageRows=await pool.query<{count:string}>("SELECT COUNT(*)::text count FROM usage_ledger WHERE user_id=$1",[user.id]);
      if(Number(usageRows.rows[0].count)===0){
        return reply.type('text/html').send(page(`${topbar(user.email)}<section class="hero"><span class="eyebrow">Your trial is ready</span><div class="pricing-intro"><h1>Use one real link first.</h1><p class="muted">Your account still has the free founding trial available. Connect Link2AI, process a supported public link, then come back here if you want more capacity.</p></div>${plans('public')}<div class="public-cta"><a class="btn primary" href="/connect">Connect and try a link →</a><a class="btn secondary" href="/account">Back to account</a></div></section>`,`${esc(env().PUBLIC_BRAND_NAME)} Pricing`));
      }
    }
    return reply.type('text/html').send(page(`${topbar(user.email)}<section class="hero"><span class="eyebrow">Upgrade</span><div class="pricing-intro"><h1>Pick based on processing capacity and video length — not content type.</h1><p class="muted">Basic and Pro read the same supported content types. Pro mainly gives you more monthly processing capacity, longer per-video limits and higher concurrency.</p></div>${plans('checkout')}<p class="plan-note">Only successfully processed content consumes usage. Unsupported, inaccessible, login-required, empty or failed reads use 0 processing units. You can manage or cancel a paid subscription from your account.</p></section>`,`${esc(env().PUBLIC_BRAND_NAME)} Pricing`));
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
        return reply.code(409).type('text/html').send(page(`<h1>${esc(env().PUBLIC_BRAND_NAME)}</h1><p>Complete one supported public link first.</p><p>Try reading a supported public video, post, or webpage to activate your trial, then return here to upgrade.</p><p><a href="/connect">Back to ${esc(env().PUBLIC_BRAND_NAME)}</a></p>`));
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
    const unitsUsed=Math.ceil(usage.used_seconds/60), unitsLimit=Math.round(usage.limit_seconds/60), unitsRemaining=Math.max(0,unitsLimit-unitsUsed);
    const csrf=csrfField(req.headers.cookie);
    const legacyIdentity=!user.email?`<div class="legacy card"><h2>Finish your account</h2><p class="muted">Add an email and password so your usage and Claude connection follow you across devices.</p><a class="btn primary" href="/signup?return_to=%2Faccount">Add email account</a></div>`:'';
    const pct=unitsLimit>0?Math.min(100,Math.max(0,Math.round((unitsUsed/unitsLimit)*100))):0;
    const planLabel=usage.plan[0].toUpperCase()+usage.plan.slice(1);
    const renew=usage.period_end?`<p class="fine">Renews ${esc(new Date(usage.period_end).toLocaleDateString('en-US',{month:'short',day:'numeric'}))}</p>`:'';
    const trialActions=usage.plan==='trial'
      ? `<div class="actions"><a class="btn primary" href="/pricing">Upgrade to Basic</a><a class="btn secondary" href="/connect">Open setup</a></div>`
      : `<div class="actions"><form method="post" action="/billing/portal">${csrf}<button>Manage subscription</button></form><a class="btn secondary" href="/connect">Connection setup</a></div>`;
    return reply.type('text/html').send(page(`<div class="topbar"><div class="brand"><img src="/logo.svg" alt=""><span>${esc(env().PUBLIC_BRAND_NAME)}</span></div>${user.email?`<div class="email">${esc(user.email)}</div>`:''}</div>${legacyIdentity}<section class="hero"><span class="eyebrow">Your account</span><div class="planrow"><div><h1>${esc(planLabel)}</h1><p class="muted">Your Link2AI processing usage and plan at a glance.</p></div></div><div class="stats"><div class="stat"><strong>${unitsRemaining}</strong><span>processing units remaining</span></div><div class="stat"><strong>${unitsUsed} / ${unitsLimit}</strong><span>used this period</span></div><div class="stat"><strong>${esc(planLabel)}</strong><span>current plan · no fixed link-count cap</span></div></div><div class="progress"><span style="width:${pct}%"></span></div><p class="fine">${pct}% of your current processing-unit allowance used. Video uses 1 unit per started processed minute. Text uses about 1 unit per 2,500 estimated tokens successfully returned to the AI. Failed or unsupported reads use 0 units.</p>${renew}${trialActions}<p class="fine">${esc(env().PUBLIC_BRAND_NAME)} keeps temporary media/audio only while processing. Source-context cache expires automatically.</p><div class="actions"><form method="post" action="/auth/logout">${csrf}<button class="secondary">Sign out</button></form></div></section>`));
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

