import { readFile } from 'node:fs/promises';
import { createMcpFastifyApp } from '@modelcontextprotocol/fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { registerAuthRoutes } from '../auth/routes.js';
import { registerBillingRoutes } from '../billing/routes.js';
import { authInfoFromBearer, userFromSessionCookie } from '../auth/service.js';
import { buildMcpServer } from '../mcp/server.js';
import { readinessIssues } from '../config/readiness.js';
import { publicHostAllowlist } from '../config/publicUrl.js';
import { getUsageSnapshot } from '../quota/service.js';

const allowedPublicHosts=publicHostAllowlist(env().PUBLIC_BASE_URL,[process.env.RAILWAY_PUBLIC_DOMAIN??'']);
const app=createMcpFastifyApp({host:'0.0.0.0',allowedHosts:allowedPublicHosts,allowedOrigins:allowedPublicHosts});

// Billing webhooks require the exact raw request bytes for signature verification.
app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json',{parseAs:'string'},(req,body,done)=>{
  const raw=String(body??'');
  if(req.url.startsWith('/billing/webhook'))return done(null,{__raw:raw});
  try{return done(null,raw?JSON.parse(raw):{});}catch(err){return done(err as Error,undefined);}
});
app.addContentTypeParser('application/x-www-form-urlencoded',{parseAs:'string'},(_req,body,done)=>{
  try{return done(null,Object.fromEntries(new URLSearchParams(String(body??''))));}catch(err){return done(err as Error,undefined);}
});

const mcpHandler=createMcpHandler(buildMcpServer);
const nodeMcp=toNodeHandler(mcpHandler,{onerror:(err)=>app.log.error(err)});

app.all('/mcp',async(request,reply)=>{
  const auth=await authInfoFromBearer(request.headers.authorization);
  if(!auth){
    reply.header('WWW-Authenticate',`Bearer resource_metadata="${env().PUBLIC_BASE_URL}/.well-known/oauth-protected-resource/mcp", scope="link2ai:read"`);
    return reply.code(401).send({error:'unauthorized',message:`Connect ${env().PUBLIC_BRAND_NAME} to continue.`});
  }
  // MCP's Node adapter forwards req.auth to ctx.http.authInfo.
  return nodeMcp(Object.assign(request.raw,{auth}),reply.raw,request.body);
});

app.get('/healthz',async(_req,reply)=>{
  return reply.send({ok:true,service:'link2ai-api',version:'1.0.0'});
});

app.get('/readyz',async(_req,reply)=>{
  try{await pool.query('SELECT 1');}catch{return reply.code(503).send({ready:false,issues:['database unavailable']});}
  const issues=readinessIssues('api');
  return issues.length?reply.code(503).send({ready:false,issues}):{ready:true,issues:[]};
});

app.get('/status',async(_req,reply)=>{
  let dbOk=false;
  try{await pool.query('SELECT 1');dbOk=true;}catch(e){app.log.error(e);}
  const status={ok:dbOk,timestamp:new Date().toISOString(),service:'link2ai-api',note:'Core API and database state only. Individual supported-link availability can vary with third-party platforms.'};
  return dbOk?reply.send(status):reply.code(503).send(status);
});

app.get('/.well-known/openai-apps-challenge',async(_req,reply)=>{
  const token=env().OPENAI_APPS_CHALLENGE?.trim();
  if(!token)return reply.code(404).type('text/plain').send('Not configured');
  return reply.type('text/plain').send(token);
});

app.get('/robots.txt',async(_req,reply)=>{
  return reply.type('text/plain').send(`User-agent: *
Allow: /
Disallow: /account
Disallow: /founder
Disallow: /login
Disallow: /auth/
Disallow: /oauth/
Disallow: /billing/
Sitemap: ${env().PUBLIC_BASE_URL}/sitemap.xml
`);
});

app.get('/sitemap.xml',async(_req,reply)=>{
  const baseUrl=env().PUBLIC_BASE_URL;
  const xml=`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${baseUrl}/</loc><priority>1.0</priority></url>
  <url><loc>${baseUrl}/connect</loc><priority>0.9</priority></url>
  <url><loc>${baseUrl}/pricing</loc><priority>0.9</priority></url>
  <url><loc>${baseUrl}/status</loc><priority>0.5</priority></url>
  <url><loc>${baseUrl}/support</loc><priority>0.8</priority></url>
  <url><loc>${baseUrl}/privacy</loc><priority>0.8</priority></url>
  <url><loc>${baseUrl}/terms</loc><priority>0.8</priority></url>
</urlset>`;
  return reply.type('application/xml').send(xml);
});

