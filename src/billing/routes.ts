import type { FastifyInstance, FastifyReply } from 'fastify';
import { canPurchaseTopup, createBillingPortalSession, createCheckoutSession, createTopupCheckoutSession, processLemonEvent, topupConfigured, verifyLemonSignature, type PaidPlan, type TopupPack } from './lemon.js';
import { csrfTokenFromSessionCookie, userFromSessionCookie, verifyCsrfToken } from '../auth/service.js';
import { getUsageSnapshot } from '../quota/service.js';
import { env } from '../config/env.js';
import { logErrorEvent } from '../util/log.js';
import { pool } from '../db/pool.js';
import { trackWebsiteEvent, trackWebsiteVisit } from '../analytics/visitors.js';
import { recordActivationEvent } from '../analytics/product.js';
import { getFoundingOfferStatus } from './founding.js';
import { FOUNDING_LIMIT } from './foundingPolicy.js';
import { createApiKey, listApiKeys, revokeApiKey } from '../api/apiKeys.js';

function esc(v:unknown){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!));}
function page(body:string,title=`${env().PUBLIC_BRAND_NAME}`){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(title)}</title><meta name="description" content="Simple LTA pricing for turning supported public links into source context inside your AI."><meta name="theme-color" content="#17141c"><link rel="icon" href="/logo.svg"><style>
:root{color-scheme:light;--ink:#17151f;--muted:#706a78;--line:rgba(44,39,55,.12);--purple:#6f54e8;--purple2:#8d77ff;--bg:#fbfaf8}
*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:34px 20px 50px;background:radial-gradient(circle at 72% -10%,rgba(135,112,255,.20),transparent 34%),radial-gradient(circle at 4% 92%,rgba(239,154,98,.13),transparent 28%),var(--bg);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink)}
.shell{width:min(920px,100%);margin:0 auto}.topbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:22px}.brand{display:flex;align-items:center;gap:11px;font-size:22px;font-weight:900;letter-spacing:-.04em}.brand img{width:38px;height:38px;border-radius:11px}.email{font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:52vw}.brand a{text-decoration:none;display:flex;align-items:center;gap:11px;color:inherit}.toplinks{display:flex;gap:14px;align-items:center;font-size:13px;font-weight:750}.toplinks a{text-decoration:none;color:#5f5868}.pricing-intro{max-width:670px;margin-bottom:20px}.pricing-intro p{font-size:16px;line-height:1.6}.plan-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0}.plan-card{position:relative;border:1px solid var(--line);border-radius:20px;padding:20px;background:#fff}.plan-card.featured{border-color:rgba(111,84,232,.30);background:linear-gradient(180deg,#fff,#faf8ff);box-shadow:0 14px 38px rgba(111,84,232,.08)}.plan-name{font-size:13px;font-weight:850;color:#625b6b}.plan-price{font-size:31px;font-weight:900;letter-spacing:-.045em;margin:9px 0}.plan-price small{font-size:12px;color:var(--muted);font-weight:650;letter-spacing:0}.plan-list{list-style:none;padding:0;margin:15px 0 0;display:grid;gap:8px;font-size:13px;color:var(--muted);line-height:1.45}.plan-list li:before{content:"✓";color:#158f67;font-weight:900;margin-right:7px}.plan-fit{font-size:11px;font-weight:850;color:#6f54e8;margin-top:7px}.plan-card form{margin-top:16px}.plan-card button,.plan-card .btn{width:100%;display:inline-flex;justify-content:center}.plan-note{font-size:12px;color:#8b8491;line-height:1.55;margin-top:15px}.usage-rule{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:16px}.usage-rule div{border:1px solid var(--line);border-radius:14px;padding:12px 13px;background:rgba(255,255,255,.76);font-size:12px;line-height:1.45;color:var(--muted)}.usage-rule strong{display:block;color:#3f3946;margin-bottom:3px}.founding-banner{display:flex;align-items:center;justify-content:space-between;gap:18px;margin:14px 0 18px;padding:14px 16px;border:1px solid rgba(111,84,232,.20);border-radius:16px;background:rgba(244,241,255,.72)}.founding-banner>div:first-child{display:grid;gap:3px}.founding-kicker{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.09em;color:#6f54e8}.founding-banner strong{font-size:13px}.founding-banner span:last-child{font-size:11px;color:var(--muted)}.founding-progress{flex:0 0 auto;font-size:11px;font-weight:850;color:#5a45bc;white-space:nowrap}.usage-details{margin-top:18px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.62);overflow:hidden}.usage-details summary{cursor:pointer;list-style:none;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:14px;font-size:12px;color:var(--muted)}.usage-details summary::-webkit-details-marker{display:none}.usage-details summary strong{color:#3f3946}.usage-details[open] summary{border-bottom:1px solid var(--line)}.usage-details .usage-rule{margin:0;padding:14px}.usage-examples{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:0 14px 14px}.usage-example{padding:10px 11px;border-radius:12px;background:#fff;border:1px solid var(--line);font-size:11px;color:var(--muted)}.usage-example strong{display:block;color:#3f3946;font-size:13px;margin-bottom:2px}.usage-details .plan-note{padding:0 14px 14px;margin:0}.public-cta{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}.topup-card{margin-top:16px}.topup-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px}.topup-option{border:1px solid var(--line);border-radius:14px;padding:14px;background:#fff}.topup-option strong{display:block;font-size:18px;margin-bottom:3px}.topup-option span{font-size:12px;color:var(--muted)}.topup-option form{margin-top:10px}.topup-option button{width:100%}
.hero{background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:28px;padding:28px;box-shadow:0 24px 70px rgba(39,31,64,.11);backdrop-filter:blur(16px)}.eyebrow{display:inline-flex;padding:7px 10px;border-radius:999px;background:#f0edff;color:#5a45bc;font-size:11px;font-weight:850}.planrow{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin:15px 0 22px}h1,h2,h3,p{margin-top:0}h1{font-size:34px;line-height:1.05;letter-spacing:-.045em;margin-bottom:6px}h2{font-size:24px;letter-spacing:-.035em;margin-bottom:5px}.muted{color:var(--muted)}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0}.stat{border:1px solid var(--line);border-radius:18px;padding:17px;background:#fff}.stat strong{display:block;font-size:25px;letter-spacing:-.035em}.stat span{display:block;margin-top:3px;color:var(--muted);font-size:12px;font-weight:700}.progress{height:9px;background:#efedf2;border-radius:999px;overflow:hidden;margin:12px 0 8px}.progress>span{display:block;height:100%;background:linear-gradient(90deg,var(--purple),var(--purple2));border-radius:999px}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}a.btn,button{appearance:none;border:0;border-radius:13px;padding:12px 15px;font:inherit;font-weight:820;cursor:pointer;text-decoration:none}a:focus-visible,button:focus-visible{outline:3px solid rgba(111,84,232,.28);outline-offset:3px}.primary{background:linear-gradient(135deg,var(--purple),var(--purple2));color:#fff;box-shadow:0 8px 20px rgba(111,84,232,.18)}.secondary,button.secondary{background:#f3f1f5;color:var(--ink)}button{background:#17151f;color:#fff}.fine{font-size:12px;color:#8b8491;line-height:1.55;margin:17px 0 0}.legacy{margin:16px 0}.card{border:1px solid var(--line);border-radius:18px;padding:18px;margin:16px 0;background:#fff}.api-key-create{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:end;margin:16px 0 6px}.api-key-field{display:grid;gap:7px}.api-key-field label{font-size:11px;font-weight:850;color:#5f5868}.api-key-field input{width:100%;border:1px solid var(--line);border-radius:13px;padding:12px 14px;font:inherit;background:#fff;color:var(--ink)}.api-key-field small{font-size:11px;line-height:1.45;color:var(--muted)}.api-key-empty{border:1px dashed rgba(44,39,55,.16);border-radius:14px;padding:15px 16px;background:#faf9fc;color:var(--muted);font-size:12px;line-height:1.5}.api-key-list{margin-top:14px}.api-key-created{border:1px solid rgba(111,84,232,.20);background:linear-gradient(180deg,#fff,#faf8ff);border-radius:18px;padding:18px;margin:18px 0}.api-key-created code{display:block;overflow-wrap:anywhere;font-size:14px;line-height:1.5;padding:13px 14px;background:#17151f;color:#fff;border-radius:12px}.api-key-created-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}.api-key-created-head strong{font-size:13px}.copy-api-key{background:#f0edff;color:#5a45bc}.api-key-next{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.api-key-next div{border:1px solid var(--line);border-radius:14px;padding:13px;background:#fff;font-size:12px;line-height:1.5;color:var(--muted)}.api-key-next strong{display:block;color:#3f3946;margin-bottom:4px}.api-purpose{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0}.api-purpose a{display:grid;gap:4px;padding:13px 14px;border:1px solid var(--line);border-radius:14px;text-decoration:none;background:#fff}.api-purpose a strong{font-size:13px}.api-purpose a span{font-size:11px;line-height:1.45;color:var(--muted)}.api-purpose a.api-purpose-build{border-color:rgba(111,84,232,.22);background:#faf8ff}.api-ps{margin-top:14px;padding:14px;border-radius:14px;background:#17151f;color:#fff;overflow:auto;font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre}.api-what-next{margin:18px 0 4px;padding:16px;border:1px solid rgba(111,84,232,.17);border-radius:16px;background:#faf8ff}.api-what-next h3{font-size:16px;margin:0 0 6px}.api-what-next p{font-size:12px;line-height:1.55;color:var(--muted);margin:0}a{color:inherit}@media(max-width:760px){.plan-grid,.usage-rule,.usage-examples,.topup-grid{grid-template-columns:1fr}.toplinks{display:none}}@media(max-width:620px){html,body{max-width:100%;overflow-x:hidden}body{padding:18px 13px 32px}.shell{width:100%}.topbar{align-items:flex-start;flex-direction:column;gap:10px;margin-bottom:16px}.brand{font-size:20px}.brand img{width:34px;height:34px}.email{max-width:100%;white-space:normal;overflow-wrap:anywhere;line-height:1.35}.hero{padding:20px 17px;border-radius:22px}.planrow{flex-direction:column;margin:14px 0 18px}.stats{grid-template-columns:1fr;gap:9px;margin:15px 0}.stat{padding:15px;border-radius:16px}.stat strong{font-size:24px}h1{font-size:30px}.actions{display:grid;grid-template-columns:1fr;gap:9px}.actions>a.btn,.actions form,.actions form button{width:100%}a.btn,button{min-height:48px;text-align:center}.card{padding:16px;border-radius:16px}.api-key-create{grid-template-columns:1fr}.api-key-create button{width:100%}.api-key-next,.api-purpose{grid-template-columns:1fr}.fine{overflow-wrap:anywhere}}
@media(max-width:360px){body{padding-left:10px;padding-right:10px}.hero{padding:18px 14px}h1{font-size:28px}}
/* Open desktop pricing canvas · 2026-09-17 */
@media(min-width:761px){
  body{min-height:100svh;padding:28px 48px 52px;background:radial-gradient(circle at 78% -10%,rgba(106,120,255,.18),transparent 40%),radial-gradient(circle at 3% 8%,rgba(179,123,255,.11),transparent 31%),linear-gradient(180deg,#fbfaff 0%,#f8f7fc 54%,#f5f3fa 100%);background-attachment:fixed;background-size:cover}
  .shell:has(.plan-grid){width:min(1480px,100%)}
  .shell:has(.plan-grid) .topbar{min-height:64px;margin-bottom:22px}
  .hero:has(.plan-grid){background:transparent;border:0;border-radius:0;padding:24px 0 0;box-shadow:none;backdrop-filter:none}
  .hero:has(.plan-grid)>.eyebrow{margin-bottom:14px}
  .hero:has(.plan-grid) .pricing-intro{max-width:none;display:grid;grid-template-columns:minmax(0,1.12fr) minmax(360px,.88fr);gap:64px;align-items:end;margin-bottom:26px}
  .hero:has(.plan-grid) .pricing-intro h1{font-size:clamp(50px,4.1vw,70px);line-height:.98;letter-spacing:-.055em;max-width:900px;margin-bottom:0}
  .hero:has(.plan-grid) .pricing-intro p{font-size:18px;line-height:1.55;max-width:620px;margin:0;justify-self:end}
  .hero:has(.plan-grid) .plan-grid{gap:18px;margin:20px 0 18px}
  .hero:has(.plan-grid) .plan-card{padding:26px 28px;border-radius:24px;min-height:0;background:rgba(255,255,255,.82);box-shadow:0 10px 34px rgba(44,34,78,.04)}
  .hero:has(.plan-grid) .plan-card.featured{box-shadow:0 20px 52px rgba(111,84,232,.10)}
  .hero:has(.plan-grid) .plan-name{font-size:15px}
  .hero:has(.plan-grid) .plan-fit{font-size:12px;margin-top:8px}
  .hero:has(.plan-grid) .plan-price{font-size:44px;margin:12px 0}
  .hero:has(.plan-grid) .plan-list{font-size:14px;gap:9px;line-height:1.42}
  .hero:has(.plan-grid) .plan-card form{margin-top:18px}
  .hero:has(.plan-grid) .usage-rule{gap:14px;margin-top:18px}
  .hero:has(.plan-grid) .usage-rule div{padding:15px 17px;border-radius:16px;background:rgba(255,255,255,.62);font-size:12px;line-height:1.5}
  .hero:has(.plan-grid) .plan-note{max-width:1120px;font-size:12px;line-height:1.55;margin-top:16px}
}

.top-cta{display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:999px;background:#654de1;color:#fff;text-decoration:none;font-size:12px;font-weight:850;white-space:nowrap}.top-cta:focus-visible{outline:3px solid #225dca;outline-offset:3px}@media(max-width:620px){.topbar:has(.top-cta){flex-direction:row;align-items:center}.top-cta{min-height:44px;padding:8px 11px;font-size:11px}}
/* LTA billing surface: same black source-relay world as the product site. */
body{padding:0;background:#17141c;color:#f7f3fb}.shell{width:100%;max-width:none}.topbar{min-height:72px;padding:0 max(28px,calc((100vw - 1240px)/2));margin:0;border-bottom:1px solid rgba(255,255,255,.10);background:#17141c}.brand img{border-radius:9px}.toplinks{margin-left:auto}.toplinks a{color:#c9c1ce}.top-cta{margin-left:18px;background:#765de8}.hero,.card{color:#231f28}.hero{width:min(1240px,calc(100% - 56px));margin:48px auto 0;padding:0 0 56px;background:transparent;border:0;border-radius:0;box-shadow:none;backdrop-filter:none}.hero:not(:has(.plan-grid)){padding:30px;background:#fbfaf8;border-radius:16px}.hero:has(.plan-grid)>.eyebrow,.hero>.eyebrow{display:none}.pricing-intro{max-width:920px;margin:0 0 34px}.pricing-intro h1{max-width:18ch;font-size:clamp(42px,5vw,64px);line-height:1.04;letter-spacing:-.04em;color:#fff}.pricing-intro p{max-width:68ch;color:#c1b8c7}.plan-grid{gap:1px;margin:0;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.12);border-radius:16px;overflow:hidden}.plan-card,.plan-card.featured{border:0;border-radius:0;background:#211d25;box-shadow:none;color:#fff;padding:28px}.plan-card.featured{background:#2a2336}.plan-name{color:#fff}.plan-fit,.plan-list,.plan-price small{color:#bdb3c4}.plan-fit{font-size:12px}.plan-price{font-size:40px;letter-spacing:-.035em}.plan-list{font-size:14px}.usage-details{margin-top:18px;border-color:rgba(255,255,255,.12);border-radius:14px;background:#211d25}.usage-details summary,.usage-details summary strong{color:#e8e1ec}.usage-details[open] summary{border-color:rgba(255,255,255,.12)}.usage-rule div,.usage-example{border:0;border-radius:0;background:transparent;color:#bdb3c4}.usage-rule strong,.usage-example strong{color:#fff}.plan-note,.fine{color:#aaa1b0}.founding-banner{border-radius:14px;border-color:rgba(139,116,255,.35);background:#241f30;color:#fff}.founding-banner span:last-child{color:#bdb3c4}.card.topup-card{width:min(1240px,calc(100% - 56px));margin:22px auto 0;background:#211d25;border-color:rgba(255,255,255,.12);color:#fff}.topup-option{background:transparent;border-color:rgba(255,255,255,.14);border-radius:12px}.topup-option span,.card .muted{color:#bdb3c4}.primary{background:#765de8;box-shadow:none}.secondary,button.secondary{background:#eee9f2;color:#231f28}.account-alert{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center;margin:18px 0;padding:18px 20px;border:1px solid rgba(239,154,98,.38);border-radius:14px;background:#fff7ed;color:#4b3325}.account-alert.low{border-color:#ddd2a4;background:#fffbed;color:#463d20}.account-alert strong{display:block;font-size:17px;margin-bottom:4px}.account-alert p{margin:0;font-size:13px;line-height:1.5}.account-alert .actions{margin:0}.stats{gap:1px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--line)}.stat{border:0;border-radius:0}.progress>span{background:#765de8}.shell>p.fine{color:#aaa1b0}.shell>p.fine a{color:#fff}.email{color:#c9c1ce}
@media(min-width:761px){body{padding:0;background:#17141c}.shell:has(.plan-grid){width:100%}.shell:has(.plan-grid) .topbar{margin-bottom:0}.hero:has(.plan-grid){width:min(1240px,calc(100% - 56px));padding:0 0 56px;margin-top:48px}.hero:has(.plan-grid) .pricing-intro{display:block;margin-bottom:34px}.hero:has(.plan-grid) .pricing-intro h1{font-size:clamp(42px,5vw,64px);line-height:1.04;letter-spacing:-.04em;max-width:18ch;margin-bottom:16px}.hero:has(.plan-grid) .pricing-intro p{font-size:17px;justify-self:auto}.hero:has(.plan-grid) .plan-grid{gap:1px;margin:0}.hero:has(.plan-grid) .plan-card{padding:28px;border-radius:0;background:#211d25;box-shadow:none}.hero:has(.plan-grid) .plan-card.featured{background:#2a2336;box-shadow:none}}
@media(max-width:760px){.topbar{min-height:64px;padding:0 16px;flex-direction:row;align-items:center;margin:0}.toplinks{display:none}.top-cta{margin-left:auto}.hero,.hero:has(.plan-grid),.card.topup-card{width:calc(100% - 28px);margin-top:30px;padding:0 0 38px}.hero:not(:has(.plan-grid)){padding:20px 17px}.pricing-intro h1,.hero:has(.plan-grid) .pricing-intro h1{font-size:clamp(34px,10vw,42px);line-height:1.08;max-width:none}.pricing-intro p{font-size:15px;line-height:1.58}.plan-grid{display:block}.plan-card{padding:22px}.plan-card+.plan-card{border-top:1px solid rgba(255,255,255,.12)}.usage-details summary{align-items:flex-start;flex-direction:column}.account-alert{grid-template-columns:1fr}.account-alert .actions{display:grid}.stats{grid-template-columns:1fr}.stat+.stat{border-top:1px solid var(--line)}}
</style></head><body><main class="shell">${body}${env().SUPPORT_EMAIL?`<p class="fine" style="text-align:center;margin-top:18px">Need help? <a href="mailto:${esc(env().SUPPORT_EMAIL)}"><strong>${esc(env().SUPPORT_EMAIL)}</strong></a></p>`:''}<p class="fine" style="text-align:center;margin-top:12px">${esc(env().PUBLIC_BRAND_NAME)} is a product by Eason Systems.</p></main></body></html>`;}

async function requireWebUser(req:any, reply:FastifyReply, returnTo?:string){
  const user=await userFromSessionCookie(req.headers.cookie);
  if(!user){reply.redirect(`/signup?return_to=${encodeURIComponent(returnTo??req.raw.url??'/account')}`);return null;}
  return user;
}

function csrfField(cookieHeader:string|undefined):string{
  const csrf=csrfTokenFromSessionCookie(cookieHeader);
  return csrf?`<input type="hidden" name="csrf" value="${esc(csrf)}">`:''
}

function topupSection(cookieHeader:string|undefined):string{
  return `<section class="card topup-card"><h2>Need more units?</h2><p class="muted">Active Basic and Pro subscribers can add extra units anytime. Purchased units do not expire; if you cancel, they stay on the account and unlock again when you resubscribe.</p><div class="topup-grid"><div class="topup-option"><strong>+500 units</strong><span>US$3.99 · one-time</span><form method="post" action="/billing/topup">${csrfField(cookieHeader)}<input type="hidden" name="pack" value="500"><button class="primary">Add 500 units</button></form></div><div class="topup-option"><strong>+1,500 units</strong><span>US$8.99 · one-time</span><form method="post" action="/billing/topup">${csrfField(cookieHeader)}<input type="hidden" name="pack" value="1500"><button>Add 1,500 units</button></form></div></div><p class="fine"><strong>No automatic overage charges.</strong> Expiring Founding bonus is consumed before your persistent paid balance.</p></section>`;
}

export async function registerBillingRoutes(app:FastifyInstance):Promise<void>{
  app.get('/pricing',async(req,reply)=>{
    await trackWebsiteVisit(req,reply,'/pricing');
    const q=req.query as any;
    const user=await userFromSessionCookie(req.headers.cookie);
    const returnUrl=`/pricing${Object.keys(q).length?`?${new URLSearchParams(q).toString()}`:''}`;
    const resume=q.resume_job_id?String(q.resume_job_id):'';
    const chosen:PaidPlan=q.plan==='pro'?'pro':'basic';
    const founding=await getFoundingOfferStatus().catch(()=>({claimed:0,remaining:FOUNDING_LIMIT,open:true,progressText:null}));
    const foundingBanner=founding.open?`<div class="founding-banner"><div><span class="founding-kicker">Founding offer</span><strong>First ${FOUNDING_LIMIT} paid users get 50% more usage for their first 3 paid billing cycles.</strong><span>No coupon required · founding bonus resets each billing cycle and does not roll over · changing plans ends the remaining bonus.</span></div>${founding.progressText?`<div class="founding-progress">${esc(founding.progressText)}</div>`:''}</div>`:'';
    const topbar=(email?:string|null)=>`<div class="topbar"><div class="brand"><a href="/"><img src="/logo.svg" alt=""><span>${esc(env().PUBLIC_BRAND_NAME)}</span></a></div><div class="toplinks"><a href="/connect">How it works</a><a href="/sources">Sources</a><a href="/pricing">Pricing</a><a href="/developers">Developers</a></div>${email?`<div class="email">${esc(email)}</div>`:`<a class="top-cta" href="/start?from=pricing">Add LTA to Claude</a>`}</div>`;
    const topupInfo=`<section class="card topup-card"><h2>Need more units?</h2><p class="muted">Active Basic and Pro subscribers can add extra units anytime.</p><div class="topup-grid"><div class="topup-option"><strong>+500 units</strong><span>US$3.99 · one-time</span></div><div class="topup-option"><strong>+1,500 units</strong><span>US$8.99 · one-time</span></div></div><p class="fine">Purchased units never expire. If you cancel, the remaining paid balance stays on the account and becomes available again when you resubscribe. <strong>No automatic overage charges.</strong></p></section>`;
    const plans=(actions:string)=>`${foundingBanner}<div class="plan-grid"><div class="plan-card"><div class="plan-name">Trial</div><div class="plan-fit">Best for: proving the workflow</div><div class="plan-price">$0</div><ul class="plan-list"><li>10 processing units free</li><li>No card required</li><li>Failed / unsupported / inaccessible reads cost 0</li></ul>${actions==='public'?`<div class="actions"><a class="btn secondary" href="/start?from=pricing">Start free</a></div>`:''}</div><div class="plan-card ${chosen==='basic'?'featured':''}"><div class="plan-name">Basic</div><div class="plan-fit">Best for: regular personal use</div><div class="plan-price">$4.99 <small>/ month</small></div><ul class="plan-list">${founding.open?'<li><strong>500 paid units + 250 founding bonus for each of the first 3 paid billing cycles</strong></li>':'<li>500 paid units added each billing cycle</li>'}<li>Unused paid units roll over while subscribed</li><li>No fixed link-count limit</li><li>No plan-specific video length limit</li><li>2 concurrent jobs</li></ul>${actions==='public'?`<div class="actions"><a class="btn primary" href="/start?from=pricing">Start free first</a></div>`:actions==='checkout'?`<form id="checkout-basic" method="post" action="/billing/checkout">${csrfField(req.headers.cookie)}<input type="hidden" name="plan" value="basic"><input type="hidden" name="resume_job_id" value="${esc(resume)}"><button class="primary">Choose Basic</button></form>`:''}</div><div class="plan-card ${chosen==='pro'?'featured':''}"><div class="plan-name">Pro</div><div class="plan-fit">Best for: heavier research + higher throughput</div><div class="plan-price">$9.99 <small>/ month</small></div><ul class="plan-list">${founding.open?'<li><strong>2,000 paid units + 1,000 founding bonus for each of the first 3 paid billing cycles</strong></li>':'<li>2,000 paid units added each billing cycle</li>'}<li>Unused paid units roll over while subscribed</li><li>No fixed link-count limit</li><li>No plan-specific video length limit</li><li>4 concurrent jobs</li></ul>${actions==='public'?`<div class="actions"><a class="btn secondary" href="/start?from=pricing">Start free first</a></div>`:actions==='checkout'?`<form id="checkout-pro" method="post" action="/billing/checkout">${csrfField(req.headers.cookie)}<input type="hidden" name="plan" value="pro"><input type="hidden" name="resume_job_id" value="${esc(resume)}"><button>Choose Pro</button></form>`:''}</div></div><details class="usage-details"><summary><strong>What does 1 processing unit mean?</strong><span>1 started video minute · ~2,500 estimated text tokens · failed read = 0</span></summary><div class="usage-rule"><div><strong>Units depend on content size, not platform</strong>YouTube, TikTok, Instagram, X, Bluesky, GitHub, HN, PDFs and webpages follow the same video/text rules.</div><div><strong>Video</strong>0:01–1:00 = 1 unit · 1:01–2:00 = 2 units. Each started minute successfully processed counts as 1 unit.</div><div><strong>Text</strong>About 2,500 estimated tokens successfully returned to the AI = 1 unit. Successful reads use at least 1 unit.</div></div><div class="usage-examples"><div class="usage-example"><strong>1 unit</strong>30 sec Short / Reel / TikTok</div><div class="usage-example"><strong>5 units</strong>5 minute video</div><div class="usage-example"><strong>2 units</strong>~5,000 estimated text tokens</div><div class="usage-example"><strong>0 units</strong>Failed / unsupported / inaccessible read</div></div><p class="plan-note"><strong>Rollover:</strong> unused paid subscription units stay in your account while your paid subscription is active. Founding bonus is promotional, resets each billing cycle, and does not roll over. Text token counts are deterministic estimates used for billing, not the host AI’s exact tokenizer.</p></details>`;
    if(!user){
      return reply.type('text/html').send(page(`${topbar()}<section class="hero"><span class="eyebrow">Pricing</span><div class="pricing-intro"><h1>Try the link your AI just failed to read.</h1><p class="muted">Start with 10 processing units, no card required. Basic and Pro add paid units each billing cycle, and unused paid units roll over while your paid subscription stays active.</p></div>${plans('public')}${topupConfigured()?topupInfo:''}<p class="plan-note">Supported public links only. There is no fixed link-count limit or plan-specific video-length cap on Basic or Pro; available processing units are the practical usage limit. Very long sources may still be subject to operational safety limits. Failed or unsupported reads use 0 processing units. Paid upgrades become available after you have successfully used the trial workflow once.</p></section>`,`${esc(env().PUBLIC_BRAND_NAME)} Pricing`));
    }
    if(!user.email)return reply.code(302).redirect(`/signup?return_to=${encodeURIComponent(returnUrl)}`);
    const usage=await getUsageSnapshot(user.id);
    if(usage.plan==='trial'&&!resume){
      const usageRows=await pool.query<{count:string}>("SELECT COUNT(*)::text count FROM usage_ledger WHERE user_id=$1",[user.id]);
      if(Number(usageRows.rows[0].count)===0){
        return reply.type('text/html').send(page(`${topbar(user.email)}<section class="hero"><span class="eyebrow">Your trial is ready</span><div class="pricing-intro"><h1>Use one real link first.</h1><p class="muted">Your account still has the free founding trial available. Connect LTA, process a supported public link, then come back here if you want more capacity.</p></div>${plans('public')}<div class="public-cta"><a class="btn primary" href="/connect">Connect and try a link →</a><a class="btn secondary" href="/account">Back to account</a></div></section>`,`${esc(env().PUBLIC_BRAND_NAME)} Pricing`));
      }
    }
    const topupEligible=await canPurchaseTopup(user.id);
    return reply.type('text/html').send(page(`${topbar(user.email)}<section class="hero"><span class="eyebrow">Upgrade</span><div class="pricing-intro"><h1>Pick based on processing capacity and concurrency — not content type or video length.</h1><p class="muted">Basic and Pro read the same supported content types. Pro mainly gives you more units each billing cycle and higher concurrency. Unused paid units roll over while your paid subscription stays active.</p></div>${plans('checkout')}<p class="plan-note">Only successfully processed content consumes usage. Unsupported, inaccessible, login-required, empty or failed reads use 0 processing units. You can manage or cancel a paid subscription from your account.</p></section>${topupEligible?topupSection(req.headers.cookie):''}`,`${esc(env().PUBLIC_BRAND_NAME)} Pricing`));
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

  app.post('/billing/topup',async(req,reply)=>{
    const user=await requireWebUser(req,reply,'/account'); if(!user)return;
    const b=req.body as any;
    if(!verifyCsrfToken(req.headers.cookie,String(b?.csrf??'')))return reply.code(403).type('text/html').send(page(`<h1>${esc(env().PUBLIC_BRAND_NAME)}</h1><p>This top-up action expired. Please try again.</p><p><a href="/account">Back</a></p>`));
    const pack:TopupPack=b?.pack==='1500'?'1500':'500';
    await trackWebsiteEvent(req,'topup_click','/account',{pack});
    await recordActivationEvent(user.id,'topup_click',{metadata:{pack}});
    try{return reply.redirect(await createTopupCheckoutSession(user.id,pack));}
    catch(e){
      logErrorEvent('billing_topup_start_error',e);
      return reply.code(400).type('text/html').send(page(`<h1>${esc(env().PUBLIC_BRAND_NAME)}</h1><p>Could not start the processing-unit checkout. Please try again from your account.</p><p><a href="/account">Back</a></p>`));
    }
  });

  app.get('/billing/topup/success',async(_req,reply)=>{
    return reply.type('text/html').send(page(`<h1>Top-up received.</h1><p>Your paid balance will update as soon as the signed payment webhook is processed.</p><p><strong>No automatic overage charges.</strong></p><script>setTimeout(()=>location.href='/account',1800)</script>`));
  });

  app.get('/billing/success',async(req,reply)=>{
    const q=req.query as any; const resume=q.resume_job_id?String(q.resume_job_id):null;
    return reply.type('text/html').send(page(`<h1>You're connected.</h1><p>Your subscription is being activated${resume?' and the link you were reading will resume automatically':''}.</p><p>You can return to ChatGPT or Claude.</p><script>setTimeout(()=>location.href='/account',2500)</script>`));
  });

  app.get('/account',async(req,reply)=>{
    const user=await requireWebUser(req,reply); if(!user)return;
    const usage=await getUsageSnapshot(user.id);
    const unitsUsed=usage.used_usage_units, unitsLimit=usage.limit_usage_units, unitsRemaining=usage.remaining_usage_units;
    const csrf=csrfField(req.headers.cookie);
    const legacyIdentity=!user.email?`<div class="legacy card"><h2>Finish your account</h2><p class="muted">Add an email and password so your usage and Claude connection follow you across devices.</p><a class="btn primary" href="/signup?return_to=%2Faccount">Add email account</a></div>`:'';
    const pct=unitsLimit>0?Math.min(100,Math.max(0,Math.round((unitsUsed/unitsLimit)*100))):0;
    const planLabel=usage.plan[0].toUpperCase()+usage.plan.slice(1);
    const renew=usage.period_end?`<p class="fine">Renews ${esc(new Date(usage.period_end).toLocaleDateString('en-US',{month:'short',day:'numeric'}))}</p>`:'';
    const trialActions=usage.plan==='trial'
      ? `<div class="actions"><a class="btn primary" href="/pricing">Upgrade to Basic</a><a class="btn secondary" href="/connect">Open setup</a></div>`
      : `<div class="actions"><form method="post" action="/billing/portal">${csrf}<button>Manage subscription</button></form><a class="btn secondary" href="/connect">Connection setup</a></div>`;
    const rolloverLine=usage.plan==='trial'?'':` Unused paid subscription and purchased top-up units persist while subscribed; the founding bonus does not.`;
    const topupEligible=await canPurchaseTopup(user.id);
    const lowThreshold=Math.max(5,Math.ceil(unitsLimit*.1));
    const quotaNotice=usage.quota_exempt?'':unitsRemaining<=0
      ? `<div class="account-alert"><div><strong>You are out of processing units.</strong><p>LTA will not charge or start another read until you add capacity. Failed and unsupported reads remain 0 units.</p></div><div class="actions">${topupEligible?'<a class="btn primary" href="#top-up">Add units</a>':'<a class="btn primary" href="/pricing">Choose a plan</a>'}</div></div>`
      : unitsRemaining<=lowThreshold
        ? `<div class="account-alert low"><div><strong>${unitsRemaining} processing units remaining.</strong><p>You can keep reading supported sources. Add capacity now if you do not want the next large source to stop.</p></div><div class="actions">${topupEligible?'<a class="btn primary" href="#top-up">Add units</a>':'<a class="btn primary" href="/pricing">View plans</a>'}</div></div>`
        : '';
    const apiKeys=await listApiKeys(user.id);
    const jobs=await pool.query<{id:string;platform:string;status:string;created_at:Date;completed_at:Date|null;error_code:string|null;usage_units:number|null}>(`
      SELECT j.id,j.platform,j.status,j.created_at,j.completed_at,j.error_code,c.usage_units
      FROM transcript_jobs j
      LEFT JOIN transcript_cache c ON c.id=j.transcript_cache_id
      WHERE j.user_id=$1
      ORDER BY j.created_at DESC
      LIMIT 20`,[user.id]);
    const keyRows=apiKeys.map(key=>`<div style="display:flex;justify-content:space-between;gap:14px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)"><div><strong>${esc(key.name)}</strong><div class="fine" style="margin:3px 0 0"><code>${esc(key.key_prefix)}••••••••</code> · created ${esc(new Date(key.created_at).toLocaleDateString())}${key.last_used_at?` · last used ${esc(new Date(key.last_used_at).toLocaleString())}`:''}</div></div><form method="post" action="/account/api-keys/revoke">${csrf}<input type="hidden" name="key_id" value="${esc(key.id)}"><button class="secondary" type="submit">Delete</button></form></div>`).join('')||'<div class="api-key-empty">No API keys.</div>';
    const jobRows=jobs.rows.map(job=>{const charged=job.status==='completed'?Number(job.usage_units??0):0;const result=job.status==='completed'?'Source returned':job.status==='failed'?'Read failed — 0 units':job.status==='waiting_quota'?'Waiting for units':'Processing';return `<tr><td style="padding:8px"><a href="/account/jobs/${esc(job.id)}"><code>${esc(job.id.slice(0,8))}…</code></a></td><td style="padding:8px">${esc(job.platform)}</td><td style="padding:8px">${esc(result)}</td><td style="padding:8px">${esc(charged)}</td><td style="padding:8px">${esc(new Date(job.created_at).toLocaleString())}</td></tr>`}).join('')||'<tr><td colspan="5" style="padding:8px">No reads yet.</td></tr>';
    const developerSection=`<section class="card"><h2>Developer API keys</h2><p class="muted">Generate a key for your app. The full key is shown once and cannot be viewed again.</p><form method="post" action="/account/api-keys" class="api-key-create"><div class="api-key-field"><label for="api-key-name">Key name</label><input id="api-key-name" name="name" maxlength="60" placeholder="Production" autocomplete="off"></div>${csrf}<button class="primary" type="submit">Generate API key</button></form><div class="api-key-list">${keyRows}</div></section><section class="card"><h2>Recent reads</h2><p class="muted">Only successfully returned source content uses processing units.</p><div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr><th style="text-align:left;padding:8px">Read</th><th style="text-align:left;padding:8px">Source</th><th style="text-align:left;padding:8px">Result</th><th style="text-align:left;padding:8px">Units charged</th><th style="text-align:left;padding:8px">Created</th></tr></thead><tbody>${jobRows}</tbody></table></div></section>`;
    return reply.type('text/html').send(page(`<div class="topbar"><div class="brand"><a href="/"><img src="/logo.svg" alt=""><span>${esc(env().PUBLIC_BRAND_NAME)}</span></a></div><div class="toplinks"><a href="/connect">How it works</a><a href="/sources">Sources</a><a href="/pricing">Pricing</a><a href="/developers">Developers</a></div>${user.email?`<div class="email">${esc(user.email)}</div>`:''}</div>${legacyIdentity}<section class="hero"><div class="planrow"><div><h1>${esc(planLabel)} account</h1><p class="muted">See your remaining capacity, add units, and review recent source reads.</p></div></div><div class="stats"><div class="stat"><strong>${usage.quota_exempt?'No charge':unitsRemaining}</strong><span>${usage.quota_exempt?'test account — billing disabled':'processing units available'}</span></div><div class="stat"><strong>${unitsUsed}</strong><span>${usage.quota_exempt?'recorded usage':usage.plan==='trial'?'trial units used (lifetime)':'units used this billing cycle'}</span></div><div class="stat"><strong>${esc(planLabel)}</strong><span>current plan · no fixed link-count cap</span></div></div><div class="progress" role="progressbar" aria-label="Processing units used" aria-valuemin="0" aria-valuemax="${unitsLimit}" aria-valuenow="${Math.min(unitsUsed,unitsLimit)}"><span style="width:${pct}%"></span></div>${quotaNotice}<p class="fine">Video uses 1 unit per started processed minute. Text uses about 1 unit per 2,500 estimated tokens successfully returned to the AI. Failed or unsupported reads use 0 units.${rolloverLine}</p>${renew}${trialActions}${topupEligible?`<div id="top-up">${topupSection(req.headers.cookie)}</div>`:''}${developerSection}<p class="fine">${esc(env().PUBLIC_BRAND_NAME)} keeps temporary media/audio only while processing. Source-context cache expires automatically.</p><div class="actions"><form method="post" action="/auth/logout">${csrf}<button class="secondary">Sign out</button></form></div></section>`));
  });

  app.post('/account/api-keys',async(req,reply)=>{
    const user=await requireWebUser(req,reply,'/account'); if(!user)return;
    const b=req.body as any;
    if(!verifyCsrfToken(req.headers.cookie,String(b?.csrf??'')))return reply.code(403).type('text/html').send(page('<h1>Request expired.</h1><p><a href="/account">Back to account</a></p>'));
    const created=await createApiKey(user.id,b?.name);
    return reply.header('Cache-Control','no-store, max-age=0').header('Pragma','no-cache').header('Referrer-Policy','no-referrer').type('text/html').send(page(`<section class="hero"><span class="eyebrow">Developer API</span><h1>API key generated.</h1><p class="muted">Copy it now. It will never be shown again.</p><div class="api-key-created"><div class="api-key-created-head"><strong>${esc(created.name)}</strong><button class="copy-api-key" type="button" id="copy-api-key">Copy once</button></div><code id="generated-api-key" data-api-key-id="${esc(created.id)}">${esc(created.key)}</code></div><div class="actions"><a class="btn secondary" href="/account">Back to account</a></div><script>(()=>{history.replaceState(null,'','/account');const button=document.getElementById('copy-api-key');const key=document.getElementById('generated-api-key');button?.addEventListener('click',async()=>{const value=key?.textContent||'';if(!value||button.disabled)return;try{await navigator.clipboard.writeText(value);const prefix=value.slice(0,18);if(key)key.textContent=prefix+'••••••••';button.textContent='Copied';button.disabled=true;}catch{button.textContent='Copy failed';}});})();</script></section>`,`${esc(env().PUBLIC_BRAND_NAME)} API key`));
  });

  app.post('/account/api-keys/revoke',async(req,reply)=>{
    const user=await requireWebUser(req,reply,'/account'); if(!user)return;
    const b=req.body as any;
    if(!verifyCsrfToken(req.headers.cookie,String(b?.csrf??'')))return reply.code(403).type('text/plain').send('Invalid request');
    await revokeApiKey(user.id,String(b?.key_id??''));
    return reply.redirect('/account');
  });

  app.get('/account/jobs/:jobId',async(req,reply)=>{
    const user=await requireWebUser(req,reply,'/account'); if(!user)return;
    const jobId=String((req.params as {jobId?:unknown}).jobId??'');
    const job=await pool.query<{id:string;platform:string;status:string;created_at:Date;completed_at:Date|null;error_code:string|null;retryable:boolean;source_url:string|null;normalized_url:string|null;duration_seconds:number|null;required_usage_units:number|null;usage_units:number|null;source:string|null;truncated:boolean|null;truncation_reason:string|null}>(`
      SELECT j.id,j.platform,j.status,j.created_at,j.completed_at,j.error_code,j.retryable,j.source_url,j.normalized_url,j.duration_seconds,j.required_usage_units,
             c.usage_units,c.source,c.truncated,c.truncation_reason
      FROM transcript_jobs j
      LEFT JOIN transcript_cache c ON c.id=j.transcript_cache_id
      WHERE j.id=$1 AND j.user_id=$2
      LIMIT 1`,[jobId,user.id]);
    if(!job.rowCount)return reply.code(404).type('text/html').send(page('<h1>Job not found.</h1><p><a href="/account">Back to account</a></p>'));
    const j=job.rows[0];
    const result=j.status==='completed'?'Source returned':j.status==='failed'?'Read failed':j.status==='waiting_quota'?'Waiting for more units':'Processing';
    const charged=j.status==='completed'?Number(j.usage_units??0):0;
    return reply.type('text/html').send(page(`<section class="hero"><h1>Source read</h1><div class="card"><p><strong>Result:</strong> ${esc(result)}</p><p><strong>Source:</strong> ${esc(j.platform)}</p><p><strong>Units charged:</strong> ${esc(charged)}</p><p><strong>Units required:</strong> ${esc(j.required_usage_units??'—')}</p><p><strong>Complete:</strong> ${j.truncated?'No — the source reported a limitation':'Yes'}</p><p><strong>Created:</strong> ${esc(new Date(j.created_at).toLocaleString())}</p><p><strong>Completed:</strong> ${esc(j.completed_at?new Date(j.completed_at).toLocaleString():'—')}</p><p><strong>URL:</strong> ${j.normalized_url?`<a href="${esc(j.normalized_url)}" target="_blank" rel="noopener">${esc(j.normalized_url)}</a>`:'No longer stored'}</p>${j.truncation_reason?'<p>This source could not be returned in full. Try the original public link or contact support with this read ID.</p>':''}</div><div class="actions"><a class="btn secondary" href="/account">Back to account</a></div></section>`));
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