const siteCss=`:root{color-scheme:light;--ink:#17151f;--muted:#6f6a78;--line:rgba(44,39,55,.11);--paper:#fbfaf8;--card:#fff;--soft:#f4f1ec;--purple:#6f54e8;--purple2:#8d77ff;--orange:#ef9a62;--green:#158f67;--shadow:0 22px 70px rgba(39,31,64,.10)}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:radial-gradient(circle at 70% -10%,rgba(137,112,255,.16),transparent 34%),radial-gradient(circle at 8% 16%,rgba(244,157,99,.11),transparent 28%),var(--paper)}a{color:inherit}.wrap{max-width:1180px;margin:0 auto;padding:0 28px}nav{height:78px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);position:relative;z-index:20}.brand{display:flex;align-items:center;gap:10px;font-weight:900;letter-spacing:-.045em;font-size:21px;text-decoration:none}.brand img{width:32px;height:32px;border-radius:9px;box-shadow:0 6px 18px rgba(31,26,44,.14)}.navlinks{display:flex;gap:24px;align-items:center;font-size:14px;font-weight:650}.navlinks a{text-decoration:none;color:#4e4857}.btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;border-radius:999px;padding:13px 19px;background:#1c1922;color:#fff;text-decoration:none;font-weight:800;border:1px solid #1c1922;box-shadow:0 7px 18px rgba(28,25,34,.12);transition:transform .16s,box-shadow .16s}.btn:hover{transform:translateY(-1px);box-shadow:0 10px 25px rgba(28,25,34,.18)}.btn.purple{background:linear-gradient(135deg,var(--purple),var(--purple2));border-color:transparent}.btn.alt{background:rgba(255,255,255,.75);color:var(--ink);border-color:var(--line);box-shadow:none}.btn.sm{padding:10px 15px;font-size:13px}.hero{padding:82px 0 70px}.hero-grid{display:grid;grid-template-columns:1.04fr .96fr;gap:58px;align-items:center}.badge{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(111,84,232,.18);background:rgba(255,255,255,.72);backdrop-filter:blur(12px);border-radius:999px;padding:7px 11px;font-size:12px;font-weight:800;color:#5945b6}.badge-dot{width:7px;height:7px;border-radius:50%;background:var(--purple);box-shadow:0 0 0 5px rgba(111,84,232,.10)}.hero h1{font-size:clamp(52px,7vw,82px);line-height:.95;letter-spacing:-.068em;margin:19px 0 24px;max-width:760px}.hero h1 em{font-style:normal;background:linear-gradient(120deg,#6f54e8 20%,#a067ef 55%,#e38d63);-webkit-background-clip:text;background-clip:text;color:transparent}.hero p{font-size:20px;line-height:1.55;color:var(--muted);max-width:680px;margin:0}.actions{display:flex;gap:11px;flex-wrap:wrap;margin-top:30px}.micro{font-size:12px;color:#817a89;margin-top:15px;line-height:1.5}.platforms{display:flex;gap:8px;flex-wrap:wrap;margin-top:22px}.platform{display:inline-flex;align-items:center;gap:7px;padding:8px 11px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.72);font-size:12px;font-weight:750;color:#5e5867}.platform b{width:7px;height:7px;border-radius:2px;background:#1c1922}.demo{position:relative}.demo:before{content:"";position:absolute;inset:12% -5% -8% 8%;background:linear-gradient(135deg,rgba(111,84,232,.20),rgba(239,154,98,.18));filter:blur(48px);border-radius:50%;z-index:0}.demo-window{position:relative;z-index:1;background:rgba(255,255,255,.92);border:1px solid rgba(44,39,55,.12);border-radius:28px;box-shadow:var(--shadow);overflow:hidden}.window-top{height:48px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:7px;padding:0 17px;background:rgba(250,249,247,.82)}.window-dot{width:9px;height:9px;border-radius:50%;background:#d9d4df}.window-title{margin-left:8px;font-size:12px;font-weight:800;color:#655f6d}.chat{padding:24px;display:grid;gap:15px}.chat-row{max-width:86%;padding:13px 15px;border-radius:18px;font-size:13px;line-height:1.5}.chat-row.user{justify-self:end;background:#1f1b25;color:#fff;border-bottom-right-radius:6px}.chat-row.ai{justify-self:start;background:#f2eff7;color:#453f4c;border-bottom-left-radius:6px}.tool-card{justify-self:start;width:88%;border:1px solid rgba(111,84,232,.16);background:linear-gradient(180deg,#fff,#faf8ff);border-radius:17px;padding:13px 14px}.tool-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.tool-name{display:flex;align-items:center;gap:9px;font-size:12px;font-weight:850}.tool-icon{width:28px;height:28px;border-radius:9px;background:#1c1922;color:#fff;display:grid;place-items:center;font-size:12px}.tool-state{font-size:10px;font-weight:800;color:var(--green);background:#eaf8f2;padding:5px 8px;border-radius:999px}.tool-line{height:7px;border-radius:8px;background:#ebe7f0;margin-top:10px}.tool-line.w82{width:82%}.tool-line.w57{width:57%}.section{padding:84px 0;border-top:1px solid var(--line)}.section-head{display:flex;justify-content:space-between;gap:30px;align-items:end;margin-bottom:32px}.section h2{font-size:44px;line-height:1.04;letter-spacing:-.055em;margin:0}.section .sub{color:var(--muted);font-size:17px;max-width:610px;line-height:1.6;margin:0}.feature-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:15px}.card{border:1px solid var(--line);border-radius:24px;padding:25px;background:rgba(255,255,255,.80);box-shadow:0 9px 30px rgba(31,26,44,.035)}.card .kicker{font-size:11px;text-transform:uppercase;letter-spacing:.12em;font-weight:900;color:#8a8292;margin-bottom:16px}.card h3{margin:0 0 10px;font-size:20px;letter-spacing:-.025em}.card p{margin:0;color:var(--muted);line-height:1.6}.workflow{display:grid;grid-template-columns:1fr 50px 1fr 50px 1fr;align-items:center;margin-top:28px}.flow-box{min-height:164px;border:1px solid var(--line);border-radius:24px;background:#fff;padding:22px;box-shadow:0 10px 30px rgba(31,26,44,.04)}.flow-num{width:30px;height:30px;border-radius:10px;background:#1c1922;color:#fff;display:grid;place-items:center;font-size:12px;font-weight:900;margin-bottom:18px}.flow-box h3{font-size:19px;margin:0 0 8px}.flow-box p{color:var(--muted);font-size:14px;line-height:1.55;margin:0}.flow-arrow{text-align:center;color:#aca5b4;font-size:26px}.pricing{display:grid;grid-template-columns:.86fr 1.08fr 1fr;gap:15px;margin-top:30px}.price-card{position:relative;border:1px solid var(--line);border-radius:25px;padding:26px;background:#fff}.price-card.featured{border-color:rgba(111,84,232,.35);box-shadow:0 20px 60px rgba(111,84,232,.10);background:linear-gradient(180deg,#fff,#fbf9ff)}.price-badge{position:absolute;right:18px;top:18px;background:#ede9ff;color:#5c46c4;border-radius:999px;padding:6px 9px;font-size:10px;font-weight:900}.price-name{font-size:14px;font-weight:850;color:#5f5967}.price{font-size:39px;font-weight:900;letter-spacing:-.055em;margin:12px 0}.price small{font-size:13px;color:var(--muted);font-weight:600;letter-spacing:0}.list{list-style:none;margin:17px 0 0;padding:0;color:var(--muted);line-height:1.9;font-size:14px}.list li:before{content:"✓";color:var(--green);font-weight:900;margin-right:9px}.faq{display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-top:30px}.faq .card h3{font-size:17px}.connect-hero{padding:72px 0 34px;text-align:center;max-width:850px;margin:0 auto}.connect-hero h1{font-size:clamp(46px,7vw,72px);line-height:.98;letter-spacing:-.06em;margin:18px 0}.connect-hero p{font-size:19px;color:var(--muted);line-height:1.55;max-width:690px;margin:0 auto}.setup-shell{max-width:850px;margin:0 auto 78px}.setup-main{border:1px solid rgba(111,84,232,.22);border-radius:30px;background:linear-gradient(145deg,#fff 0,#fbf9ff 60%,#fff8f3 100%);padding:34px;box-shadow:var(--shadow)}.setup-main h2{font-size:29px;letter-spacing:-.04em;margin:0 0 9px}.setup-main>p{color:var(--muted);line-height:1.55;margin:0}.setup-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:26px 0}.setup-step{background:rgba(255,255,255,.8);border:1px solid var(--line);border-radius:16px;padding:14px}.setup-step span{display:block;font-size:10px;color:#8c8494;font-weight:900;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}.setup-step strong{font-size:14px;line-height:1.35}.setup-cta{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.setup-note{font-size:12px;color:#817a89}.manual{margin-top:18px;border-top:1px solid var(--line);padding-top:18px}details summary{cursor:pointer;font-weight:800;color:#5b5563}.manual-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:13px}.field{background:#fff;border:1px solid var(--line);border-radius:13px;padding:12px}.field label{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:#8d8595;font-weight:900;margin-bottom:7px}.field code{font-size:11px;overflow-wrap:anywhere}.copybtn{margin-top:8px;border:1px solid var(--line);background:#fff;border-radius:10px;padding:8px 10px;font-size:11px;font-weight:800;cursor:pointer}.coming{margin-top:18px;border:1px dashed rgba(44,39,55,.20);border-radius:20px;padding:18px;display:flex;justify-content:space-between;gap:18px;align-items:center}.coming strong{display:block}.coming span{font-size:13px;color:var(--muted)}footer{padding:34px 0 48px;color:#827b8a;font-size:13px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}.legal-links a{text-decoration:none}.support-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:15px;margin-bottom:70px}.guide-grid{display:grid;gap:18px;margin-top:28px}.guide-card{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(280px,.95fr);gap:24px;align-items:center;border:1px solid var(--line);border-radius:26px;background:rgba(255,255,255,.88);padding:22px;box-shadow:0 12px 38px rgba(31,26,44,.05)}.guide-card.reverse{grid-template-columns:minmax(280px,.95fr) minmax(0,1.05fr)}.guide-card h3{font-size:22px;letter-spacing:-.035em;margin:0 0 9px}.guide-card p{color:var(--muted);line-height:1.6;margin:0}.guide-num{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:11px;background:#1c1922;color:#fff;font-size:12px;font-weight:900;margin-bottom:14px}.guide-shot{position:relative;border:1px solid var(--line);border-radius:18px;overflow:hidden;background:#f6f4f8;box-shadow:0 12px 35px rgba(31,26,44,.08)}.guide-shot img{display:block;width:100%;height:auto}.guide-callout{position:absolute;border:3px solid #7d63ef;border-radius:14px;box-shadow:0 0 0 9999px rgba(19,16,25,.05),0 0 0 5px rgba(125,99,239,.12);pointer-events:none}.guide-callout.oauth{left:4.5%;right:4.5%;top:50.5%;height:12.5%}.guide-callout.allow{right:1.7%;top:26.8%;width:16.5%;height:17.5%}.guide-callout.tools{right:0.8%;top:35%;width:34.7%;height:34%}.tiny-pill{display:inline-flex;align-items:center;gap:7px;background:#f0ecff;color:#5e49c4;border-radius:999px;padding:7px 10px;font-size:11px;font-weight:850;margin-top:13px}.why-write{margin-top:18px;padding:15px 16px;border-radius:16px;background:#f8f6fb;border:1px solid var(--line);font-size:13px;color:#655f6d;line-height:1.55}.why-write strong{color:#302b36}.troubleshoot{margin-top:24px;border:1px dashed rgba(44,39,55,.2);border-radius:20px;padding:18px;background:rgba(255,255,255,.55)}.troubleshoot h3{margin:0 0 8px;font-size:18px}.troubleshoot p{margin:0;color:var(--muted);line-height:1.55}.guide-status{display:flex;gap:8px;flex-wrap:wrap;margin:17px 0 0}.guide-status span{font-size:11px;font-weight:800;padding:7px 10px;border-radius:999px;background:#eef8f4;color:#147c5b;border:1px solid rgba(20,124,91,.12)}@media(max-width:900px){.guide-card,.guide-card.reverse{grid-template-columns:1fr}.guide-card.reverse .guide-copy{order:1}.guide-card.reverse .guide-shot{order:2}.hero-grid{grid-template-columns:1fr;gap:40px}.hero{padding-top:60px}.demo{max-width:650px}.workflow{grid-template-columns:1fr}.flow-arrow{transform:rotate(90deg);padding:4px}.pricing{grid-template-columns:1fr}.feature-grid,.support-grid{grid-template-columns:1fr}.setup-steps{grid-template-columns:1fr 1fr}}@media(max-width:650px){html,body{max-width:100%;overflow-x:hidden}.wrap{padding:0 16px;width:100%}nav{height:68px;gap:10px}.brand{font-size:19px;min-width:0}.brand img{width:30px;height:30px}.navlinks{gap:8px;flex:0 0 auto}.navlinks a.hide-sm{display:none}.navlinks>a:not(.btn){display:none}.navlinks .btn{min-height:44px;padding:10px 14px;font-size:12px;white-space:nowrap}.hero{padding:42px 0 52px}.hero-grid{gap:30px}.hero h1{font-size:clamp(40px,12vw,50px);line-height:.98;letter-spacing:-.058em;margin:16px 0 18px}.hero p{font-size:16px;line-height:1.55}.actions{display:grid;grid-template-columns:1fr;gap:10px;margin-top:24px}.actions .btn{width:100%;min-height:48px}.platforms{gap:7px}.platform{font-size:11px}.demo{width:100%;max-width:100%}.demo-window{border-radius:22px}.chat{padding:16px;gap:12px}.chat-row{max-width:94%;font-size:12px;padding:11px 13px}.tool-card{width:96%;padding:12px}.section{padding:56px 0}.section-head{display:block;margin-bottom:24px}.section h2{font-size:34px;margin-bottom:12px;letter-spacing:-.045em}.section .sub{font-size:15px}.feature-grid,.faq{grid-template-columns:1fr}.card,.price-card,.flow-box{border-radius:20px;padding:20px}.pricing{gap:12px}.price{font-size:36px}.setup-shell{margin-bottom:54px}.setup-main{padding:19px;border-radius:23px}.setup-main h2{font-size:25px}.setup-steps,.manual-grid{grid-template-columns:1fr}.setup-step{padding:13px}.setup-cta{display:grid;grid-template-columns:1fr;gap:9px}.setup-cta .btn{width:100%;min-height:48px}.connect-hero{padding:44px 0 28px;text-align:left}.connect-hero h1{font-size:clamp(38px,11vw,48px);line-height:1}.connect-hero p{font-size:16px;margin-left:0}.guide-grid{gap:14px}.guide-card,.guide-card.reverse{padding:15px;border-radius:20px;gap:16px}.guide-card h3{font-size:19px}.guide-shot{border-radius:14px}.manual{margin-top:15px;padding-top:15px}.field code{font-size:10px}.copybtn{min-height:42px}.coming{display:block;padding:15px;border-radius:17px}.coming .btn{margin-top:13px;width:100%;min-height:46px}.support-grid{margin-bottom:54px}footer{padding:28px 0 34px;display:grid;gap:10px}.legal-links{line-height:1.8}details summary{line-height:1.4}}
@media(max-width:380px){.wrap{padding:0 13px}.brand span{max-width:105px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.navlinks .btn{padding:9px 11px}.hero h1{font-size:38px}.section h2{font-size:31px}.connect-hero h1{font-size:37px}.setup-main{padding:16px}.card,.price-card,.flow-box{padding:17px}}`;
function claudeInstallUrl(){const u=new URL('https://claude.ai/customize/connectors');u.searchParams.set('modal','add-custom-connector');u.searchParams.set('connectorName',env().PUBLIC_BRAND_NAME);u.searchParams.set('connectorUrl',`${env().PUBLIC_BASE_URL}/mcp`);return u.toString();}
function siteShell(body:string,title=env().PUBLIC_BRAND_NAME){const supportEmail=env().SUPPORT_EMAIL?.trim();return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${title}</title><meta name="description" content="Paste a link into Claude. Link2AI supplies the missing content only when Claude needs it."><link rel="icon" href="/logo.svg"><style>${siteCss}</style></head><body><div class="wrap"><nav><a class="brand" href="/"><img src="/logo.svg" alt=""><span>${env().PUBLIC_BRAND_NAME}</span></a><div class="navlinks"><a class="hide-sm" href="/#how">How it works</a><a class="hide-sm" href="/pricing">Pricing</a><a class="hide-sm" href="/support">Support</a><a class="btn sm purple" href="/connect">Add to Claude</a></div></nav>${body}<footer><span>© 2026 ${env().PUBLIC_BRAND_NAME}</span><span class="legal-links"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/status">Status</a> · <a href="/account">Account</a>${supportEmail?` · <a href="mailto:${supportEmail}">Support: ${supportEmail}</a>`:''}</span></footer></div></body></html>`;}

app.get('/',async(_req,reply)=>reply.type('text/html').send(siteShell(`<main><section class="hero"><div class="hero-grid"><div><span class="badge"><span class="badge-dot"></span>Claude-first founding beta · ChatGPT next</span><h1>Paste the link.<br><em>Claude can read it.</em></h1><p>${env().PUBLIC_BRAND_NAME} gives Claude the spoken and caption content behind supported public YouTube, TikTok and Instagram links when Claude cannot reliably access it on its own.</p><div class="actions"><a class="btn purple" href="/connect">Add ${env().PUBLIC_BRAND_NAME} to Claude →</a><a class="btn alt" href="/#how">See how it works</a></div><div class="micro">3 successful links or 10 minutes free · Email account · No card · Failed processing does not consume completed-job quota</div><div class="platforms"><span class="platform"><b></b>YouTube</span><span class="platform"><b></b>YouTube Shorts</span><span class="platform"><b></b>Instagram Reels</span><span class="platform"><b></b>TikTok</span></div></div><div class="demo"><div class="demo-window"><div class="window-top"><span class="window-dot"></span><span class="window-dot"></span><span class="window-dot"></span><span class="window-title">Claude</span></div><div class="chat"><div class="chat-row user">https://instagram.com/reel/…<br>What is this actually saying?</div><div class="tool-card"><div class="tool-head"><div class="tool-name"><span class="tool-icon">↗</span>Read link content</div><span class="tool-state">ready</span></div><div class="tool-line w82"></div><div class="tool-line w57"></div></div><div class="chat-row ai">The speaker’s main point is that…</div></div></div></div></div></section><section class="section" id="how"><div class="section-head"><div><h2>Your chat stays in Claude.</h2></div><p class="sub">${env().PUBLIC_BRAND_NAME} is not another transcript website. It stays behind the scenes and only steps in when your question actually depends on content Claude cannot already read.</p></div><div class="workflow"><div class="flow-box"><div class="flow-num">1</div><h3>Paste a normal link</h3><p>No special prompt. No upload. Ask the question you wanted to ask anyway.</p></div><div class="flow-arrow">→</div><div class="flow-box"><div class="flow-num">2</div><h3>Claude decides when it needs help</h3><p>If Claude already has enough context, ${env().PUBLIC_BRAND_NAME} stays out of the way.</p></div><div class="flow-arrow">→</div><div class="flow-box"><div class="flow-num">3</div><h3>Claude answers from the content</h3><p>${env().PUBLIC_BRAND_NAME} supplies transcript context; Claude still does the reasoning and response.</p></div></div></section><section class="section"><div class="section-head"><h2>Built for the part that usually breaks.</h2><p class="sub">The value is simple: links that stop the conversation should become usable context without changing how you chat.</p></div><div class="feature-grid"><div class="card"><div class="kicker">Only when needed</div><h3>Not every URL triggers it.</h3><p>The tool description tells Claude to call ${env().PUBLIC_BRAND_NAME} only when the answer depends on content behind a supported public link and Claude does not already have enough access.</p></div><div class="card"><div class="kicker">Caption first · ASR fallback</div><h3>Use the fastest reliable path.</h3><p>When captions are available, use them. When they are not, ${env().PUBLIC_BRAND_NAME} can extract audio and transcribe it.</p></div><div class="card"><div class="kicker">Quota-safe</div><h3>Failures should not burn usage.</h3><p>Usage is finalized only on successful processing. Unsupported, private or failed links do not count as completed jobs.</p></div></div></section><section class="section"><div class="section-head"><h2>Start free. Pay only if it earns a place in your workflow.</h2><p class="sub">The founding beta is intentionally small: prove that the link-reading experience is useful first.</p></div><div class="pricing"><div class="price-card"><div class="price-name">Trial</div><div class="price">$0</div><ul class="list"><li>3 successful links</li><li>or 10 minutes of content</li><li>No card required</li></ul></div><div class="price-card featured"><span class="price-badge">Most useful</span><div class="price-name">Basic</div><div class="price">$4.99 <small>/ month</small></div><ul class="list"><li>500 content minutes / month</li><li>Up to 30 minutes per link</li><li>2 concurrent jobs</li></ul></div><div class="price-card"><div class="price-name">Pro</div><div class="price">$9.99 <small>/ month</small></div><ul class="list"><li>2,000 content minutes / month</li><li>Up to 120 minutes per link</li><li>4 concurrent jobs</li></ul></div></div></section><section class="section"><div class="section-head"><h2>Questions people should not have to guess.</h2></div><div class="faq"><div class="card"><h3>Does ${env().PUBLIC_BRAND_NAME} run on every link?</h3><p>No. Claude should use it only when your request depends on content behind a supported link that Claude cannot already access sufficiently.</p></div><div class="card"><h3>Does ${env().PUBLIC_BRAND_NAME} answer the question?</h3><p>No. It supplies AI-readable source context. Claude remains the interface and produces the answer.</p></div><div class="card"><h3>What links are supported?</h3><p>V1 focuses on supported public YouTube, YouTube Shorts, TikTok and Instagram Reel links. Private, deleted, login-only, paid/DRM or restricted content may fail.</p></div><div class="card"><h3>What about ChatGPT?</h3><p>ChatGPT remains a first-class target, but the founding beta is launching on Claude first so we can test demand and onboarding with real users before widening distribution.</p></div></div><div class="actions" style="margin-top:30px"><a class="btn purple" href="/connect">Add to Claude →</a></div></section></main>`)));

app.get('/connect',async(_req,reply)=>{const install=claudeInstallUrl().replace(/&/g,'&amp;');return reply.type('text/html').send(siteShell(`<main><section class="connect-hero"><span class="badge"><span class="badge-dot"></span>Claude-first beta</span><h1>Install once. Then just paste links.</h1><p>You do not need to understand MCP, OAuth, client IDs or API keys. Follow the four steps below and Claude can call ${env().PUBLIC_BRAND_NAME} when it actually needs the content behind a supported link.</p><div class="guide-status"><span>Email account</span><span>No card</span><span>No client secret</span></div></section><section class="setup-shell"><div class="setup-main"><h2>Start with the pre-filled setup.</h2><p>Open Claude on web or desktop. The name and server URL should already be filled in.</p><div class="setup-cta"><a class="btn purple" id="claude-install" href="${install}" target="_blank" rel="noopener">Open Claude setup →</a><span class="setup-note" id="connect-state">Keep this tab open while you finish setup in Claude. When the connection completes, this page will automatically become your usage dashboard.</span></div><div class="guide-grid"><div class="guide-card"><div class="guide-copy"><span class="guide-num">1</span><h3>Confirm Link2AI and press Continue.</h3><p>The warning only means this custom connector came from an external link. Verify the name is <strong>${env().PUBLIC_BRAND_NAME}</strong> and the URL ends in <strong>/mcp</strong>, then continue.</p><span class="tiny-pill">Keep “Sign in now”</span></div><div class="guide-shot"><img src="/guide/claude-add-connector.png" alt="Claude Add custom connector screen with Link2AI pre-filled"></div></div><div class="guide-card reverse"><div class="guide-shot"><img src="/guide/claude-oauth.png" alt="Claude OAuth client options"><span class="guide-callout oauth"></span></div><div class="guide-copy"><span class="guide-num">2</span><h3>Choose “Register automatically”.</h3><p>Under <strong>OAuth client</strong>, choose <strong>Register automatically</strong>, then press <strong>Add</strong>. Do not choose “Use Claude’s published identity” for this beta, and do not enter a client ID or secret.</p><span class="tiny-pill">This is the DCR path</span></div></div><div class="guide-card"><div class="guide-copy"><span class="guide-num">3</span><h3>Sign in to Link2AI and return to Claude.</h3><p>Create or sign in to your <strong>${env().PUBLIC_BRAND_NAME}</strong> account with email and password. The same account keeps your trial, usage and paid plan attached to you across browsers and devices. Claude then finishes the OAuth connection automatically.</p><p class="micro">Trial: 3 successful links or 10 minutes of content, whichever comes first. Failed processing does not count as a completed job.</p></div><div class="guide-shot" style="min-height:280px;display:grid;place-items:center;padding:28px"><div style="max-width:360px;width:100%;background:white;border:1px solid var(--line);border-radius:20px;padding:26px;box-shadow:0 16px 45px rgba(31,26,44,.08)"><span class="badge"><span class="badge-dot"></span>Free founding trial</span><h3 style="font-size:27px;margin:18px 0 9px">One account, then back to Claude.</h3><p style="color:var(--muted);line-height:1.55">Email + password. No card required for the free trial.</p><span class="btn purple" style="width:100%;margin-top:10px">Create account / Sign in</span></div></div></div><div class="guide-card reverse"><div class="guide-shot"><img src="/guide/claude-tool-access.png" alt="Claude Tool access menu with Tools already loaded selected"><span class="guide-callout tools"></span></div><div class="guide-copy"><span class="guide-num">4</span><h3>Set Tool access to “Tools already loaded”.</h3><p>Claude currently defaults to <strong>Load tools when needed</strong>. For Link2AI’s normal “paste a link and ask” flow, switch this once: <strong>+ → Connectors → Tool access → Tools already loaded</strong>.</p><p class="micro">This is a Claude setting. Link2AI cannot change it remotely. If you leave the default on, Claude may answer that it cannot read the video without ever loading Link2AI.</p><span class="tiny-pill">Required once for reliable auto-use</span></div></div></div><div class="why-write"><strong>Why Claude may label “Read link content” as a write/delete tool:</strong> starting a read creates a Link2AI processing job and reserves usage quota. It does <strong>not</strong> edit or delete the Instagram, TikTok, YouTube link, your Claude chats, or your files.</div><div class="manual"><details><summary>Optional: make future link reads more hands-off</summary><div class="guide-card reverse" style="margin-top:15px"><div class="guide-shot"><img src="/guide/claude-permissions.png" alt="Claude Link2AI tool permissions"><span class="guide-callout allow"></span></div><div class="guide-copy"><h3>Permission behavior can vary by Claude session.</h3><p>If Claude asks before using <strong>Read link content</strong>, choose <strong>Always allow</strong> if you do not want to approve every link. If Claude does not show a permission popup, you do not need to hunt for one.</p></div></div></details></div><div class="manual"><details><summary>If the pre-filled button does not work, use the manual fallback</summary><div class="manual-grid"><div class="field"><label>Name</label><code>${env().PUBLIC_BRAND_NAME}</code></div><div class="field"><label>Remote MCP server URL</label><code id="mcp-address">${env().PUBLIC_BASE_URL}/mcp</code><button class="copybtn" type="button" onclick="navigator.clipboard.writeText('${env().PUBLIC_BASE_URL}/mcp').then(()=>this.textContent='Copied ✓')">Copy URL</button></div></div><p class="micro">Authentication: <strong>Sign in now</strong>. OAuth client: <strong>Register automatically</strong>. Leave client secret blank.</p></details></div></div><div id="setup-complete" hidden class="coming" style="margin-bottom:16px"><div><strong>Connected ✓ Finish the one-time Tool access setting.</strong><span>In Claude choose <strong>+ → Connectors → Tool access → Tools already loaded</strong>. After that, Link2AI can be available for natural link-only prompts.</span></div><a class="btn purple sm" href="/account">Done → Dashboard</a></div><div class="coming"><div><strong>Then use Claude normally.</strong><span>Paste a supported public link and ask your real question. You should not need to say “use Link2AI”. Claude decides whether it needs the connector.</span></div><a class="btn alt sm" href="/support">Need help?</a></div><p class="micro" style="margin-top:18px">V1 reads spoken and caption text. Visual-only information such as on-screen text/layout, gestures, diagrams and before/after pairings may not be available yet.</p></section><script>(()=>{const button=document.getElementById('claude-install');const state=document.getElementById('connect-state');let since=Number(sessionStorage.getItem('link2ai_connect_started')||0);let timer=null;const check=async()=>{if(!since)return;try{const response=await fetch('/api/connect/status?since='+encodeURIComponent(String(since)),{cache:'no-store',credentials:'same-origin'});if(!response.ok)return;const data=await response.json();if(data.connected){if(state)state.textContent='Connected ✓ One last Claude setting: + → Connectors → Tool access → Tools already loaded. Then open your dashboard.';clearInterval(timer);const done=document.getElementById('setup-complete');if(done)done.hidden=false;return;}if(data.authenticated&&state)state.textContent='Signed in. Finish the last Claude authorization step — this page will switch to your dashboard automatically.';}catch{}};button?.addEventListener('click',()=>{since=Date.now();sessionStorage.setItem('link2ai_connect_started',String(since));if(state)state.textContent='Claude opened in a new tab. Finish setup there; keep this page open and it will switch to your dashboard when connected.';clearInterval(timer);timer=setInterval(check,1500);setTimeout(check,500);});if(since){timer=setInterval(check,1500);check();}})();</script></main>`, `Add ${env().PUBLIC_BRAND_NAME} to Claude`));});

app.get('/api/connect/status',async(req,reply)=>{
  const user=await userFromSessionCookie(req.headers.cookie);
  if(!user)return reply.send({authenticated:false,connected:false});
  const q=req.query as {since?:string};
  const rawSince=Number(q?.since??0);
  const since=Number.isFinite(rawSince)&&rawSince>0?new Date(rawSince):new Date(Date.now());
  const r=await pool.query<{connected:boolean}>(
    `SELECT (
       EXISTS(SELECT 1 FROM oauth_access_tokens WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() AND created_at>$2)
       OR EXISTS(SELECT 1 FROM oauth_refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() AND created_at>$2)
     ) AS connected`,
    [user.id,since]
  );
  return reply.send({authenticated:true,connected:Boolean(r.rows[0]?.connected)});
});


function founderEscape(value:unknown):string{
  return String(value??'').replace(/[&<>\"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"}[ch]??ch));
}
function founderTime(value:unknown):string{
  if(!value)return '—';
  const d=new Date(String(value));
  if(Number.isNaN(d.getTime()))return '—';
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
}
function founderNum(value:unknown):number{return Number(value??0)||0;}
function founderPct(part:number,total:number):string{return total>0?`${Math.round((part/total)*100)}%`:'0%';}
function founderMinutes(seconds:unknown):string{
  const n=founderNum(seconds)/60;
  return n>=100?`${Math.round(n)}`:n.toFixed(n>=10?1:2).replace(/\\.00$/,'').replace(/(\\.\\d)0$/,'$1');
}
function founderOriginOk(req:{headers:Record<string,string|string[]|undefined>}):boolean{
  let expected:string;
  try{expected=new URL(env().PUBLIC_BASE_URL).origin;}catch{return false;}
  const origin=Array.isArray(req.headers.origin)?req.headers.origin[0]:req.headers.origin;
  if(origin)return origin===expected;
  const referer=Array.isArray(req.headers.referer)?req.headers.referer[0]:req.headers.referer;
  if(!referer)return false;
  try{return new URL(referer).origin===expected;}catch{return false;}
}
async function founderUser(req:{headers:{cookie?:string}}){
  const founderEmail=env().FOUNDER_EMAIL?.trim().toLowerCase();
  if(!founderEmail)return null;
  const user=await userFromSessionCookie(req.headers.cookie);
  if(!user||(user.email??'').trim().toLowerCase()!==founderEmail)return null;
  return user;
}
function founderCss(){return `<style>
  .fd{padding:48px 0 76px}.fd-head{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:22px}.fd h1{font-size:clamp(38px,6vw,62px);letter-spacing:-.055em;line-height:1;margin:12px 0 8px}.fd-sub{color:var(--muted);margin:0}.fd-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.fd-card{background:rgba(255,255,255,.88);border:1px solid var(--line);border-radius:20px;padding:18px;box-shadow:0 9px 28px rgba(31,26,44,.035)}.fd-label{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:#817a89;font-weight:900}.fd-value{font-size:34px;font-weight:900;letter-spacing:-.05em;margin-top:8px}.fd-note{font-size:12px;color:var(--muted);margin-top:6px}.fd-funnel{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0 24px}.fd-step{padding:14px;border-radius:16px;border:1px solid var(--line);background:#fff}.fd-step b{display:block;font-size:20px}.fd-step span{font-size:11px;color:var(--muted)}.fd-panel{margin-top:14px;border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.88);overflow:hidden}.fd-panel-head{padding:17px 19px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.fd-panel-head h2{font-size:18px;margin:0}.fd-scroll{overflow:auto}.fd-table{width:100%;border-collapse:collapse;font-size:12px;min-width:900px}.fd-table th,.fd-table td{text-align:left;padding:11px 14px;border-bottom:1px solid rgba(44,39,55,.07);white-space:nowrap}.fd-table th{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#817a89;background:#fbfafc}.fd-table a{font-weight:800}.fd-status{font-size:10px;font-weight:900;border-radius:999px;padding:4px 7px;display:inline-block}.fd-status.ok{color:#117557;background:#e8f7f1}.fd-status.bad{color:#a33b3b;background:#fdeeee}.fd-status.wait{color:#785d18;background:#fff6dc}.fd-chips{display:flex;flex-wrap:wrap;gap:8px}.fd-chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:7px 10px;font-size:11px;font-weight:800}.fd-private{font-size:11px;color:#817a89;margin-top:16px}.fd-warning{border:1px dashed rgba(44,39,55,.18);padding:12px 14px;border-radius:14px;color:var(--muted);font-size:12px;margin-top:14px}.fd-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.fd-input,.fd-select{border:1px solid var(--line);background:#fff;border-radius:12px;padding:10px 12px;font:inherit;color:var(--ink);min-height:42px}.fd-input{min-width:240px}.fd-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.fd-field{display:grid;gap:6px}.fd-field label{font-size:11px;font-weight:850;color:#6e6877}.fd-field small{color:var(--muted);font-size:11px;line-height:1.4}.fd-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.fd-kv{display:grid;grid-template-columns:170px 1fr;gap:8px 16px;font-size:13px}.fd-kv b{color:#615a69}.fd-nav{display:flex;gap:8px;align-items:center}.fd-muted{color:var(--muted)}.fd-email{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.fd-okflash{padding:10px 12px;border-radius:12px;background:#e8f7f1;color:#117557;font-size:12px;font-weight:800;margin:12px 0}.fd-badflash{padding:10px 12px;border-radius:12px;background:#fdeeee;color:#a33b3b;font-size:12px;font-weight:800;margin:12px 0}
  @media(max-width:760px){.fd{padding-top:32px}.fd-head{align-items:flex-start;flex-direction:column}.fd-grid{grid-template-columns:1fr 1fr}.fd-funnel{grid-template-columns:1fr 1fr}.fd-card{padding:15px}.fd-value{font-size:28px}.fd-form-grid{grid-template-columns:1fr}.fd-input{min-width:0;width:100%}.fd-kv{grid-template-columns:1fr}.fd-kv b{margin-top:6px}}
  @media(max-width:420px){.fd-grid{grid-template-columns:1fr}.fd-funnel{grid-template-columns:1fr 1fr}}
</style>`;}

app.get('/founder',async(req,reply)=>{
  const founderEmail=env().FOUNDER_EMAIL?.trim().toLowerCase();
  if(!founderEmail)return reply.code(404).type('text/plain').send('Not found');
  const founder=await userFromSessionCookie(req.headers.cookie);
  if(!founder)return reply.redirect('/login?return_to=%2Ffounder');
  if((founder.email??'').trim().toLowerCase()!==founderEmail)return reply.code(404).type('text/plain').send('Not found');

  const q=String((req.query as {q?:string})?.q??'').trim().slice(0,160);
  const rawPage=Number((req.query as {page?:string})?.page??1);
  const page=Number.isFinite(rawPage)?Math.max(1,Math.floor(rawPage)):1;
  const pageSize=100;
  const offset=(page-1)*pageSize;

  const [summaryResult,recentJobsResult,platformResult,accountsCountResult,accountsResult]=await Promise.all([
    pool.query<{
      accounts_total:string;accounts_24h:string;accounts_7d:string;connected_total:string;activated_total:string;
      paid_total:string;basic_total:string;pro_total:string;links_total:string;links_24h:string;links_7d:string;
      seconds_total:string;seconds_7d:string;failed_24h:string;failed_7d:string;
    }>(`SELECT
      (SELECT COUNT(*) FROM users WHERE email IS NOT NULL)::text AS accounts_total,
      (SELECT COUNT(*) FROM users WHERE email IS NOT NULL AND created_at>now()-interval '24 hours')::text AS accounts_24h,
      (SELECT COUNT(*) FROM users WHERE email IS NOT NULL AND created_at>now()-interval '7 days')::text AS accounts_7d,
      (SELECT COUNT(DISTINCT user_id) FROM (
        SELECT user_id FROM oauth_access_tokens WHERE revoked_at IS NULL AND expires_at>now()
        UNION SELECT user_id FROM oauth_refresh_tokens WHERE revoked_at IS NULL AND expires_at>now()
      ) connected)::text AS connected_total,
      (SELECT COUNT(DISTINCT user_id) FROM usage_ledger)::text AS activated_total,
      (SELECT COUNT(*) FROM users WHERE plan IN ('basic','pro') AND account_status='active')::text AS paid_total,
      (SELECT COUNT(*) FROM users WHERE plan='basic' AND account_status='active')::text AS basic_total,
      (SELECT COUNT(*) FROM users WHERE plan='pro' AND account_status='active')::text AS pro_total,
      (SELECT COUNT(*) FROM usage_ledger)::text AS links_total,
      (SELECT COUNT(*) FROM usage_ledger WHERE created_at>now()-interval '24 hours')::text AS links_24h,
      (SELECT COUNT(*) FROM usage_ledger WHERE created_at>now()-interval '7 days')::text AS links_7d,
      COALESCE((SELECT SUM(seconds) FROM usage_ledger),0)::text AS seconds_total,
      COALESCE((SELECT SUM(seconds) FROM usage_ledger WHERE created_at>now()-interval '7 days'),0)::text AS seconds_7d,
      (SELECT COUNT(*) FROM transcript_jobs WHERE status='failed' AND created_at>now()-interval '24 hours')::text AS failed_24h,
      (SELECT COUNT(*) FROM transcript_jobs WHERE status='failed' AND created_at>now()-interval '7 days')::text AS failed_7d`),
    pool.query<{user_id:string;email:string|null;platform:string;status:string;duration_seconds:number|null;error_code:string|null;created_at:string}>(
      `SELECT j.user_id,u.email,j.platform,j.status,j.duration_seconds,j.error_code,j.created_at
       FROM transcript_jobs j LEFT JOIN users u ON u.id=j.user_id
       ORDER BY j.created_at DESC LIMIT 20`
    ),
    pool.query<{platform:string;count:string}>(
      `SELECT j.platform,COUNT(*)::text AS count FROM usage_ledger l JOIN transcript_jobs j ON j.id=l.job_id GROUP BY j.platform ORDER BY COUNT(*) DESC`
    ),
    pool.query<{count:string}>(`SELECT COUNT(*)::text AS count FROM users WHERE email IS NOT NULL AND ($1='' OR email ILIKE '%'||$1||'%')`,[q]),
    pool.query<{
      id:string;email:string;plan:string;account_status:string;trial_eligible:boolean;admin_bonus_seconds:number;admin_bonus_videos:number;created_at:string;
      connected:boolean;links:string;seconds:string;failed:string;last_activity:string|null;
    }>(`SELECT u.id,u.email,u.plan,u.account_status,u.trial_eligible,u.admin_bonus_seconds,u.admin_bonus_videos,u.created_at,
        (EXISTS(SELECT 1 FROM oauth_access_tokens a WHERE a.user_id=u.id AND a.revoked_at IS NULL AND a.expires_at>now())
         OR EXISTS(SELECT 1 FROM oauth_refresh_tokens r WHERE r.user_id=u.id AND r.revoked_at IS NULL AND r.expires_at>now())) AS connected,
        COALESCE(us.links,0)::text AS links,COALESCE(us.seconds,0)::text AS seconds,COALESCE(js.failed,0)::text AS failed,
        GREATEST(u.updated_at,us.last_used,js.last_job) AS last_activity
       FROM users u
       LEFT JOIN (SELECT user_id,COUNT(*) links,COALESCE(SUM(seconds),0) seconds,MAX(created_at) last_used FROM usage_ledger GROUP BY user_id) us ON us.user_id=u.id
       LEFT JOIN (SELECT user_id,COUNT(*) FILTER(WHERE status='failed') failed,MAX(created_at) last_job FROM transcript_jobs GROUP BY user_id) js ON js.user_id=u.id
       WHERE u.email IS NOT NULL AND ($1='' OR u.email ILIKE '%'||$1||'%')
       ORDER BY GREATEST(u.updated_at,us.last_used,js.last_job) DESC NULLS LAST,u.created_at DESC LIMIT $2 OFFSET $3`,[q,pageSize,offset])
  ]);

  const m=summaryResult.rows[0];
  const accounts=founderNum(m?.accounts_total),connected=founderNum(m?.connected_total),activated=founderNum(m?.activated_total),paid=founderNum(m?.paid_total);
  const links=founderNum(m?.links_total),seconds=founderNum(m?.seconds_total);
  const recentJobs=recentJobsResult.rows.map(row=>`<tr><td>${founderTime(row.created_at)}</td><td class="fd-email"><a href="/founder/user/${founderEscape(row.user_id)}">${founderEscape(row.email??'anonymous')}</a></td><td>${founderEscape(row.platform)}</td><td><span class="fd-status ${row.status==='completed'?'ok':row.status==='failed'?'bad':'wait'}">${founderEscape(row.status)}</span></td><td>${row.duration_seconds?`${Math.ceil(row.duration_seconds/60)}m`:'—'}</td><td>${founderEscape(row.error_code??'—')}</td></tr>`).join('')||'<tr><td colspan="6">No jobs yet.</td></tr>';
  const platforms=platformResult.rows.map(row=>`<span class="fd-chip">${founderEscape(row.platform)} · ${founderNum(row.count)}</span>`).join('')||'<span class="fd-chip">No completed links yet</span>';
  const totalMatched=founderNum(accountsCountResult.rows[0]?.count);
  const totalPages=Math.max(1,Math.ceil(totalMatched/pageSize));
  const accountRows=accountsResult.rows.map(row=>`<tr><td class="fd-email"><a href="/founder/user/${founderEscape(row.id)}">${founderEscape(row.email)}</a></td><td>${founderEscape(row.plan)}</td><td>${founderEscape(row.account_status)}</td><td>${row.trial_eligible?'yes':'no'}</td><td>${row.connected?'✓':'—'}</td><td>${founderNum(row.links)}</td><td>${founderMinutes(row.seconds)}m</td><td>${founderNum(row.failed)}</td><td>${founderTime(row.last_activity)}</td><td><a class="btn alt sm" href="/founder/user/${founderEscape(row.id)}">Manage</a></td></tr>`).join('')||'<tr><td colspan="10">No matching accounts.</td></tr>';
  const searchValue=founderEscape(q);
  const querySuffix=q?`&q=${encodeURIComponent(q)}`:'';
  const prev=page>1?`<a class="btn alt sm" href="/founder?page=${page-1}${querySuffix}">← Prev</a>`:'';
  const next=page<totalPages?`<a class="btn alt sm" href="/founder?page=${page+1}${querySuffix}">Next →</a>`:'';

  const html=`<main class="fd">${founderCss()}<div class="fd-head"><div><span class="badge"><span class="badge-dot"></span>Private founder view</span><h1>Link2AI pulse.</h1><p class="fd-sub">Product usage + account administration. Full emails are visible only here.</p></div><a class="btn alt sm" href="/founder">Refresh</a></div>
    <section class="fd-grid">
      <div class="fd-card"><div class="fd-label">Accounts</div><div class="fd-value">${accounts}</div><div class="fd-note">+${founderNum(m?.accounts_24h)} today · +${founderNum(m?.accounts_7d)} in 7d</div></div>
      <div class="fd-card"><div class="fd-label">Claude connected</div><div class="fd-value">${connected}</div><div class="fd-note">${founderPct(connected,accounts)} of accounts</div></div>
      <div class="fd-card"><div class="fd-label">Successful links</div><div class="fd-value">${links}</div><div class="fd-note">+${founderNum(m?.links_24h)} today · +${founderNum(m?.links_7d)} in 7d</div></div>
      <div class="fd-card"><div class="fd-label">Paid users</div><div class="fd-value">${paid}</div><div class="fd-note">Basic ${founderNum(m?.basic_total)} · Pro ${founderNum(m?.pro_total)}</div></div>
      <div class="fd-card"><div class="fd-label">Activated users</div><div class="fd-value">${activated}</div><div class="fd-note">At least 1 successful link · ${founderPct(activated,accounts)} of accounts</div></div>
      <div class="fd-card"><div class="fd-label">Processed content</div><div class="fd-value">${founderMinutes(seconds)}m</div><div class="fd-note">${founderMinutes(m?.seconds_7d)}m in 7d</div></div>
      <div class="fd-card"><div class="fd-label">Failed jobs</div><div class="fd-value">${founderNum(m?.failed_24h)}</div><div class="fd-note">today · ${founderNum(m?.failed_7d)} in 7d</div></div>
      <div class="fd-card"><div class="fd-label">Platforms</div><div class="fd-chips" style="margin-top:10px">${platforms}</div></div>
    </section>
    <section><div class="fd-label" style="margin-bottom:8px">Funnel</div><div class="fd-funnel"><div class="fd-step"><b>${accounts}</b><span>Accounts</span></div><div class="fd-step"><b>${connected}</b><span>Claude connected · ${founderPct(connected,accounts)}</span></div><div class="fd-step"><b>${activated}</b><span>First successful link · ${founderPct(activated,accounts)}</span></div><div class="fd-step"><b>${paid}</b><span>Paid · ${founderPct(paid,Math.max(activated,1))} of activated</span></div></div></section>
    <section class="fd-panel"><div class="fd-panel-head"><div><h2>All accounts</h2><div class="fd-note">${totalMatched} matching · page ${page}/${totalPages}</div></div><form method="get" action="/founder" class="fd-tools"><input class="fd-input" type="search" name="q" value="${searchValue}" placeholder="Search email"><button class="btn alt sm" type="submit">Search</button>${q?'<a class="btn alt sm" href="/founder">Clear</a>':''}</form></div><div class="fd-scroll"><table class="fd-table"><thead><tr><th>Email</th><th>Plan</th><th>Status</th><th>Trial</th><th>Claude</th><th>Links</th><th>Minutes</th><th>Failed</th><th>Last activity</th><th></th></tr></thead><tbody>${accountRows}</tbody></table></div><div class="fd-panel-head"><span class="fd-label">100 per page</span><div class="fd-nav">${prev}${next}</div></div></section>
    <section class="fd-panel"><div class="fd-panel-head"><h2>Recent jobs</h2><span class="fd-label">Latest 20</span></div><div class="fd-scroll"><table class="fd-table"><thead><tr><th>Time</th><th>Email</th><th>Platform</th><th>Status</th><th>Length</th><th>Error</th></tr></thead><tbody>${recentJobs}</tbody></table></div></section>
    <div class="fd-warning">Adjustments never delete usage history. Extra quota is added on top of the plan limit. Manual plan changes can later be overwritten by a Lemon Squeezy subscription webhook.</div>
    <p class="fd-private">Private route. Only the signed-in account matching FOUNDER_EMAIL can open this page.</p></main>`;
  return reply.type('text/html').send(siteShell(html,`${env().PUBLIC_BRAND_NAME} Founder`));
});

app.get('/founder/user/:id',async(req,reply)=>{
  const founderEmail=env().FOUNDER_EMAIL?.trim().toLowerCase();
  if(!founderEmail)return reply.code(404).type('text/plain').send('Not found');
  const founder=await userFromSessionCookie(req.headers.cookie);
  if(!founder)return reply.redirect('/login?return_to=%2Ffounder');
  if((founder.email??'').trim().toLowerCase()!==founderEmail)return reply.code(404).type('text/plain').send('Not found');
  const targetId=String((req.params as {id?:string})?.id??'');
  const accountResult=await pool.query<{
    id:string;email:string|null;plan:string;account_status:string;trial_eligible:boolean;admin_bonus_seconds:number;admin_bonus_videos:number;created_at:string;updated_at:string;connected:boolean;
  }>(`SELECT u.id,u.email,u.plan,u.account_status,u.trial_eligible,u.admin_bonus_seconds,u.admin_bonus_videos,u.created_at,u.updated_at,
      (EXISTS(SELECT 1 FROM oauth_access_tokens a WHERE a.user_id=u.id AND a.revoked_at IS NULL AND a.expires_at>now())
       OR EXISTS(SELECT 1 FROM oauth_refresh_tokens r WHERE r.user_id=u.id AND r.revoked_at IS NULL AND r.expires_at>now())) AS connected
      FROM users u WHERE u.id=$1`,[targetId]);
  if(!accountResult.rowCount)return reply.code(404).type('text/plain').send('Not found');
  const account=accountResult.rows[0];
  const [usage,allTimeResult,jobsResult,auditResult]=await Promise.all([
    getUsageSnapshot(targetId),
    pool.query<{links:string;seconds:string;failed:string;last_job:string|null}>(`SELECT
      (SELECT COUNT(*) FROM usage_ledger WHERE user_id=$1)::text links,
      COALESCE((SELECT SUM(seconds) FROM usage_ledger WHERE user_id=$1),0)::text seconds,
      (SELECT COUNT(*) FROM transcript_jobs WHERE user_id=$1 AND status='failed')::text failed,
      (SELECT MAX(created_at) FROM transcript_jobs WHERE user_id=$1) last_job`,[targetId]),
    pool.query<{id:string;platform:string;status:string;duration_seconds:number|null;error_code:string|null;created_at:string}>(`SELECT id,platform,status,duration_seconds,error_code,created_at FROM transcript_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`,[targetId]),
    pool.query<{action:string;before_state:unknown;after_state:unknown;created_at:string}>(`SELECT action,before_state,after_state,created_at FROM founder_admin_events WHERE target_user_id=$1 ORDER BY created_at DESC LIMIT 10`,[targetId])
  ]);
  const a=allTimeResult.rows[0];
  const flash=String((req.query as {saved?:string;error?:string})?.saved??'')==='1'?'<div class="fd-okflash">Saved.</div>':String((req.query as {error?:string})?.error??'')?`<div class="fd-badflash">${founderEscape((req.query as {error?:string}).error)}</div>`:'';
  const jobRows=jobsResult.rows.map(row=>`<tr><td>${founderTime(row.created_at)}</td><td>${founderEscape(row.platform)}</td><td>${founderEscape(row.status)}</td><td>${row.duration_seconds?`${Math.ceil(row.duration_seconds/60)}m`:'—'}</td><td>${founderEscape(row.error_code??'—')}</td><td class="fd-email">${founderEscape(row.id)}</td></tr>`).join('')||'<tr><td colspan="6">No jobs yet.</td></tr>';
  const auditRows=auditResult.rows.map(row=>`<tr><td>${founderTime(row.created_at)}</td><td>${founderEscape(row.action)}</td><td class="fd-muted">${founderEscape(JSON.stringify(row.after_state??{}))}</td></tr>`).join('')||'<tr><td colspan="3">No founder adjustments yet.</td></tr>';
  const limitVideos=usage.limit_videos===null?'∞':String(usage.limit_videos);
  const remainingVideos=usage.remaining_videos===null?'∞':String(usage.remaining_videos);
  const self=targetId===founder.id;
  const html=`<main class="fd">${founderCss()}<div class="fd-head"><div><a href="/founder" class="fd-note">← All accounts</a><h1 style="font-size:clamp(30px,5vw,52px)">${founderEscape(account.email??'anonymous')}</h1><p class="fd-sub fd-email">${founderEscape(account.id)}</p></div><a class="btn alt sm" href="/founder/user/${founderEscape(targetId)}">Refresh</a></div>${flash}
    <section class="fd-grid">
      <div class="fd-card"><div class="fd-label">Plan</div><div class="fd-value" style="font-size:26px">${founderEscape(account.plan)}</div><div class="fd-note">${founderEscape(account.account_status)}</div></div>
      <div class="fd-card"><div class="fd-label">Current usage</div><div class="fd-value" style="font-size:26px">${founderMinutes(usage.used_seconds)}m</div><div class="fd-note">of ${founderMinutes(usage.limit_seconds)}m · ${usage.used_videos}/${limitVideos} links</div></div>
      <div class="fd-card"><div class="fd-label">Remaining</div><div class="fd-value" style="font-size:26px">${founderMinutes(usage.remaining_seconds)}m</div><div class="fd-note">${remainingVideos} links · period end ${founderTime(usage.period_end)}</div></div>
      <div class="fd-card"><div class="fd-label">Claude</div><div class="fd-value" style="font-size:26px">${account.connected?'Connected':'—'}</div><div class="fd-note">Trial eligible: ${account.trial_eligible?'yes':'no'}</div></div>
      <div class="fd-card"><div class="fd-label">All-time links</div><div class="fd-value">${founderNum(a?.links)}</div><div class="fd-note">${founderMinutes(a?.seconds)}m processed</div></div>
      <div class="fd-card"><div class="fd-label">Failed jobs</div><div class="fd-value">${founderNum(a?.failed)}</div><div class="fd-note">Last job ${founderTime(a?.last_job)}</div></div>
      <div class="fd-card"><div class="fd-label">Bonus quota</div><div class="fd-value" style="font-size:26px">${founderMinutes(account.admin_bonus_seconds)}m</div><div class="fd-note">+${founderNum(account.admin_bonus_videos)} links</div></div>
      <div class="fd-card"><div class="fd-label">Created</div><div class="fd-value" style="font-size:20px">${founderTime(account.created_at)}</div><div class="fd-note">Updated ${founderTime(account.updated_at)}</div></div>
    </section>
    <section class="fd-panel"><div class="fd-panel-head"><div><h2>Adjust account</h2><div class="fd-note">Usage history is never deleted.</div></div></div><div style="padding:18px"><form method="post" action="/founder/user/${founderEscape(targetId)}/update"><div class="fd-form-grid">
      <div class="fd-field"><label>Plan</label><select class="fd-select" name="plan"><option value="trial" ${account.plan==='trial'?'selected':''}>Trial</option><option value="basic" ${account.plan==='basic'?'selected':''}>Basic</option><option value="pro" ${account.plan==='pro'?'selected':''}>Pro</option></select><small>Manual plan override. A later Lemon Squeezy webhook can replace it.</small></div>
      <div class="fd-field"><label>Account status</label><select class="fd-select" name="account_status"><option value="active" ${account.account_status==='active'?'selected':''}>Active</option><option value="past_due" ${account.account_status==='past_due'?'selected':''}>Past due</option><option value="canceled" ${account.account_status==='canceled'?'selected':''}>Canceled</option><option value="disabled" ${account.account_status==='disabled'?'selected':''}>Disabled</option></select><small>Disabled blocks web sessions, OAuth and new processing.${self?' Your own founder account cannot be disabled here.':''}</small></div>
      <div class="fd-field"><label>Trial eligibility</label><select class="fd-select" name="trial_eligible"><option value="true" ${account.trial_eligible?'selected':''}>Eligible</option><option value="false" ${!account.trial_eligible?'selected':''}>Not eligible</option></select><small>Only matters while the account is on Trial.</small></div>
      <div class="fd-field"><label>Extra minutes</label><input class="fd-input" type="number" name="bonus_minutes" min="0" max="100000" step="1" value="${Math.floor(founderNum(account.admin_bonus_seconds)/60)}"><small>Added on top of the normal plan limit without changing historical usage.</small></div>
      <div class="fd-field"><label>Extra links</label><input class="fd-input" type="number" name="bonus_links" min="0" max="100000" step="1" value="${founderNum(account.admin_bonus_videos)}"><small>Useful for Trial; Basic and Pro already have no link-count cap.</small></div>
    </div><div class="fd-actions"><button class="btn purple" type="submit">Save changes</button><a class="btn alt" href="/founder">Back</a></div></form></div></section>
    <section class="fd-panel"><div class="fd-panel-head"><h2>Recent jobs</h2><span class="fd-label">Latest 30</span></div><div class="fd-scroll"><table class="fd-table"><thead><tr><th>Time</th><th>Platform</th><th>Status</th><th>Length</th><th>Error</th><th>Job ID</th></tr></thead><tbody>${jobRows}</tbody></table></div></section>
    <section class="fd-panel"><div class="fd-panel-head"><h2>Founder adjustments</h2><span class="fd-label">Latest 10</span></div><div class="fd-scroll"><table class="fd-table"><thead><tr><th>Time</th><th>Action</th><th>New state</th></tr></thead><tbody>${auditRows}</tbody></table></div></section>
    <p class="fd-private">Full email and account controls are visible only to FOUNDER_EMAIL.</p></main>`;
  return reply.type('text/html').send(siteShell(html,`${env().PUBLIC_BRAND_NAME} Founder Account`));
});

app.post('/founder/user/:id/update',async(req,reply)=>{
  const founderEmail=env().FOUNDER_EMAIL?.trim().toLowerCase();
  if(!founderEmail)return reply.code(404).type('text/plain').send('Not found');
  const founder=await userFromSessionCookie(req.headers.cookie);
  if(!founder||(founder.email??'').trim().toLowerCase()!==founderEmail)return reply.code(404).type('text/plain').send('Not found');
  if(!founderOriginOk(req as unknown as {headers:Record<string,string|string[]|undefined>}))return reply.code(403).type('text/plain').send('Invalid origin');
  const targetId=String((req.params as {id?:string})?.id??'');
  const body=(req.body??{}) as Record<string,unknown>;
  const plan=String(body.plan??'');
  const accountStatus=String(body.account_status??'');
  const trialEligible=String(body.trial_eligible??'')==='true';
  const bonusMinutes=Number(body.bonus_minutes??0);
  const bonusLinks=Number(body.bonus_links??0);
  if(!['trial','basic','pro'].includes(plan)||!['active','past_due','canceled','disabled'].includes(accountStatus)||!Number.isInteger(bonusMinutes)||bonusMinutes<0||bonusMinutes>100000||!Number.isInteger(bonusLinks)||bonusLinks<0||bonusLinks>100000){
    return reply.redirect(`/founder/user/${encodeURIComponent(targetId)}?error=${encodeURIComponent('Invalid account settings.')}`);
  }
  if(targetId===founder.id&&accountStatus==='disabled')return reply.redirect(`/founder/user/${encodeURIComponent(targetId)}?error=${encodeURIComponent('You cannot disable the founder account from the founder dashboard.')}`);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const before=await client.query<{id:string;email:string|null;plan:string;account_status:string;trial_eligible:boolean;admin_bonus_seconds:number;admin_bonus_videos:number}>(`SELECT id,email,plan,account_status,trial_eligible,admin_bonus_seconds,admin_bonus_videos FROM users WHERE id=$1 FOR UPDATE`,[targetId]);
    if(!before.rowCount){await client.query('ROLLBACK');return reply.code(404).type('text/plain').send('Not found');}
    const after=await client.query<{id:string;email:string|null;plan:string;account_status:string;trial_eligible:boolean;admin_bonus_seconds:number;admin_bonus_videos:number}>(`UPDATE users SET plan=$2,account_status=$3,trial_eligible=$4,admin_bonus_seconds=$5,admin_bonus_videos=$6,updated_at=now() WHERE id=$1 RETURNING id,email,plan,account_status,trial_eligible,admin_bonus_seconds,admin_bonus_videos`,[targetId,plan,accountStatus,trialEligible,bonusMinutes*60,bonusLinks]);
    await client.query(`INSERT INTO founder_admin_events(founder_user_id,target_user_id,action,before_state,after_state) VALUES($1,$2,'account_update',$3::jsonb,$4::jsonb)`,[founder.id,targetId,JSON.stringify(before.rows[0]),JSON.stringify(after.rows[0])]);
    await client.query('COMMIT');
    return reply.redirect(`/founder/user/${encodeURIComponent(targetId)}?saved=1`);
  }catch(err){
    await client.query('ROLLBACK');
    app.log.error(err);
    return reply.redirect(`/founder/user/${encodeURIComponent(targetId)}?error=${encodeURIComponent('Save failed.')}`);
  }finally{client.release();}
});


app.get('/support',async(_req,reply)=>reply.type('text/html').send(siteShell(`<main><section class="connect-hero" style="text-align:left;margin-left:0"><span class="badge"><span class="badge-dot"></span>Support</span><h1>Something got in the way?</h1><p>Start with the connection guide. If a supported public link still fails, send the URL and the error message — never send passwords, payment details or identity documents.</p><div class="actions">${env().SUPPORT_EMAIL?`<a class="btn purple" href="mailto:${env().SUPPORT_EMAIL}">Email support →</a>`:''}<a class="btn alt" href="/connect">Open setup guide</a></div>${env().SUPPORT_EMAIL?`<p class="micro">Support email: <a href="mailto:${env().SUPPORT_EMAIL}"><strong>${env().SUPPORT_EMAIL}</strong></a></p>`:''}</section><section class="support-grid"><div class="card"><div class="kicker">Connection</div><h3>Claude cannot see ${env().PUBLIC_BRAND_NAME}</h3><p>Reconnect from the setup page. The recommended OAuth path is automatic client registration, so users should not need to paste a client ID or secret.</p></div><div class="card"><div class="kicker">Processing</div><h3>A public link did not process</h3><p>Private, deleted, login-only, paid/DRM, geo-restricted or unsupported links may fail. Failed jobs do not consume completed-job quota.</p></div><div class="card"><div class="kicker">Billing & privacy</div><h3>Account question</h3><p>Include your Link2AI account email. Do not send passwords, card numbers or government ID documents.</p></div></section></main>`, `${env().PUBLIC_BRAND_NAME} Support`)));


app.get('/guide/claude-add-connector.png',async(_req,reply)=>reply.type('image/png').send(await readFile('assets/tutorial/claude-add-connector.png')));
app.get('/guide/claude-oauth.png',async(_req,reply)=>reply.type('image/png').send(await readFile('assets/tutorial/claude-oauth.png')));
app.get('/guide/claude-permissions.png',async(_req,reply)=>reply.type('image/png').send(await readFile('assets/tutorial/claude-permissions.png')));
app.get('/guide/claude-tool-access.png',async(_req,reply)=>reply.type('image/png').send(await readFile('assets/tutorial/claude-tool-access.png')));

app.get('/logo.svg',async(_req,reply)=>reply.type('image/svg+xml').send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="224" fill="#0f172a"/><g fill="none" stroke="#fff" stroke-width="74" stroke-linecap="round"><path d="M337 601l-68 68c-70 70-70 184 0 254s184 70 254 0l122-122c70-70 70-184 0-254-38-38-89-55-139-52" transform="translate(0 -94)"/><path d="M687 423l68-68c70-70 70-184 0-254s-184-70-254 0L379 223c-70 70-70 184 0 254 38 38 89 55 139 52" transform="translate(0 94)"/><path d="M414 610l196-196"/></g><path d="M792 213l18 48 48 18-48 18-18 48-18-48-48-18 48-18 18-48z" fill="#fff"/></svg>`));



function legalPage(title:string,body:string){
  const contact=`<p>Questions, support, or privacy requests: <a href="/support">${env().PUBLIC_BRAND_NAME} Support</a>${env().SUPPORT_EMAIL?` · <a href="mailto:${env().SUPPORT_EMAIL}">${env().SUPPORT_EMAIL}</a>`:''}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${env().PUBLIC_BRAND_NAME} ${title}</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:56px auto;padding:0 20px;line-height:1.55;color:#171717}h1,h2{line-height:1.2}a{color:inherit}</style></head><body><h1>${title}</h1><p><small>Last updated September 14, 2026</small></p>${body}${contact}</body></html>`;
}

app.get('/privacy',async(_req,reply)=>reply.type('text/html').send(legalPage('Privacy Policy',`
<h2>What ${env().PUBLIC_BRAND_NAME} processes</h2><p>${env().PUBLIC_BRAND_NAME} receives public Instagram Reel, TikTok and YouTube URLs only when a connected AI asks ${env().PUBLIC_BRAND_NAME} to read them. To provide a transcript, ${env().PUBLIC_BRAND_NAME} may process the URL, public video metadata, captions and temporary audio derived from the public video.</p>
<h2>Account and billing data</h2><p>${env().PUBLIC_BRAND_NAME} stores the email address used for your account, a salted password hash (never your plaintext password), account/session identifiers, plan and quota usage, and identifiers needed to manage a Lemon Squeezy subscription. To limit repeated free-trial abuse, ${env().PUBLIC_BRAND_NAME} also uses a random first-party browser token associated with trial eligibility. ${env().PUBLIC_BRAND_NAME} does not store card numbers.</p>
<h2>Retention</h2><p>Downloaded media and derived audio are temporary processing files and are deleted after the job finishes. Transcript cache is temporary and defaults to 72 hours. Completed and failed job records are retained only as minimal operational/accounting records; the stored video URL and canonical media identifier are scrubbed after the transcript retention window. Unpaid pending jobs expire and have their media URL scrubbed after 24 hours.</p>
<h2>Service providers</h2><p>${env().PUBLIC_BRAND_NAME} may send the minimum data needed to service providers used for hosting, billing, media processing, and optional email authentication. These providers process data under their own terms and privacy policies.</p>
<h2>What ${env().PUBLIC_BRAND_NAME} does not do</h2><p>V1 does not support private accounts, paid/DRM content or bulk crawling. ${env().PUBLIC_BRAND_NAME} does not sell a transcript corpus and does not intentionally keep raw video or audio as a content library.</p>`)));

app.get('/terms',async(_req,reply)=>reply.type('text/html').send(legalPage('Terms of Service',`
<h2>Use of the service</h2><p>Use ${env().PUBLIC_BRAND_NAME} only for public content you are authorized to access and process. Do not use the service to bypass private-account controls, authentication, paywalls, DRM, geographic restrictions or other access controls, and do not use it for bulk crawling.</p>
<h2>Plans and billing</h2><p>The one-time trial is intended for one-time evaluation and includes up to 3 successful links and 10 total minutes of processed content, whichever is reached first. Repeated trial creation may be restricted. Basic includes up to 500 minutes of processed content per billing period and supports links with up to 30 minutes of content. Pro includes up to 2,000 minutes of processed content per billing period and supports links with up to 120 minutes of content. Only successfully completed jobs consume usage quota. Paid subscriptions renew until canceled through the subscription-management flow.</p>
<h2>Availability</h2><p>${env().PUBLIC_BRAND_NAME} processes supported public links. Processing can temporarily fail, and not every public URL is guaranteed to be processable. ${env().PUBLIC_BRAND_NAME} does not guarantee that every public URL can be processed. Failed jobs do not consume transcript quota.</p>
<h2>Service guarantee and refunds</h2><p>If core paid service is materially unavailable for supported public links because of our service issue and reasonable access cannot be restored, our Support team may remedy the situation with restored transcript quota, account credit, prorated refund, or full refund depending on impact and duration. This does not apply to unsupported or private content, removed or restricted content, or content restricted by third-party platforms.</p>
<h2>Content responsibility</h2><p>${env().PUBLIC_BRAND_NAME} returns source material to the connected AI as untrusted external data. The connected AI, not ${env().PUBLIC_BRAND_NAME}, performs any summary, analysis, translation, recommendation or factual judgment requested by the user.</p>`)));

await registerAuthRoutes(app);
await registerBillingRoutes(app);

app.setErrorHandler((err,_req,reply)=>{
  app.log.error(err);
  if(reply.sent)return;
  const message=err instanceof Error?err.message:'Unknown error';
  reply.code(500).send({error:'internal_error',message:env().NODE_ENV==='production'?'Something went wrong.':message});
});

const shutdown=async()=>{await mcpHandler.close();await app.close();await pool.end();};
process.on('SIGTERM',()=>void shutdown());
process.on('SIGINT',()=>void shutdown());

await app.listen({port:env().PORT,host:'0.0.0.0'});
console.log(`[api] Link2AI listening on ${env().PORT}`);
