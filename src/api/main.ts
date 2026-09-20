import { readFile } from 'node:fs/promises';
import { hostHeaderValidation } from '@modelcontextprotocol/fastify';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, validateOriginHeader } from '@modelcontextprotocol/server';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { registerAuthRoutes } from '../auth/routes.js';
import { registerBillingRoutes } from '../billing/routes.js';
import { authInfoFromBearer, beginFounderStepUp, clearFounderStepUpCookie, createFounderStepUpCookie, csrfTokenFromSessionCookie, diagnoseBearerAuth, hasFounderStepUp, invalidateFounderStepUpChallenges, mcpResource, userFromSessionCookie, verifyCsrfToken, verifyFounderStepUp } from '../auth/service.js';
import { buildMcpServer } from '../mcp/server.js';
import { readinessIssues } from '../config/readiness.js';
import { browserSameOriginOk, publicHostAllowlist } from '../config/publicUrl.js';
import { getUsageSnapshot } from '../quota/service.js';
import { trackWebsiteEvent, trackWebsiteVisit } from '../analytics/visitors.js';
import { recordActivationEvent } from '../analytics/product.js';
import { logErrorEvent, logEvent } from '../util/log.js';
import { registerPublicApiRoutes } from './publicApi.js';
import { developerDocs } from './developerDocs.js';
import { clientSourceLabel, inferMcpClientSource } from '../source/clientSource.js';

const allowedPublicHosts=publicHostAllowlist(env().PUBLIC_BASE_URL,[process.env.RAILWAY_PUBLIC_DOMAIN??'']);
const redditOAuthReady=Boolean(env().REDDIT_CLIENT_ID&&env().REDDIT_CLIENT_SECRET);
const app=Fastify();
app.addHook('onRequest',hostHeaderValidation(allowedPublicHosts));

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

const mcpHandler=createMcpHandler(()=>buildMcpServer());
const nodeMcp=toNodeHandler(mcpHandler,{onerror:(err)=>logErrorEvent('mcp_adapter_error',err,{distribution_profile:'default'})});
const openaiMcpHandler=createMcpHandler(()=>buildMcpServer('openai'));
const nodeOpenaiMcp=toNodeHandler(openaiMcpHandler,{onerror:(err)=>logErrorEvent('mcp_adapter_error',err,{distribution_profile:'openai'})});

app.all('/mcp',async(request,reply)=>{
  const ua=String(request.headers['user-agent']??'');
  const originHeader=Array.isArray(request.headers.origin)?request.headers.origin[0]:request.headers.origin;
  const originCheck=validateOriginHeader(originHeader,allowedPublicHosts);
  if(!originCheck.ok){
    return reply.code(403).send({jsonrpc:'2.0',error:{code:-32000,message:originCheck.message},id:null});
  }

  // Normal Claude/general Link2AI traffic keeps the original /mcp audience
  // and full tool surface.
  const defaultAuth=await authInfoFromBearer(request.headers.authorization,mcpResource());
  if(defaultAuth){
    defaultAuth.extra.clientSource=inferMcpClientSource(defaultAuth.clientId,ua,'default');
    return nodeMcp(Object.assign(request.raw,{auth:defaultAuth}),reply.raw,request.body);
  }

  // ChatGPT can keep an already-installed legacy connector whose runtime still
  // posts to /mcp even after the Plugin Portal draft is configured for
  // /mcp/openai. If the bearer token is explicitly scoped to /mcp/openai, route
  // that request to the restricted OpenAI MCP handler. This does not broaden
  // access: the OpenAI token never gains the general /mcp tool surface.
  const openaiAuth=await authInfoFromBearer(request.headers.authorization,mcpResource('openai'));
  if(openaiAuth){
    openaiAuth.extra.clientSource='chatgpt';
    logEvent('openai_mcp_legacy_alias',{method:request.method,distribution_profile:'openai'});
    return nodeOpenaiMcp(Object.assign(request.raw,{auth:openaiAuth}),reply.raw,request.body);
  }

  const openaiRuntime=/^openai-mcp\//i.test(ua);
  const resourceMetadata=openaiRuntime
    ? `${env().PUBLIC_BASE_URL}/.well-known/oauth-protected-resource/mcp/openai`
    : `${env().PUBLIC_BASE_URL}/.well-known/oauth-protected-resource/mcp`;
  reply.header('WWW-Authenticate',`Bearer resource_metadata="${resourceMetadata}", scope="link2ai:read"`);
  return reply.code(401).send({error:'unauthorized',message:`Connect ${env().PUBLIC_BRAND_NAME} to continue.`});
});

app.all('/mcp/openai',async(request,reply)=>{
  const originHeader=Array.isArray(request.headers.origin)?request.headers.origin[0]:request.headers.origin;
  const originCheck=validateOriginHeader(originHeader,allowedPublicHosts);
  if(!originCheck.ok){
    return reply.code(403).send({jsonrpc:'2.0',error:{code:-32000,message:originCheck.message},id:null});
  }
  const auth=await authInfoFromBearer(request.headers.authorization,mcpResource('openai'));
  if(!auth){
    const diagnostic=await diagnoseBearerAuth(request.headers.authorization,mcpResource('openai')).catch(()=>null);
    logEvent('openai_mcp_auth_rejected',{
      distribution_profile:'openai',
      diagnostic_available:Boolean(diagnostic),
      authorization_present:Boolean(diagnostic?.authorization_present),
      bearer_scheme_valid:Boolean(diagnostic?.bearer_scheme_valid),
      token_found:Boolean(diagnostic?.token_found),
      scope_has_read:diagnostic?.scope_has_read,
      expired:diagnostic?.expired,
      revoked:diagnostic?.revoked,
      user_disabled:diagnostic?.user_disabled
    });
    const resourceMetadata=`${env().PUBLIC_BASE_URL}/.well-known/oauth-protected-resource/mcp/openai`;
    const challenge=diagnostic?.authorization_present
      ? `Bearer resource_metadata="${resourceMetadata}", scope="link2ai:read", error="invalid_token", error_description="Access token is invalid for this MCP resource"`
      : `Bearer resource_metadata="${resourceMetadata}", scope="link2ai:read"`;
    reply.header('WWW-Authenticate',challenge);
    return reply.code(401).send({error:'unauthorized',message:`Connect ${env().PUBLIC_BRAND_NAME} to continue.`});
  }
  auth.extra.clientSource='chatgpt';
  return nodeOpenaiMcp(Object.assign(request.raw,{auth}),reply.raw,request.body);
});

app.get('/healthz',async(_req,reply)=>{
  return reply.send({ok:true,service:'link2ai-api',version:'1.1.0'});
});

app.get('/readyz',async(_req,reply)=>{
  try{await pool.query('SELECT 1');}catch{return reply.code(503).send({ready:false});}
  const issues=readinessIssues('api');
  if(issues.length){logEvent('api_readiness_failed',{issue_count:issues.length});return reply.code(503).send({ready:false});}
  return {ready:true};
});

app.get('/status',async(_req,reply)=>{
  let dbOk=false;
  try{await pool.query('SELECT 1');dbOk=true;}catch(e){logErrorEvent('status_database_error',e);}
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
  <url><loc>${baseUrl}/examples</loc><priority>0.8</priority></url>
  <url><loc>${baseUrl}/use-cases</loc><priority>0.8</priority></url>
  <url><loc>${baseUrl}/sources</loc><priority>0.8</priority></url>
  <url><loc>${baseUrl}/pricing</loc><priority>0.9</priority></url>
  <url><loc>${baseUrl}/developers</loc><priority>0.9</priority></url>
  <url><loc>${baseUrl}/status</loc><priority>0.5</priority></url>
  <url><loc>${baseUrl}/support</loc><priority>0.8</priority></url>
  <url><loc>${baseUrl}/privacy</loc><priority>0.8</priority></url>
  <url><loc>${baseUrl}/terms</loc><priority>0.8</priority></url>
</urlset>`;
  return reply.type('application/xml').send(xml);
});

const siteCss=`:root{color-scheme:light;--ink:#17151f;--muted:#6f6a78;--line:rgba(44,39,55,.11);--paper:#fbfaf8;--card:#fff;--soft:#f4f1ec;--purple:#6f54e8;--purple2:#8d77ff;--orange:#ef9a62;--green:#158f67;--shadow:0 22px 70px rgba(39,31,64,.10)}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:radial-gradient(circle at 70% -10%,rgba(137,112,255,.16),transparent 34%),radial-gradient(circle at 8% 16%,rgba(244,157,99,.11),transparent 28%),var(--paper)}a{color:inherit}h1,h2,h3{overflow-wrap:normal;word-break:normal;hyphens:none;text-wrap:balance}p,.sub,.micro{overflow-wrap:normal;word-break:normal;hyphens:none;text-wrap:pretty}.wrap{max-width:1280px;margin:0 auto;padding:0 28px}nav{height:78px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:40;background:rgba(251,250,248,.86);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}.brand{display:flex;align-items:center;gap:10px;font-weight:900;letter-spacing:-.045em;font-size:21px;text-decoration:none}.brand img{width:32px;height:32px;border-radius:9px;box-shadow:0 6px 18px rgba(31,26,44,.14)}.home-nav{position:absolute;top:0;left:50%;transform:translateX(-50%);width:min(calc(100vw - 56px),1224px);background:transparent;border-bottom-color:transparent;backdrop-filter:none;-webkit-backdrop-filter:none}.navlinks{display:flex;gap:24px;align-items:center;font-size:14px;font-weight:650}.skip-link{position:fixed;left:16px;top:12px;z-index:1000;padding:10px 14px;border-radius:999px;background:#1c1922;color:#fff;font-weight:800;text-decoration:none;transform:translateY(-160%);transition:transform .16s}.skip-link:focus{transform:translateY(0)}.mobile-menu{display:none;position:relative}.mobile-menu summary{list-style:none;cursor:pointer;border:1px solid var(--line);background:rgba(255,255,255,.82);border-radius:999px;padding:10px 13px;font-size:12px;font-weight:850;color:#4e4857}.mobile-menu summary::-webkit-details-marker{display:none}.mobile-menu-panel{position:absolute;right:0;top:48px;min-width:220px;padding:10px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.98);box-shadow:var(--shadow);display:grid;gap:4px}.mobile-menu-panel a{padding:11px 12px;border-radius:12px;text-decoration:none;font-size:13px;font-weight:750;color:#4e4857}.mobile-menu-panel a:hover{background:#f5f2fa;color:#2f2838}.navlinks a{text-decoration:none;color:#4e4857}.btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;border-radius:999px;padding:13px 19px;background:#1c1922;color:#fff;text-decoration:none;font-weight:800;border:1px solid #1c1922;box-shadow:0 7px 18px rgba(28,25,34,.12);transition:transform .16s,box-shadow .16s}.btn:hover{transform:translateY(-1px);box-shadow:0 10px 25px rgba(28,25,34,.18)}.btn.purple{background:linear-gradient(135deg,var(--purple),var(--purple2));border-color:transparent}.btn.alt{background:rgba(255,255,255,.75);color:var(--ink);border-color:var(--line);box-shadow:none}.btn.sm{padding:10px 15px;font-size:13px}.hero{padding:82px 0 70px}.hero-grid{display:grid;grid-template-columns:1.04fr .96fr;gap:58px;align-items:center}.badge{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(111,84,232,.18);background:rgba(255,255,255,.72);backdrop-filter:blur(12px);border-radius:999px;padding:7px 11px;font-size:12px;font-weight:800;color:#5945b6}.badge-dot{width:7px;height:7px;border-radius:50%;background:var(--purple);box-shadow:0 0 0 5px rgba(111,84,232,.10)}.hero h1{font-size:clamp(52px,7vw,82px);line-height:.95;letter-spacing:-.068em;margin:19px 0 24px;max-width:760px}.hero h1 .hero-top,.hero h1 em,.hero h1 em span{display:block}.hero h1 .hero-mid,.hero h1 .hero-last{white-space:nowrap}.hero h1 em{font-style:normal;background:linear-gradient(120deg,#6f54e8 20%,#a067ef 55%,#e38d63);-webkit-background-clip:text;background-clip:text;color:transparent}.hero p{font-size:20px;line-height:1.55;color:var(--muted);max-width:680px;margin:0}.actions{display:flex;gap:11px;flex-wrap:wrap;margin-top:30px}.micro{font-size:12px;color:#817a89;margin-top:15px;line-height:1.5}.platforms{display:flex;gap:8px;flex-wrap:wrap;margin-top:22px}.platform{display:inline-flex;align-items:center;gap:7px;padding:8px 11px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.72);font-size:12px;font-weight:750;color:#5e5867}.platform b{width:7px;height:7px;border-radius:2px;background:#1c1922}.demo{position:relative}.demo:before{content:"";position:absolute;inset:12% -5% -8% 8%;background:linear-gradient(135deg,rgba(111,84,232,.20),rgba(239,154,98,.18));filter:blur(48px);border-radius:50%;z-index:0}.demo-window{position:relative;z-index:1;background:rgba(255,255,255,.92);border:1px solid rgba(44,39,55,.12);border-radius:28px;box-shadow:var(--shadow);overflow:hidden}.window-top{height:48px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:7px;padding:0 17px;background:rgba(250,249,247,.82)}.window-dot{width:9px;height:9px;border-radius:50%;background:#d9d4df}.window-title{margin-left:8px;font-size:12px;font-weight:800;color:#655f6d}.chat{padding:24px;display:grid;gap:15px}.chat-row{max-width:86%;padding:13px 15px;border-radius:18px;font-size:13px;line-height:1.5}.chat-row.user{justify-self:end;background:#1f1b25;color:#fff;border-bottom-right-radius:6px}.chat-row.ai{justify-self:start;background:#f2eff7;color:#453f4c;border-bottom-left-radius:6px}.tool-card{justify-self:start;width:88%;border:1px solid rgba(111,84,232,.16);background:linear-gradient(180deg,#fff,#faf8ff);border-radius:17px;padding:13px 14px}.tool-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.tool-name{display:flex;align-items:center;gap:9px;font-size:12px;font-weight:850}.tool-icon{width:28px;height:28px;border-radius:9px;background:#1c1922;color:#fff;display:grid;place-items:center;font-size:12px}.tool-state{font-size:10px;font-weight:800;color:var(--green);background:#eaf8f2;padding:5px 8px;border-radius:999px}.tool-line{height:7px;border-radius:8px;background:#ebe7f0;margin-top:10px}.tool-line.w82{width:82%}.tool-line.w57{width:57%}.section{padding:84px 0;border-top:1px solid var(--line)}.section-head{display:flex;justify-content:space-between;gap:30px;align-items:end;margin-bottom:32px}.section h2{font-size:44px;line-height:1.04;letter-spacing:-.055em;margin:0}.section .sub{color:var(--muted);font-size:17px;max-width:610px;line-height:1.6;margin:0}.feature-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.card{border:1px solid var(--line);border-radius:24px;padding:25px;background:rgba(255,255,255,.80);box-shadow:0 9px 30px rgba(31,26,44,.035)}.card .kicker{font-size:11px;text-transform:uppercase;letter-spacing:.12em;font-weight:900;color:#8a8292;margin-bottom:16px}.card h3{margin:0 0 10px;font-size:19px;line-height:1.25;letter-spacing:-.025em;text-wrap:balance}.card p{margin:0;color:var(--muted);font-size:15px;line-height:1.6;text-wrap:pretty}.workflow{display:grid;grid-template-columns:1fr 50px 1fr 50px 1fr;align-items:center;margin-top:28px}.flow-box{min-height:164px;border:1px solid var(--line);border-radius:24px;background:#fff;padding:22px;box-shadow:0 10px 30px rgba(31,26,44,.04)}.flow-num{width:30px;height:30px;border-radius:10px;background:#1c1922;color:#fff;display:grid;place-items:center;font-size:12px;font-weight:900;margin-bottom:18px}.flow-box h3{font-size:19px;margin:0 0 8px}.flow-box p{color:var(--muted);font-size:14px;line-height:1.55;margin:0}.flow-arrow{text-align:center;color:#aca5b4;font-size:26px}.pricing{display:grid;grid-template-columns:.86fr 1.08fr 1fr;gap:15px;margin-top:30px}.price-card{position:relative;border:1px solid var(--line);border-radius:25px;padding:26px;background:#fff}.price-card.featured{border-color:rgba(111,84,232,.35);box-shadow:0 20px 60px rgba(111,84,232,.10);background:linear-gradient(180deg,#fff,#fbf9ff)}.price-badge{position:absolute;right:18px;top:18px;background:#ede9ff;color:#5c46c4;border-radius:999px;padding:6px 9px;font-size:10px;font-weight:900}.price-name{font-size:14px;font-weight:850;color:#5f5967}.price{font-size:39px;font-weight:900;letter-spacing:-.055em;margin:12px 0}.price small{font-size:13px;color:var(--muted);font-weight:600;letter-spacing:0}.list{list-style:none;margin:17px 0 0;padding:0;color:var(--muted);line-height:1.9;font-size:14px}.list li:before{content:"✓";color:var(--green);font-weight:900;margin-right:9px}.source-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:15px;margin-top:30px}.source-card{border:1px solid var(--line);border-radius:24px;padding:24px;background:rgba(255,255,255,.82);box-shadow:0 9px 30px rgba(31,26,44,.035)}.source-icon{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(145deg,#f0ecff,#fff4eb);font-weight:950;font-size:16px;margin-bottom:17px}.source-card h3{font-size:20px;letter-spacing:-.03em;margin:0 0 9px}.source-card p{margin:0;color:var(--muted);line-height:1.6}.source-tags{display:flex;flex-wrap:wrap;gap:7px;margin-top:15px}.source-tags span{font-size:11px;font-weight:800;padding:6px 9px;border-radius:999px;background:#f7f5f9;border:1px solid var(--line);color:#625b6b}.trust-row{display:flex;gap:9px;flex-wrap:wrap;margin-top:24px}.trust-pill{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:rgba(255,255,255,.72);padding:8px 11px;border-radius:999px;font-size:12px;font-weight:750;color:#625b6b}.trust-pill:before{content:"✓";color:var(--green);font-weight:950}.context-grid{display:grid;grid-template-columns:.9fr 1.1fr;gap:18px;align-items:stretch;margin-top:30px}.context-copy{border:1px solid var(--line);border-radius:24px;padding:26px;background:rgba(255,255,255,.80)}.context-copy h3{font-size:24px;letter-spacing:-.035em;margin:0 0 10px}.context-copy p{color:var(--muted);line-height:1.65;margin:0}.context-points{display:grid;gap:11px;margin-top:22px}.context-point{display:grid;grid-template-columns:28px 1fr;gap:10px;align-items:start;font-size:14px;line-height:1.5;color:#514a59}.context-point b{width:28px;height:28px;border-radius:9px;background:#f1edff;color:#6049c4;display:grid;place-items:center;font-size:12px}.context-packet{border:1px solid rgba(111,84,232,.20);border-radius:24px;padding:22px;background:linear-gradient(180deg,#fff,#faf8ff);box-shadow:0 16px 45px rgba(72,56,127,.08)}.packet-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:15px;border-bottom:1px solid var(--line)}.packet-title{font-size:13px;font-weight:900}.packet-state{font-size:10px;font-weight:900;color:#15795a;background:#eaf8f2;padding:6px 8px;border-radius:999px}.packet-row{display:grid;grid-template-columns:132px 1fr;gap:14px;padding:12px 0;border-bottom:1px solid var(--line);font-size:12px;line-height:1.5}.packet-row:last-of-type{border-bottom:0}.packet-key{font-weight:850;color:#817989}.packet-value{color:#3e3746;overflow-wrap:anywhere}.packet-warning{margin-top:14px;border:1px solid rgba(216,142,76,.24);background:#fff7ed;border-radius:14px;padding:12px 13px;color:#785532;font-size:12px;line-height:1.5}.unit-examples{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:16px}.unit-example{border:1px solid var(--line);border-radius:16px;padding:15px;background:rgba(255,255,255,.72)}.unit-example strong{display:block;font-size:17px;letter-spacing:-.02em;margin-bottom:4px}.unit-example span{color:var(--muted);font-size:12px;line-height:1.5;display:block}.faq-list{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:30px;align-items:start}.faq-item{border:1px solid var(--line);border-radius:20px;background:rgba(255,255,255,.82);box-shadow:0 7px 26px rgba(31,26,44,.03);overflow:hidden}.faq-item summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:19px 20px;font-size:15px;font-weight:850;color:#302b36;cursor:pointer}.faq-item summary::-webkit-details-marker{display:none}.faq-item summary:after{content:"+";display:grid;place-items:center;flex:0 0 auto;width:25px;height:25px;border-radius:50%;background:#f1edf8;color:#654dcc;font-size:17px;font-weight:800}.faq-item[open] summary:after{content:"–"}.faq-answer{padding:0 20px 19px;color:var(--muted);font-size:14px;line-height:1.65}.faq-answer p{margin:0}.faq-answer a{font-weight:800;color:#5f48c9}.section-index{display:inline-flex;align-items:center;gap:8px;margin-bottom:12px;font-size:11px;font-weight:950;letter-spacing:.12em;text-transform:uppercase;color:#6f54e8}.section-index:before{content:"";width:18px;height:2px;border-radius:999px;background:linear-gradient(90deg,var(--purple),var(--orange))}.clarity-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin-top:30px;padding:8px;border:1px solid rgba(111,84,232,.14);border-radius:24px;background:linear-gradient(135deg,rgba(255,255,255,.86),rgba(248,245,255,.86));box-shadow:0 18px 48px rgba(67,51,105,.07)}.clarity-item{position:relative;min-width:0;padding:16px 18px;display:grid;grid-template-columns:34px minmax(0,1fr);gap:12px;align-items:center;border-radius:17px}.clarity-item:not(:last-child):after{content:"";position:absolute;right:-1px;top:18px;bottom:18px;width:1px;background:linear-gradient(180deg,transparent,rgba(70,61,88,.13) 22%,rgba(70,61,88,.13) 78%,transparent)}.clarity-item b{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:linear-gradient(145deg,#28222f,#6f54e8);color:#fff;font-size:11px;box-shadow:0 7px 18px rgba(80,59,157,.18)}.clarity-item strong{display:block;font-size:14px;line-height:1.25;letter-spacing:-.015em;margin-bottom:4px}.clarity-item span{display:block;font-size:12px;line-height:1.42;color:var(--muted)}.step-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:28px}.step-card{border:1px solid var(--line);border-radius:22px;padding:21px;background:#fff;box-shadow:0 10px 30px rgba(31,26,44,.035)}.step-card .flow-num{margin-bottom:15px}.step-card h3{font-size:18px;margin:0 0 8px;letter-spacing:-.025em}.step-card p{font-size:13px;line-height:1.55;color:var(--muted);margin:0}.scope-note{margin-top:16px;border:1px solid rgba(111,84,232,.18);border-radius:20px;padding:18px 20px;background:linear-gradient(135deg,rgba(247,244,255,.92),rgba(255,250,246,.92));display:grid;grid-template-columns:auto 1fr;gap:12px 15px;align-items:start}.scope-note .scope-icon{width:34px;height:34px;border-radius:11px;background:#1c1922;color:#fff;display:grid;place-items:center;font-weight:900}.scope-note strong{display:block;margin-bottom:5px}.scope-note p{margin:0;color:var(--muted);font-size:13px;line-height:1.55}.boundary-grid{display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-top:28px}.boundary-card{border:1px solid var(--line);border-radius:24px;padding:24px;background:rgba(255,255,255,.84)}.boundary-card.good{border-color:rgba(21,143,103,.20);background:linear-gradient(180deg,#fff,#f6fcf9)}.boundary-card h3{font-size:20px;margin:0 0 14px}.boundary-list{display:grid;gap:10px}.boundary-row{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.5;color:var(--muted)}.boundary-row i{font-style:normal;flex:0 0 auto;width:22px;height:22px;border-radius:7px;display:grid;place-items:center;background:#f0edf4;color:#625b6b;font-size:11px;font-weight:950}.boundary-card.good .boundary-row i{background:#e8f7f1;color:#137957}.faq-groups{display:grid;gap:28px;margin-top:30px}.faq-group-title{display:flex;align-items:baseline;justify-content:space-between;gap:20px;margin-bottom:12px}.faq-group-title h3{margin:0;font-size:20px;letter-spacing:-.03em}.faq-group-title span{font-size:12px;color:var(--muted)}.faq-group .faq-list{margin-top:0}.pricing-explainer{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}.pricing-explainer div{border:1px solid var(--line);border-radius:16px;padding:13px 14px;background:rgba(255,255,255,.68);font-size:12px;line-height:1.45;color:var(--muted)}.pricing-explainer strong{display:block;color:#3f3946;margin-bottom:3px}.use-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:15px;margin-top:30px}.use-card{border:1px solid var(--line);border-radius:24px;padding:24px;background:linear-gradient(180deg,rgba(255,255,255,.92),rgba(250,248,255,.82));box-shadow:0 9px 30px rgba(31,26,44,.035)}.use-card h3{font-size:19px;letter-spacing:-.03em;margin:0 0 9px}.use-card p{margin:0;color:var(--muted);line-height:1.58}.example-prompt{margin-top:16px;border:1px solid rgba(111,84,232,.12);background:#f7f4ff;border-radius:14px;padding:12px 13px;font-size:12px;line-height:1.55;color:#51475c}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.12em;font-weight:900;color:#81788c;margin-bottom:12px}.compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-top:30px}.compare-card{border:1px solid var(--line);border-radius:24px;padding:25px;background:rgba(255,255,255,.86)}.compare-card.good{border-color:rgba(111,84,232,.24);background:linear-gradient(180deg,#fff,#faf8ff)}.compare-title{display:flex;align-items:center;gap:9px;font-size:15px;font-weight:900;margin-bottom:18px}.compare-dot{width:10px;height:10px;border-radius:50%;background:#b8b1bd}.compare-card.good .compare-dot{background:var(--purple);box-shadow:0 0 0 5px rgba(111,84,232,.10)}.compare-list{display:grid;gap:12px}.compare-row{display:flex;gap:11px;align-items:flex-start;color:var(--muted);font-size:14px;line-height:1.55}.compare-row strong{color:#3a3440}.compare-icon{flex:0 0 auto;width:24px;height:24px;border-radius:8px;display:grid;place-items:center;background:#f2eff4;font-size:12px;font-weight:900}.compare-card.good .compare-icon{background:#eeeaff;color:#5d47c7}.cta-band{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;border:1px solid rgba(111,84,232,.22);background:linear-gradient(135deg,rgba(255,255,255,.96),rgba(244,240,255,.92));border-radius:28px;padding:30px;box-shadow:0 18px 55px rgba(73,56,133,.08)}.cta-band h2{font-size:34px;margin:0 0 8px;letter-spacing:-.045em}.cta-band p{margin:0;color:var(--muted);line-height:1.55}.cta-band .actions{margin:0;justify-content:flex-end}.btn:focus-visible,.navlinks a:focus-visible,.faq-item summary:focus-visible{outline:3px solid rgba(111,84,232,.28);outline-offset:3px}.connect-hero{padding:72px 0 34px;text-align:center;max-width:850px;margin:0 auto}.connect-hero h1{font-size:clamp(46px,7vw,72px);line-height:.98;letter-spacing:-.06em;margin:18px 0}.connect-hero p{font-size:19px;color:var(--muted);line-height:1.55;max-width:690px;margin:0 auto}.setup-shell{max-width:850px;margin:0 auto 78px}.setup-main{border:1px solid rgba(111,84,232,.22);border-radius:30px;background:linear-gradient(145deg,#fff 0,#fbf9ff 60%,#fff8f3 100%);padding:34px;box-shadow:var(--shadow)}.setup-main h2{font-size:29px;letter-spacing:-.04em;margin:0 0 9px}.setup-main>p{color:var(--muted);line-height:1.55;margin:0}.setup-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:26px 0}.setup-step{background:rgba(255,255,255,.8);border:1px solid var(--line);border-radius:16px;padding:14px}.setup-step span{display:block;font-size:10px;color:#8c8494;font-weight:900;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}.setup-step strong{font-size:14px;line-height:1.35}.setup-cta{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.setup-note{font-size:12px;color:#817a89}.manual{margin-top:18px;border-top:1px solid var(--line);padding-top:18px}details summary{cursor:pointer;font-weight:800;color:#5b5563}.manual-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:13px}.field{background:#fff;border:1px solid var(--line);border-radius:13px;padding:12px}.field label{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:#8d8595;font-weight:900;margin-bottom:7px}.field code{font-size:11px;overflow-wrap:anywhere}.copybtn{margin-top:8px;border:1px solid var(--line);background:#fff;border-radius:10px;padding:8px 10px;font-size:11px;font-weight:800;cursor:pointer}.coming{margin-top:18px;border:1px dashed rgba(44,39,55,.20);border-radius:20px;padding:18px;display:flex;justify-content:space-between;gap:18px;align-items:center}.coming strong{display:block}.coming span{font-size:13px;color:var(--muted)}footer{padding:34px 0 48px;color:#827b8a;font-size:13px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}.legal-links a{text-decoration:none}.support-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:15px;margin-bottom:70px}.guide-grid{display:grid;gap:18px;margin-top:28px}.guide-card{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(280px,.95fr);gap:24px;align-items:center;border:1px solid var(--line);border-radius:26px;background:rgba(255,255,255,.88);padding:22px;box-shadow:0 12px 38px rgba(31,26,44,.05)}.guide-card.reverse{grid-template-columns:minmax(280px,.95fr) minmax(0,1.05fr)}.guide-card h3{font-size:22px;letter-spacing:-.035em;margin:0 0 9px}.guide-card p{color:var(--muted);line-height:1.6;margin:0}.guide-num{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:11px;background:#1c1922;color:#fff;font-size:12px;font-weight:900;margin-bottom:14px}.guide-shot{position:relative;border:1px solid var(--line);border-radius:18px;overflow:hidden;background:#f6f4f8;box-shadow:0 12px 35px rgba(31,26,44,.08)}.guide-shot img{display:block;width:100%;height:auto}.guide-callout{position:absolute;border:3px solid #7d63ef;border-radius:14px;box-shadow:0 0 0 9999px rgba(19,16,25,.05),0 0 0 5px rgba(125,99,239,.12);pointer-events:none}.guide-callout.oauth{left:4.5%;right:4.5%;top:50.5%;height:12.5%}.guide-callout.allow{right:1.7%;top:26.8%;width:16.5%;height:17.5%}.guide-callout.tools{right:0.8%;top:35%;width:34.7%;height:34%}.tiny-pill{display:inline-flex;align-items:center;gap:7px;background:#f0ecff;color:#5e49c4;border-radius:999px;padding:7px 10px;font-size:11px;font-weight:850;margin-top:13px}.why-write{margin-top:18px;padding:15px 16px;border-radius:16px;background:#f8f6fb;border:1px solid var(--line);font-size:13px;color:#655f6d;line-height:1.55}.why-write strong{color:#302b36}.troubleshoot{margin-top:24px;border:1px dashed rgba(44,39,55,.2);border-radius:20px;padding:18px;background:rgba(255,255,255,.55)}.troubleshoot h3{margin:0 0 8px;font-size:18px}.troubleshoot p{margin:0;color:var(--muted);line-height:1.55}.guide-status{display:flex;gap:8px;flex-wrap:wrap;margin:17px 0 0}.guide-status span{font-size:11px;font-weight:800;padding:7px 10px;border-radius:999px;background:#eef8f4;color:#147c5b;border:1px solid rgba(20,124,91,.12)}@media(max-width:900px){.clarity-strip{grid-template-columns:repeat(3,minmax(0,1fr));padding:7px}.clarity-item{padding:15px 14px;grid-template-columns:32px minmax(0,1fr);gap:10px}.clarity-item b{width:32px;height:32px}.context-grid{grid-template-columns:1fr}.unit-examples{grid-template-columns:1fr}.guide-card,.guide-card.reverse{grid-template-columns:1fr}.guide-card.reverse .guide-copy{order:1}.guide-card.reverse .guide-shot{order:2}.hero-grid{grid-template-columns:1fr;gap:40px}.hero{padding-top:60px}.demo{max-width:650px}.workflow{grid-template-columns:1fr}.flow-arrow{transform:rotate(90deg);padding:4px}.pricing{grid-template-columns:1fr}.feature-grid,.support-grid,.source-grid,.use-grid,.compare-grid,.boundary-grid{grid-template-columns:1fr}.step-grid{grid-template-columns:1fr 1fr}.clarity-strip{grid-template-columns:1fr 1fr}.pricing-explainer{grid-template-columns:1fr}.cta-band{grid-template-columns:1fr}.cta-band .actions{justify-content:flex-start}.setup-steps{grid-template-columns:1fr 1fr}}@media(max-width:650px){.packet-row{grid-template-columns:1fr;gap:4px}.context-copy,.context-packet{padding:20px;border-radius:20px}html,body{max-width:100%;overflow-x:hidden}.wrap{padding:0 16px;width:100%}nav{height:68px;gap:10px}.brand{font-size:19px;min-width:0}.brand img{width:30px;height:30px}.navlinks{gap:8px;flex:0 0 auto}.navlinks a.hide-sm{display:none}.navlinks>a:not(.btn){display:none}.mobile-menu{display:block}.navlinks{gap:7px}.navlinks .mobile-menu-panel a{display:block}.navlinks .btn{min-height:44px;padding:10px 14px;font-size:12px;white-space:nowrap}.hero{padding:42px 0 52px}.hero-grid{gap:30px}.hero h1{font-size:clamp(40px,12vw,50px);line-height:.98;letter-spacing:-.058em;margin:16px 0 18px}.hero p{font-size:16px;line-height:1.55}.actions{display:grid;grid-template-columns:1fr;gap:10px;margin-top:24px}.actions .btn{width:100%;min-height:48px}.platforms{gap:7px}.platform{font-size:11px}.demo{width:100%;max-width:100%}.demo-window{border-radius:22px}.chat{padding:16px;gap:12px}.chat-row{max-width:94%;font-size:12px;padding:11px 13px}.tool-card{width:96%;padding:12px}.section{padding:56px 0}.section-head{display:block;margin-bottom:24px}.section h2{font-size:34px;margin-bottom:12px;letter-spacing:-.045em}.section .sub{font-size:15px}.feature-grid,.faq-list,.compare-grid,.boundary-grid,.step-grid{grid-template-columns:1fr}.clarity-strip{grid-template-columns:1fr;padding:7px}.clarity-item{padding:13px 14px}.clarity-item:not(:last-child):after{right:14px;left:14px;top:auto;bottom:0;width:auto;height:1px;background:linear-gradient(90deg,transparent,rgba(70,61,88,.13) 18%,rgba(70,61,88,.13) 82%,transparent)}.scope-note{grid-template-columns:1fr}.scope-note .scope-icon{margin-bottom:2px}.faq-group-title{display:block}.faq-group-title span{display:block;margin-top:4px}.cta-band{padding:22px;border-radius:22px}.cta-band h2{font-size:29px}.cta-band .actions{display:grid;width:100%}.card,.price-card,.flow-box{border-radius:20px;padding:20px}.pricing{gap:12px}.price{font-size:36px}.setup-shell{margin-bottom:54px}.setup-main{padding:19px;border-radius:23px}.setup-main h2{font-size:25px}.setup-steps,.manual-grid{grid-template-columns:1fr}.setup-step{padding:13px}.setup-cta{display:grid;grid-template-columns:1fr;gap:9px}.setup-cta .btn{width:100%;min-height:48px}.connect-hero{padding:44px 0 28px;text-align:left}.connect-hero h1{font-size:clamp(38px,11vw,48px);line-height:1}.connect-hero p{font-size:16px;margin-left:0}.guide-grid{gap:14px}.guide-card,.guide-card.reverse{padding:15px;border-radius:20px;gap:16px}.guide-card h3{font-size:19px}.guide-shot{border-radius:14px}.manual{margin-top:15px;padding-top:15px}.field code{font-size:10px}.copybtn{min-height:42px}.coming{display:block;padding:15px;border-radius:17px}.coming .btn{margin-top:13px;width:100%;min-height:46px}.support-grid{margin-bottom:54px}footer{padding:28px 0 34px;display:grid;gap:10px}.legal-links{line-height:1.8}details summary{line-height:1.4}}

/* Unified full-canvas layout · 2026-09-17 */
html,body{min-height:100%;}
body{min-height:100svh;background:radial-gradient(circle at 76% -8%,rgba(108,118,255,.17),transparent 39%),radial-gradient(circle at 5% 7%,rgba(156,118,255,.10),transparent 30%),linear-gradient(180deg,#fbfaff 0%,#f8f7fc 52%,#f6f4fb 100%);background-attachment:fixed}
nav{background:transparent!important;border-bottom-color:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important}
.home-nav{background:transparent!important}
.experience-home,.experience-hero{background:transparent!important}
.home-only{min-height:100svh}
.home-only .experience-hero{min-height:100svh;display:flex;align-items:center}
@media(min-width:901px){
  .home-only .experience-hero{padding:88px 0 42px}
  .home-only .home-inner{width:min(100%,1360px);max-width:1360px;margin:0 auto;padding-left:34px;padding-right:34px}
  .home-only .experience-copy{margin-bottom:24px}
  .home-only .experience-hero h1{font-size:clamp(64px,5vw,84px);line-height:.94;max-width:none}
  .home-only .experience-lede{font-size:18px;max-width:880px}
  .home-only .sim-shell{max-width:1180px;margin-top:26px}
  .home-only .experience-hero-cta{margin-top:20px}
}
@media(min-width:651px) and (max-width:900px){
  .home-only .experience-hero{padding-top:92px;padding-bottom:40px}
  .home-only .sim-shell{max-width:none}
}
@media(max-width:650px){
  body{background-attachment:scroll}
  .home-only .experience-hero{min-height:100svh;align-items:flex-start}
}

@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.btn{transition:none}}@media(max-width:380px){.wrap{padding:0 13px}.brand span{max-width:105px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.navlinks .btn{padding:9px 11px}.hero h1{font-size:38px}.section h2{font-size:31px}.connect-hero h1{font-size:37px}.setup-main{padding:16px}.card,.price-card,.flow-box{padding:17px}}
.hero-trust-links{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;font-size:12px;color:#766f7d}.hero-trust-links a{font-weight:750;text-underline-offset:3px}.before-after{padding:16px 18px 0;display:grid;gap:8px}.ba-row{display:flex;align-items:flex-start;gap:10px;padding:11px 12px;border-radius:14px;font-size:12px;line-height:1.45}.ba-row.before{background:#f4f1ec;color:#6f6a78}.ba-row.after{background:#f2eff7;color:#4a3f76}.ba-tag{flex:0 0 auto;font-size:9px;font-weight:900;letter-spacing:.09em;text-transform:uppercase;border:1px solid currentColor;border-radius:999px;padding:3px 6px;opacity:.8}.ba-row strong{color:var(--ink)}.ba-arrow{text-align:center;color:#9a92a5;font-size:11px;font-weight:800;letter-spacing:.04em}.fd-source{max-width:430px;overflow:hidden;text-overflow:ellipsis}.fd-security{display:inline-flex;align-items:center;gap:6px;padding:6px 9px;border-radius:999px;background:#e8f7f1;color:#117557;font-size:10px;font-weight:900}.founder-lock{max-width:520px;margin:70px auto;padding:28px;border:1px solid var(--line);border-radius:24px;background:#fff;box-shadow:var(--shadow)}.founder-lock h1{margin:10px 0 8px;font-size:34px;letter-spacing:-.04em}.founder-lock p{color:var(--muted);line-height:1.6}.founder-lock label{display:block;font-size:12px;font-weight:850;margin:18px 0 7px}.founder-lock input{width:100%;border:1px solid var(--line);border-radius:12px;padding:12px 13px;font:inherit}.founder-lock .actions{margin-top:18px}
/* Interactive homepage experience */
.experience-home{width:100vw;position:relative;left:50%;margin-left:-50vw;overflow:hidden}.home-only+footer{display:none}.experience-home .home-inner{max-width:1280px;margin:0 auto;padding-left:28px;padding-right:28px}.experience-hero{min-height:100svh;position:relative;margin-top:0;padding:112px 0 58px;background:radial-gradient(circle at 18% 4%,rgba(111,84,232,.18),transparent 28%),radial-gradient(circle at 88% 16%,rgba(76,125,255,.13),transparent 25%),linear-gradient(180deg,#fbfaf8 0%,#f7f5fb 100%)}.experience-hero:after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:linear-gradient(90deg,transparent,rgba(111,84,232,.20),transparent)}.experience-copy{text-align:left;max-width:1180px;margin:0 0 28px}.experience-kicker{display:inline-flex;align-items:center;gap:8px;padding:7px 11px;border:1px solid rgba(111,84,232,.17);border-radius:999px;background:rgba(255,255,255,.72);font-size:11px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:#604bc0}.experience-kicker:before{content:"";width:7px;height:7px;border-radius:50%;background:#775cf2;box-shadow:0 0 0 5px rgba(119,92,242,.10)}.experience-hero h1{margin:20px 0 18px;font-size:clamp(52px,5.4vw,78px);line-height:.94;letter-spacing:-.072em;max-width:none;white-space:nowrap}.experience-hero h1 span{background:linear-gradient(118deg,#5e47dd 8%,#7f63ef 46%,#4d7df0 92%);-webkit-background-clip:text;background-clip:text;color:transparent}.experience-lede{font-size:18px;line-height:1.55;color:#6e6877;max-width:720px;margin:0}.sim-shell{position:relative;margin:30px 0 0;border:1px solid rgba(59,47,92,.13);border-radius:30px;background:rgba(255,255,255,.91);box-shadow:0 32px 90px rgba(55,43,95,.14);overflow:hidden;max-width:1180px}.sim-shell:before{content:"";position:absolute;inset:-40% 38% 55% -12%;background:radial-gradient(circle,rgba(115,87,236,.14),transparent 68%);pointer-events:none}.sim-tabs{position:relative;display:flex;gap:7px;align-items:center;padding:14px 16px;border-bottom:1px solid rgba(56,47,73,.09);overflow:auto;background:rgba(250,249,252,.83);scrollbar-width:none}.sim-tabs::-webkit-scrollbar{display:none}.sim-tab{border:1px solid transparent;background:transparent;color:#736c7d;border-radius:999px;padding:9px 13px;font:inherit;font-size:12px;font-weight:850;cursor:pointer;white-space:nowrap}.sim-tab:hover{background:#fff;color:#3e3747}.sim-tab.active{background:#1d1924;color:#fff;box-shadow:0 8px 22px rgba(29,25,36,.14)}.sim-meta{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center;padding:20px 22px}.sim-source-label{font-size:10px;text-transform:uppercase;letter-spacing:.12em;font-weight:900;color:#958d9e}.sim-source-name{display:block;margin-top:4px;font-size:17px;font-weight:900;letter-spacing:-.02em}.sim-url{display:block;margin-top:5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#81798a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:720px}.sim-actions{display:flex;gap:8px}.sim-actions button{font:inherit;cursor:pointer}.sim-run{border:0;border-radius:999px;padding:11px 15px;background:linear-gradient(135deg,#6f54e8,#587ff1);color:#fff;font-size:12px;font-weight:900;box-shadow:0 10px 25px rgba(91,72,209,.20)}.sim-reset{border:1px solid rgba(50,44,61,.12);border-radius:999px;padding:10px 13px;background:#fff;color:#5e5867;font-size:12px;font-weight:850}.sim-grid{position:relative;display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:0 22px 22px}.sim-chat-user{align-self:flex-end;max-width:88%;margin-left:auto;border-radius:18px 18px 6px 18px;background:#201b27;color:#fff;padding:12px 14px;box-shadow:0 8px 22px rgba(32,27,39,.09)}.sim-chat-user span,.sim-chat-speaker{display:block;margin-bottom:5px;font-size:9px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.sim-chat-user span{color:#c9c1d2}.sim-chat-user p{margin:0;font-size:12px;line-height:1.5}.sim-chat-speaker{color:#756d7d}.sim-panel-head .sim-state{display:none}.sim-panel-sub{font-weight:650}.sim-tool{align-self:flex-start;width:min(92%,420px);box-shadow:0 6px 18px rgba(91,72,209,.06)}.sim-panel{min-height:340px;border-radius:22px;padding:18px;border:1px solid rgba(49,43,62,.10);display:flex;flex-direction:column;overflow:hidden}.sim-panel.without{background:linear-gradient(180deg,#f7f7f8,#f1f0f2)}.sim-panel.with{background:linear-gradient(155deg,#faf9ff 0%,#f4f1ff 48%,#eef5ff 100%);border-color:rgba(111,84,232,.18);box-shadow:inset 0 0 0 1px rgba(255,255,255,.55)}.sim-panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-bottom:14px;border-bottom:1px solid rgba(48,42,59,.09)}.sim-panel-title{font-size:13px;font-weight:900;letter-spacing:-.01em}.sim-panel-sub{display:block;margin-top:3px;color:#8b8492;font-size:10px;font-weight:700}.sim-state{flex:0 0 auto;border-radius:999px;padding:5px 8px;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;background:#e7e5e9;color:#77717d}.sim-state.reading{background:#eee9ff;color:#644bc9}.sim-state.failed{background:#eeecee;color:#736c78}.sim-state.loaded{background:#e8f8f1;color:#14795a}.sim-body{display:flex;flex-direction:column;gap:12px;padding-top:16px;flex:1}.sim-thinking{display:grid;gap:8px}.sim-line{height:8px;border-radius:999px;background:rgba(111,102,122,.13);position:relative;overflow:hidden}.sim-line:nth-child(1){width:86%}.sim-line:nth-child(2){width:72%}.sim-line:nth-child(3){width:58%}.sim-line.live:after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.8),transparent);animation:sim-shimmer 1s infinite}.sim-tool{display:none;padding:12px 13px;border:1px solid rgba(111,84,232,.16);border-radius:15px;background:rgba(255,255,255,.82);font-size:11px;font-weight:850;color:#5f49c4}.sim-tool.show{display:flex;align-items:center;justify-content:space-between;gap:10px;animation:sim-rise .28s ease}.sim-tool i{font-style:normal;color:#16805f;background:#e8f8f1;border-radius:999px;padding:4px 7px;font-size:9px}.sim-answer{display:none;border-radius:16px;padding:14px 15px;background:rgba(255,255,255,.82);color:#48424f;font-size:12px;line-height:1.55}.sim-answer.show{display:block;animation:sim-rise .32s ease}.sim-answer strong{color:#29242f}.sim-answer ul{margin:9px 0 0;padding-left:17px}.sim-answer li{margin:5px 0}.sim-fail{background:rgba(255,255,255,.70)}.sim-example-tag{display:inline-flex;margin-bottom:7px;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#857d8d}.sim-conclusion{margin:0 22px 22px;border-radius:18px;padding:15px 17px;background:#191620;color:#fff;text-align:center;font-size:14px;letter-spacing:-.01em}.sim-conclusion strong{color:#b9a9ff}.sim-conclusion.show{animation:sim-rise .35s ease}.experience-hero-cta{display:flex;align-items:center;justify-content:flex-start;gap:12px;flex-wrap:wrap;margin-top:24px}.experience-hero-cta .micro{margin:0}.story-bridge{padding:86px 0;background:#fff}.story-bridge-grid{display:grid;grid-template-columns:.72fr 1.28fr;gap:60px;align-items:start}.story-eyebrow{font-size:11px;font-weight:950;text-transform:uppercase;letter-spacing:.14em;color:#7258df}.story-bridge h2{margin:10px 0 0;font-size:clamp(36px,5vw,58px);line-height:1;letter-spacing:-.055em}.story-flow{display:grid;gap:0;border:1px solid rgba(52,45,66,.10);border-radius:24px;overflow:hidden;background:#fbfafc;box-shadow:0 18px 55px rgba(38,30,62,.06)}.story-flow-row{display:grid;grid-template-columns:52px 1fr;gap:14px;padding:19px 20px;border-bottom:1px solid rgba(52,45,66,.08);align-items:start}.story-flow-row:last-child{border-bottom:0}.story-flow-row b{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:#1d1924;color:#fff;font-size:11px}.story-flow-row strong{display:block;font-size:15px}.story-flow-row span{display:block;margin-top:4px;color:#77707f;font-size:12px;line-height:1.5}.source-experience{padding:90px 0;background:linear-gradient(145deg,#1c1823 0%,#242033 54%,#1e2439 100%);color:#fff}.source-head{display:grid;grid-template-columns:1fr .9fr;gap:50px;align-items:end;margin-bottom:32px}.source-head h2,.usecase-head h2,.proof-head h2,.home-pricing-head h2{font-size:clamp(40px,5.3vw,64px);line-height:.98;letter-spacing:-.058em;margin:8px 0 0}.source-head p{color:#bbb4c4;line-height:1.6;margin:0}.source-explorer{display:grid;grid-template-columns:.9fr 1.1fr;gap:16px}.source-buttons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.source-button{border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.045);color:#d8d2df;border-radius:16px;padding:15px 16px;text-align:left;font:inherit;cursor:pointer;display:flex;align-items:center;gap:11px;transition:transform .16s,background .16s,border-color .16s}.source-button:hover{transform:translateY(-1px);background:rgba(255,255,255,.075)}.source-button.active{background:linear-gradient(135deg,rgba(111,84,232,.31),rgba(78,121,235,.20));border-color:rgba(151,128,255,.42);color:#fff}.source-glyph{width:34px;height:34px;border-radius:11px;background:rgba(255,255,255,.09);display:grid;place-items:center;font-size:12px;font-weight:950}.source-button strong{font-size:13px}.source-preview{min-height:378px;border:1px solid rgba(255,255,255,.10);border-radius:24px;padding:25px;background:linear-gradient(160deg,rgba(255,255,255,.09),rgba(255,255,255,.035));box-shadow:0 24px 70px rgba(0,0,0,.18);display:flex;flex-direction:column}.source-preview-top{display:flex;align-items:center;justify-content:space-between;gap:14px}.source-preview-top span{font-size:10px;text-transform:uppercase;letter-spacing:.12em;font-weight:900;color:#a99cdd}.source-public-pill{border:1px solid rgba(255,255,255,.10);border-radius:999px;padding:6px 8px;color:#beb7c8;font-size:9px;font-weight:850}.source-preview h3{font-size:27px;letter-spacing:-.04em;margin:26px 0 12px}.source-preview-question{font-size:17px;line-height:1.5;color:#fff;max-width:640px}.source-mini-result{margin-top:auto;padding:16px;border-radius:17px;background:rgba(255,255,255,.07);color:#d2ccd8;font-size:12px;line-height:1.55}.source-mini-result strong{display:block;color:#fff;margin-bottom:5px}.source-preview-action{margin-top:15px;display:flex;align-items:center;gap:10px}.source-preview-action button{border:0;border-radius:999px;padding:10px 13px;background:#fff;color:#201b27;font:inherit;font-size:11px;font-weight:900;cursor:pointer}.source-preview-note{font-size:10px;color:#9f97aa}.usecase-experience{padding:96px 0;background:radial-gradient(circle at 90% 10%,rgba(94,126,241,.13),transparent 27%),#f7f5fb}.usecase-head{max-width:820px;margin-bottom:30px}.usecase-head p,.proof-head p,.home-pricing-head p{color:#746d7c;line-height:1.6;max-width:650px}.usecase-stage{display:grid;grid-template-columns:.72fr 1.28fr;gap:16px}.usecase-menu{display:grid;gap:8px;align-content:start}.usecase-option{border:1px solid rgba(50,44,63,.10);border-radius:17px;padding:15px 16px;background:rgba(255,255,255,.72);font:inherit;text-align:left;cursor:pointer;color:#716a79}.usecase-option strong{display:block;color:#2a2530;font-size:13px}.usecase-option span{display:block;margin-top:3px;font-size:11px;line-height:1.4}.usecase-option.active{border-color:rgba(111,84,232,.28);background:#fff;box-shadow:0 12px 34px rgba(72,56,125,.08)}.usecase-display{border:1px solid rgba(52,45,66,.11);border-radius:27px;background:#fff;box-shadow:0 24px 70px rgba(53,43,86,.09);overflow:hidden}.usecase-browser{height:44px;border-bottom:1px solid rgba(52,45,66,.08);display:flex;align-items:center;gap:6px;padding:0 15px;background:#faf9fb}.usecase-browser i{width:8px;height:8px;border-radius:50%;background:#d9d4df}.usecase-browser span{margin-left:8px;font-size:10px;font-weight:850;color:#7b7483}.usecase-chat{padding:24px}.usecase-user{margin-left:auto;max-width:76%;border-radius:17px 17px 6px 17px;background:#1f1b25;color:#fff;padding:13px 15px;font-size:13px;line-height:1.5}.usecase-result{margin-top:15px;max-width:88%;border-radius:6px 18px 18px 18px;background:#f3f0f9;padding:16px;color:#494250;font-size:12px;line-height:1.55}.usecase-result-label{display:flex;align-items:center;gap:7px;font-size:9px;text-transform:uppercase;letter-spacing:.09em;font-weight:900;color:#6652c6;margin-bottom:8px}.usecase-result ul{padding-left:17px;margin:8px 0 0}.usecase-result li{margin:5px 0}.proof-experience{padding:94px 0;background:#fff}.proof-head{display:flex;justify-content:space-between;gap:40px;align-items:end;margin-bottom:30px}.proof-head>div{max-width:720px}.proof-truth{max-width:390px;border-left:2px solid #7157e5;padding-left:16px;color:#6f6877;font-size:12px;line-height:1.55}.proof-truth strong{display:block;color:#2f2935;margin-bottom:3px}.proof-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.proof-slot{border:1px solid rgba(52,45,66,.10);border-radius:23px;padding:19px;background:linear-gradient(180deg,#fff,#faf9fc)}.proof-slot-head{display:flex;justify-content:space-between;gap:10px;align-items:center}.proof-slot-head strong{font-size:13px}.proof-slot-head span{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#7460d4;background:#f0edff;padding:5px 7px;border-radius:999px}.proof-shot{height:180px;border-radius:16px;margin-top:15px;background:linear-gradient(145deg,#f0eef3,#f8f7fa);border:1px solid rgba(52,45,66,.07);padding:15px;display:grid;align-content:center;gap:9px}.proof-shot-line{height:8px;border-radius:999px;background:#ded9e4}.proof-shot-line:nth-child(1){width:80%}.proof-shot-line:nth-child(2){width:62%}.proof-shot-line:nth-child(3){width:72%}.proof-slot p{font-size:11px;line-height:1.5;color:#7b7483;margin:13px 0 0}.proof-slot p strong{color:#35303b}.home-pricing{padding:94px 0;background:linear-gradient(180deg,#f7f5fb,#fbfaf8)}.home-pricing-head{display:flex;justify-content:space-between;gap:40px;align-items:end;margin-bottom:28px}.home-pricing-grid{display:grid;grid-template-columns:.86fr 1.06fr 1fr;gap:13px}.home-price-card{position:relative;border:1px solid rgba(52,45,66,.10);border-radius:24px;padding:23px;background:#fff}.home-price-card.featured{border-color:rgba(111,84,232,.30);box-shadow:0 22px 60px rgba(82,64,150,.10)}.home-price-name{font-size:12px;font-weight:900;color:#6f6877}.home-price{font-size:38px;font-weight:950;letter-spacing:-.055em;margin:11px 0 15px}.home-price small{font-size:12px;font-weight:700;color:#7c7584;letter-spacing:0}.home-price-card ul{list-style:none;margin:0;padding:0;color:#6f6877;font-size:12px;line-height:1.8}.home-price-card li:before{content:"✓";color:#16805f;font-weight:900;margin-right:8px}.home-price-card .actions{margin-top:18px}.unit-explain{margin-top:15px;border:1px solid rgba(111,84,232,.13);border-radius:18px;padding:15px 17px;background:rgba(255,255,255,.63);font-size:11px;color:#756e7d;line-height:1.55}.unit-explain strong{color:#332e3a}.trust-finish{padding:74px 0 88px;background:#17141c;color:#fff}.trust-strip{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:34px}.trust-chip{border:1px solid rgba(255,255,255,.10);border-radius:999px;padding:8px 11px;background:rgba(255,255,255,.05);font-size:10px;font-weight:850;color:#d8d2dd}.trust-finish-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:45px;align-items:end}.trust-finish h2{font-size:clamp(39px,5.5vw,68px);line-height:.97;letter-spacing:-.06em;margin:0}.trust-finish p{color:#aaa2b0;line-height:1.6;margin:12px 0 0;max-width:650px}.trust-finish .actions{justify-content:flex-end;margin:0}.trust-finish .btn.alt{background:#fff;color:#1c1922}.reveal{opacity:0;transform:translateY(22px);transition:opacity .6s ease,transform .6s ease}.reveal.in{opacity:1;transform:none}@keyframes sim-shimmer{to{transform:translateX(100%)}}@keyframes sim-rise{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
@media(max-width:1080px){.navlinks{gap:14px}.navlinks .hide-sm{font-size:12px}}
@media(max-width:900px){.experience-home .home-inner{padding-left:22px;padding-right:22px}.sim-grid,.story-bridge-grid,.source-head,.source-explorer,.usecase-stage,.trust-finish-grid{grid-template-columns:1fr}.proof-head,.home-pricing-head{display:block}.proof-truth{margin-top:16px}.proof-grid{grid-template-columns:1fr}.home-pricing-grid{grid-template-columns:1fr}.trust-finish .actions{justify-content:flex-start;margin-top:22px}.source-buttons{grid-template-columns:repeat(5,minmax(140px,1fr));overflow:auto;padding-bottom:4px;scrollbar-width:none}.source-buttons::-webkit-scrollbar{display:none}}
@media(max-width:650px){.experience-hero h1{white-space:normal}.experience-home .home-inner{padding-left:16px;padding-right:16px}.experience-hero{padding:48px 0 48px}.experience-copy{margin-bottom:24px}.experience-hero h1{font-size:clamp(44px,14vw,60px);line-height:.93}.experience-lede{font-size:15px}.sim-shell{margin-top:28px;border-radius:22px}.sim-tabs{padding:11px 12px}.sim-meta{grid-template-columns:1fr;padding:16px}.sim-url{max-width:100%}.sim-actions{display:grid;grid-template-columns:1fr auto}.sim-run{width:100%}.sim-question{margin:0 16px 15px;padding:14px}.sim-grid{padding:0 16px 16px;gap:10px}.sim-panel{min-height:290px;padding:15px}.sim-conclusion{margin:0 16px 16px}.story-bridge,.source-experience,.usecase-experience,.proof-experience,.home-pricing{padding:66px 0}.story-bridge-grid{gap:28px}.story-bridge h2,.source-head h2,.usecase-head h2,.proof-head h2,.home-pricing-head h2{font-size:36px}.source-head{gap:18px}.source-explorer{gap:12px}.source-buttons{grid-template-columns:repeat(10,minmax(126px,1fr));margin-right:-16px}.source-preview{min-height:320px;padding:19px}.source-preview h3{font-size:23px}.usecase-stage{gap:11px}.usecase-menu{display:flex;overflow:auto;margin-right:-16px;padding-bottom:4px}.usecase-option{min-width:220px}.usecase-chat{padding:17px}.usecase-user{max-width:92%}.usecase-result{max-width:96%}.proof-grid{gap:10px}.trust-finish{padding:62px 0 70px}.trust-finish h2{font-size:42px}.experience-hero-cta{display:grid}.experience-hero-cta .btn{width:100%}.experience-hero-cta .micro{text-align:center}.reveal{opacity:1;transform:none}}
/* Mobile homepage polish · 2026-09-17 */
@media(max-width:650px){
  html{scroll-padding-top:72px}
  body{background:var(--paper)}
  .wrap{padding-left:max(14px,env(safe-area-inset-left));padding-right:max(14px,env(safe-area-inset-right))}
  nav{height:64px;gap:8px}
  .brand{font-size:18px;gap:8px}
  .brand img{width:29px;height:29px}
  .navlinks{gap:6px}
  .mobile-menu summary{width:40px;height:40px;padding:0;display:grid;place-items:center;font-size:0;border-radius:12px;background:#fff}
  .mobile-menu summary:after{content:"☰";font-size:16px;line-height:1;color:#4e4857}
  .mobile-menu-panel{top:46px;right:-92px;min-width:210px;border-radius:16px}
  .navlinks .btn{min-height:40px;padding:9px 12px;font-size:11px}
  .experience-home .home-inner{padding-left:18px;padding-right:18px}
  .home-nav{left:max(14px,env(safe-area-inset-left));right:max(14px,env(safe-area-inset-right));width:auto;transform:none}
  .experience-hero{margin-top:0;padding:92px 0 38px}
  .experience-copy{text-align:left;margin:0 0 18px}
  .experience-kicker{font-size:9px;padding:6px 9px;letter-spacing:.05em}
  .experience-hero h1{margin:14px 0 14px;font-size:clamp(37px,10.7vw,44px);line-height:.98;letter-spacing:-.055em;max-width:10.5ch}
  .experience-hero h1 span{display:block}
  .experience-lede{font-size:15px;line-height:1.55;margin:0;max-width:34rem}
  .experience-hero-cta{display:grid;grid-template-columns:1fr;gap:9px;margin-top:20px}
  .experience-hero-cta .btn{width:100%;min-height:48px}
  .experience-hero-cta .micro{text-align:left;font-size:11px;line-height:1.45}
  .sim-shell{margin-top:24px;border-radius:20px;box-shadow:0 18px 48px rgba(55,43,95,.12)}
  .sim-tabs{padding:9px 10px;gap:5px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch}
  .sim-tab{padding:8px 11px;font-size:11px;scroll-snap-align:start}
  .sim-meta{padding:14px;gap:12px}
  .sim-source-name{font-size:15px}
  .sim-url{font-size:10px}
  .sim-actions{grid-template-columns:minmax(0,1fr) auto;gap:7px}
  .sim-run,.sim-reset{min-height:42px}
  .sim-grid{padding:0 14px 14px;gap:9px}
  .sim-panel{min-height:0;padding:14px;border-radius:17px}
  .sim-panel-head{padding-bottom:11px}
  .sim-chat-user{max-width:94%;padding:10px 11px;border-radius:15px 15px 5px 15px}
  .sim-chat-user p{font-size:11px}
  .sim-body{padding-top:12px;gap:10px}
  .sim-thinking{gap:6px}
  .sim-line{height:6px}
  .sim-answer{padding:12px 13px;font-size:11px}
  .sim-tool{padding:10px 11px}
  .sim-conclusion{margin:0 14px 14px;padding:13px;font-size:12px;border-radius:14px}
  .story-bridge,.source-experience,.usecase-experience,.proof-experience,.home-pricing{padding:52px 0}
  .story-bridge-grid{gap:22px}
  .story-bridge h2,.source-head h2,.usecase-head h2,.proof-head h2,.home-pricing-head h2{font-size:clamp(31px,9vw,36px);line-height:1.02}
  .story-flow{border-radius:20px}
  .story-flow-row{grid-template-columns:36px 1fr;gap:11px;padding:15px}
  .story-flow-row b{width:32px;height:32px}
  .source-head{gap:12px;margin-bottom:22px}
  .source-head p,.usecase-head p,.proof-head p,.home-pricing-head p{font-size:14px;line-height:1.55}
  .source-explorer{gap:14px}
  .source-buttons{display:flex;overflow-x:auto;gap:8px;margin:0 -18px;padding:0 18px 4px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch}
  .source-button{flex:0 0 auto;min-width:0;padding:9px 11px;border-radius:999px;gap:7px;scroll-snap-align:start}
  .source-glyph{width:26px;height:26px;border-radius:8px;font-size:10px}
  .source-button strong{font-size:11px;white-space:nowrap}
  .source-preview{min-height:0;padding:17px;border-radius:20px}
  .source-preview-top{align-items:flex-start}
  .source-preview h3{font-size:22px;margin:18px 0 10px}
  .source-preview-question{font-size:15px}
  .source-mini-result{margin-top:22px;padding:14px}
  .source-preview-action{align-items:flex-start;flex-direction:column}
  .source-preview-action button{width:100%;min-height:42px}
  .usecase-head{margin-bottom:22px}
  .usecase-stage{gap:12px}
  .usecase-menu{display:flex;overflow-x:auto;gap:8px;margin:0 -18px;padding:0 18px 4px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch}
  .usecase-option{min-width:180px;padding:12px 13px;scroll-snap-align:start}
  .usecase-display{border-radius:20px}
  .usecase-browser{height:38px}
  .usecase-chat{padding:14px}
  .usecase-user{max-width:94%;padding:11px 12px;font-size:12px}
  .usecase-result{max-width:100%;padding:13px;font-size:11px}
  .proof-head,.home-pricing-head{margin-bottom:22px}
  .proof-truth{margin-top:14px;font-size:11px}
  .proof-grid{display:flex;overflow-x:auto;gap:10px;margin:0 -18px;padding:0 18px 6px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch}
  .proof-slot{flex:0 0 82%;padding:15px;border-radius:18px;scroll-snap-align:start}
  .proof-shot{height:130px;margin-top:12px}
  .home-pricing-grid{gap:10px}
  .home-price-card{padding:18px;border-radius:19px}
  .home-price{font-size:34px;margin:9px 0 12px}
  .home-price-card .actions{margin-top:15px}
  .unit-explain{padding:13px 14px}
  .trust-finish{padding:52px 0 58px}
  .trust-strip{gap:6px;margin-bottom:24px}
  .trust-chip{padding:7px 9px;font-size:9px}
  .trust-finish-grid{gap:22px}
  .trust-finish h2{font-size:clamp(34px,10vw,40px);line-height:1}
  .trust-finish p{font-size:14px}
  .trust-finish .actions{display:grid;gap:9px;margin-top:20px}
  .trust-finish .actions .btn{width:100%;min-height:48px}
  footer{font-size:12px}
}
@media(max-width:380px){
  .experience-home .home-inner{padding-left:14px;padding-right:14px}
  .experience-hero h1{font-size:36px}
  .proof-slot{flex-basis:88%}
  .mobile-menu-panel{right:-86px}
}

/* Simplified comparison interaction · 2026-09-17 */
.sim-shell{max-width:980px}
.sim-tabs{justify-content:flex-start;padding:14px 16px 0;border-bottom:0;background:transparent}
.sim-tab[hidden]{display:none}
.sim-meta-simple{grid-template-columns:minmax(0,1fr) auto;gap:18px;padding:18px 22px 20px}
.sim-prompt-card{min-width:0}
.sim-prompt-card>span{display:block;margin-bottom:7px;font-size:10px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:#8a8292}
.sim-prompt-card>p{margin:0;font-size:16px;line-height:1.45;font-weight:800;color:#2d2734}
.sim-meta-simple .sim-source-name,.sim-meta-simple .sim-url,.sim-reset{display:none!important}
.sim-grid{gap:12px;padding:0 22px 18px}
.sim-panel{min-height:0;padding:15px 16px}
.sim-panel-head{padding-bottom:0;border-bottom:0}
.sim-panel-sub,.sim-chat-user{display:none}
.sim-panel .sim-body{display:none;padding-top:12px}
.sim-panel:has(.sim-answer.show) .sim-body,.sim-panel:has(.sim-tool.show) .sim-body{display:flex}
.sim-answer{padding:12px 13px;font-size:13px}
.sim-answer p{margin:5px 0 0}
.sim-answer ul{display:none}
.sim-tool{width:auto;max-width:100%;padding:9px 11px}
.sim-conclusion{margin:0 22px 18px;padding:0;background:transparent;color:#716a79;font-size:12px}
.sim-conclusion strong{color:#5e49c4}
@media(max-width:650px){.sim-tabs{justify-content:flex-start}.sim-meta-simple{grid-template-columns:1fr;gap:12px;padding:14px}.sim-prompt-card>p{font-size:14px}.sim-actions{display:block}.sim-run{width:100%;min-height:44px}.sim-grid{grid-template-columns:1fr;padding:0 14px 14px}.sim-panel{padding:14px}.sim-conclusion{margin:0 14px 14px}.sim-shell{margin-top:20px}}


/* Final canvas + typography pass · 2026-09-17 */
html,body{min-height:100%;}
body{min-height:100svh;background:radial-gradient(circle at 78% -10%,rgba(106,120,255,.18),transparent 40%),radial-gradient(circle at 3% 8%,rgba(179,123,255,.11),transparent 31%),linear-gradient(180deg,#fbfaff 0%,#f8f7fc 54%,#f5f3fa 100%)!important;background-attachment:fixed!important;background-size:cover!important}
main,.section,footer{background:transparent!important}
nav{background:transparent!important;border-bottom-color:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important;transition:background .18s ease,box-shadow .18s ease,backdrop-filter .18s ease}
nav.scrolled:not(.home-nav){background:rgba(248,247,252,.88)!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important;box-shadow:0 8px 28px rgba(34,28,52,.08)!important}
.sim-run:disabled{opacity:.68;cursor:wait;transform:none!important}
.sim-panel.with .sim-answer ul{display:block;margin:8px 0 0;padding-left:17px}
.sim-panel.with .sim-answer li{margin:4px 0}
@media(min-width:901px){
  .wrap{max-width:1480px;padding-left:48px;padding-right:48px}
  .home-nav{width:min(calc(100vw - 96px),1384px)}
  body[data-path]:not([data-path="/"]) .section{padding:64px 0 58px!important;border-top:0}
  body[data-path]:not([data-path="/"]) .section-head{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(360px,.92fr);gap:64px;align-items:end;margin-bottom:34px}
  body[data-path]:not([data-path="/"]) .section h2{font-size:clamp(50px,4.3vw,68px);line-height:.98;max-width:880px}
  body[data-path]:not([data-path="/"]) .section .sub{font-size:18px;line-height:1.55;max-width:640px;justify-self:end}
  body[data-path]:not([data-path="/"]) .feature-grid{gap:20px}
  body[data-path]:not([data-path="/"]) .card{padding:28px 30px}
  body[data-path]:not([data-path="/"]) .source-grid,body[data-path]:not([data-path="/"]) .use-grid{gap:20px}
  body[data-path]:not([data-path="/"]) .source-card,body[data-path]:not([data-path="/"]) .use-card{padding:28px 30px}

  .home-only .experience-hero{min-height:100svh;padding:132px 0 48px;display:flex;align-items:flex-start}
  .home-only .home-inner{width:min(100%,1460px);max-width:1460px;padding-left:48px;padding-right:48px}
  .home-only .experience-copy{max-width:1380px;margin-bottom:20px}
  .home-only .experience-hero h1{font-size:clamp(70px,5.5vw,92px);line-height:.93}
  .home-only .experience-lede{font-size:18px;max-width:900px}
  .home-only .sim-shell{max-width:1340px;margin-top:18px}
  .home-only .experience-hero-cta{margin-top:16px}
  .home-only .sim-tabs{padding-top:18px}
  .home-only .sim-meta-simple{padding:20px 24px 24px}
  .home-only .sim-grid{padding-left:24px;padding-right:24px;padding-bottom:22px}
  .home-only .sim-panel{min-height:78px;padding:18px 18px}

  body[data-path="/support"] #main-content{padding-bottom:24px}
  body[data-path="/support"] .connect-hero{max-width:none;margin:0;padding:64px 0 28px!important;display:grid;grid-template-columns:minmax(0,1.08fr) minmax(380px,.92fr);grid-template-rows:auto auto auto;column-gap:72px;row-gap:10px;text-align:left!important}
  body[data-path="/support"] .connect-hero .badge{grid-column:1;grid-row:1;justify-self:start}
  body[data-path="/support"] .connect-hero h1{grid-column:1;grid-row:2;font-size:clamp(58px,5vw,78px);line-height:.95;max-width:850px;margin:10px 0 8px}
  body[data-path="/support"] .connect-hero>p:not(.micro){grid-column:1;grid-row:3;font-size:18px;line-height:1.55;max-width:720px;margin:0}
  body[data-path="/support"] .connect-hero .actions{grid-column:2;grid-row:2;align-self:end;justify-self:start;margin:0;display:flex;gap:10px}
  body[data-path="/support"] .connect-hero .micro{grid-column:2;grid-row:3;align-self:start;margin:0;font-size:13px}
  body[data-path="/support"] .support-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:18px 0 30px}
  body[data-path="/support"] .support-grid .card{min-height:0;padding:26px 28px}
  body[data-path="/support"] .support-grid .card .kicker{margin-bottom:12px}
  body[data-path="/support"] .support-grid .card h3{font-size:22px;line-height:1.18;margin-bottom:10px}
  body[data-path="/support"] .support-grid .card p{font-size:15px;line-height:1.55;max-width:42ch}
  body[data-path="/support"] .scope-note{margin-top:0!important;margin-bottom:46px!important;padding:16px 18px;border-radius:18px}
  body[data-path="/support"] .scope-note p{font-size:13px;line-height:1.5}
}
@media(max-width:1100px) and (min-width:651px){
  body[data-path="/support"] .connect-hero{display:block;padding-top:48px!important}
  body[data-path="/support"] .connect-hero .actions{margin-top:22px}
  body[data-path="/support"] .connect-hero .micro{margin-top:12px}
}
@media(max-width:650px){
  body{background:radial-gradient(circle at 84% -4%,rgba(106,120,255,.16),transparent 38%),radial-gradient(circle at 4% 8%,rgba(179,123,255,.10),transparent 30%),linear-gradient(180deg,#fbfaff,#f6f4fb)!important;background-attachment:scroll!important}
  nav.scrolled:not(.home-nav){background:rgba(248,247,252,.94)!important}
  body[data-path="/support"] .connect-hero{display:block;padding-top:38px!important}
  body[data-path="/support"] .support-grid{margin-bottom:24px}
}

/* Homepage responsive architecture · 2026-09-20 */
.home-only .home-inner{width:min(calc(100vw - 64px),1240px);max-width:1240px;padding-left:0;padding-right:0}
.home-only .home-nav{width:min(calc(100vw - 64px),1240px)}
.home-only .experience-hero{min-height:auto;padding:112px 0 64px;align-items:flex-start}
.home-only .experience-copy{max-width:1040px;margin-bottom:24px}
.home-only .experience-hero h1{font-size:clamp(60px,5vw,78px);line-height:1;letter-spacing:-.065em;white-space:normal;max-width:1040px;margin:18px 0}
.home-only .experience-hero h1 .hero-line{display:block}.home-only .experience-hero h1 .hero-line+.hero-line{margin-top:.08em}
.home-only .experience-hero h1 .hero-line-plain{color:var(--ink);background:none;-webkit-text-fill-color:currentColor}
.home-only .experience-hero h1 .hero-line-accent{background:linear-gradient(118deg,#5e47dd 8%,#7f63ef 46%,#4d7df0 92%);-webkit-background-clip:text;background-clip:text;color:transparent}
.home-only .experience-lede{max-width:820px;font-size:17px}
.home-only .sim-shell{width:100%;max-width:none;margin-top:24px;border-radius:26px}
.home-only .sim-panel{min-height:150px;padding:18px}
.home-only .sim-panel-sub{display:block}
.home-only .sim-chat-user{display:block;max-width:78%;padding:11px 13px}
.home-only .clarity-strip{margin-top:24px}
.home-only .experience-hero-cta{margin-top:20px}
@media(max-width:1279px) and (min-width:901px){
  .home-only .home-inner,.home-only .home-nav{width:min(calc(100vw - 48px),1120px)}
  .home-only .experience-hero{padding-top:104px}
  .home-only .experience-hero h1{font-size:clamp(54px,5.6vw,68px);max-width:920px}
  .home-only .experience-copy{max-width:920px}
  .home-only .sim-tab{padding:8px 11px;font-size:11px}
  .home-only .sim-panel{min-height:142px}
}
@media(max-width:900px) and (min-width:651px){
  .home-only .home-inner,.home-only .home-nav{width:min(calc(100vw - 40px),820px)}
  .home-only .experience-hero{padding:96px 0 52px}
  .home-only .experience-hero h1{font-size:clamp(50px,7vw,62px);line-height:1.02;max-width:760px}
  .home-only .experience-lede{max-width:700px}
  .home-only .sim-grid{grid-template-columns:1fr 1fr}
  .home-only .sim-panel{min-height:160px}
  .home-only .sim-chat-user{max-width:88%}
  .home-only .clarity-strip{grid-template-columns:1fr 1fr}
  .home-only .clarity-item:last-child{grid-column:1/-1}
}
@media(max-width:650px){
  .home-only .home-inner{width:100%;padding-left:18px;padding-right:18px}
  .home-only .home-nav{width:auto}
  .home-only .experience-hero{padding:88px 0 42px}
  .home-only .experience-hero h1{font-size:clamp(39px,11vw,48px);line-height:1.02;max-width:10.5ch;margin:14px 0}
  .home-only .experience-hero h1 .hero-line{display:inline}.home-only .experience-hero h1 .hero-line+.hero-line{margin-top:0}
  .home-only .experience-hero h1 .hero-line-plain:after{content:" "}
  .home-only .experience-lede{font-size:15px}
  .home-only .sim-shell{margin-top:22px;border-radius:20px}
  .home-only .sim-grid{grid-template-columns:1fr}
  .home-only .sim-panel{min-height:0;padding:14px}
  .home-only .sim-panel-sub{display:none}
  .home-only .sim-chat-user{display:block;max-width:94%;padding:10px 11px}
  .home-only .clarity-strip{grid-template-columns:1fr}
  .home-only .clarity-item:last-child{grid-column:auto}
}

@media(prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}.sim-line.live:after{animation:none}.sim-answer.show,.sim-tool.show,.sim-conclusion.show{animation:none}}

`;
function claudeInstallUrl(){const u=new URL('https://claude.ai/customize/connectors');u.searchParams.set('modal','add-custom-connector');u.searchParams.set('connectorName',env().PUBLIC_BRAND_NAME);u.searchParams.set('connectorUrl',`${env().PUBLIC_BASE_URL}/mcp`);return u.toString();}
function siteShell(body:string,title=env().PUBLIC_BRAND_NAME,path='/'){const supportEmail=env().SUPPORT_EMAIL?.trim();const description=`Make supported public links AI-readable. ${env().PUBLIC_BRAND_NAME} turns videos, social posts, discussions, webpages, developer threads and text-layer PDFs into usable source context for the AI you already use.`;const base=env().PUBLIC_BASE_URL.replace(/\/$/,'');const canonical=`${base}${path.startsWith('/')?path:`/${path}`}`;return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${title}</title><meta name="description" content="${description}"><meta name="robots" content="index,follow"><meta name="theme-color" content="#fbfaf8"><link rel="canonical" href="${canonical}"><meta property="og:type" content="website"><meta property="og:site_name" content="${env().PUBLIC_BRAND_NAME}"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${canonical}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"><link rel="icon" href="/logo.svg"><script type="application/ld+json">${JSON.stringify({"@context":"https://schema.org","@type":"SoftwareApplication",name:env().PUBLIC_BRAND_NAME,applicationCategory:"ProductivityApplication",operatingSystem:"Web",url:base,description})}</script><style>${siteCss}</style></head><body data-path="${path}"><a class="skip-link" href="#main-content">Skip to content</a><div class="wrap"><nav class="${path==='/'?'home-nav':''}" aria-label="Primary"><a class="brand" href="/" aria-label="${env().PUBLIC_BRAND_NAME} home"><img src="/logo.svg" alt=""><span>${env().PUBLIC_BRAND_NAME}</span></a><div class="navlinks"><a class="hide-sm" href="/examples">Examples</a><a class="hide-sm" href="/use-cases">Use cases</a><a class="hide-sm" href="/sources">Supported sources</a><a class="hide-sm" href="/pricing">Pricing</a><a class="hide-sm" href="/developers">Developers</a><a class="hide-sm" href="/support">Support</a><details class="mobile-menu"><summary aria-label="Open navigation">Menu</summary><div class="mobile-menu-panel"><a href="/examples">Examples</a><a href="/use-cases">Use cases</a><a href="/sources">Supported sources</a><a href="/pricing">Pricing</a><a href="/developers">Developers</a><a href="/support">Support</a><a href="/account">Account</a></div></details><a class="btn sm purple" href="/start?from=nav">Connect to Claude</a></div></nav><script>(()=>{const n=document.querySelector('nav');if(!n)return;const sync=()=>n.classList.toggle('scrolled',window.scrollY>10);sync();window.addEventListener('scroll',sync,{passive:true});})();</script>${body}<footer><span>© 2026 ${env().PUBLIC_BRAND_NAME} · A product by Eason Systems</span><span class="legal-links"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/status">Status</a> · <a href="/support">Support</a> · <a href="/account">Account</a>${supportEmail?` · <a href="mailto:${supportEmail}">${supportEmail}</a>`:''}</span></footer></div></body></html>`;}

app.get('/start',async(req,reply)=>{
  const fromRaw=String((req.query as {from?:string})?.from??'unknown').toLowerCase();
  const from=['nav','hero','footer','faq','pricing'].includes(fromRaw)?fromRaw:'other';
  await trackWebsiteEvent(req,'cta_start','/',{from});
  const current=await userFromSessionCookie(req.headers.cookie).catch(()=>null);
  // Do not send an already-authenticated account back through signup.
  if(current?.email)return reply.redirect('/connect');
  return reply.redirect('/signup?return_to=%2Fconnect');
});
app.get('/connect/start',async(req,reply)=>{
  await trackWebsiteEvent(req,'connect_install_click','/connect');
  const current=await userFromSessionCookie(req.headers.cookie).catch(()=>null);
  if(current?.id)await recordActivationEvent(current.id,'connect_cta_click',{distributionProfile:'default',metadata:{host:'claude'}});
  return reply.redirect(claudeInstallUrl());
});

app.get('/',async(req,reply)=>{
  await trackWebsiteVisit(req,reply,'/');
  return reply.type('text/html').send(siteShell(`<main id="main-content" class="experience-home home-only">
    <section class="experience-hero" id="simulation">
      <div class="home-inner">
        <div class="experience-copy reveal">
          <span class="experience-kicker">Source infrastructure for AI</span>
          <h1><span class="hero-line hero-line-plain">Give your AI the source.</span><span class="hero-line hero-line-accent">Link2AI makes it readable.</span></h1>
          <p class="experience-lede">Turn supported public links into AI-ready source context. Connect Link2AI to Claude, or use the same source engine from your agent, workflow, research tool, or app through the API.</p>
        </div>
        <div class="sim-shell reveal" id="comparison-demo" aria-label="Interactive Link2AI comparison simulation">
          <div class="sim-tabs" role="tablist" aria-label="Choose a source for the comparison">
            <button class="sim-tab" type="button" data-sim-source="reddit"${redditOAuthReady?'':' hidden'}>${redditOAuthReady?'Reddit':'Reddit · paused'}</button>
            <button class="sim-tab active" type="button" data-sim-source="youtube">YouTube / Shorts</button>
            <button class="sim-tab" type="button" data-sim-source="tiktok">TikTok</button>
            <button class="sim-tab" type="button" data-sim-source="instagram">Instagram</button>
            <button class="sim-tab" type="button" data-sim-source="x">X</button>
            <button class="sim-tab" type="button" data-sim-source="bluesky">Bluesky</button>
            <button class="sim-tab" type="button" data-sim-source="hn">Hacker News</button>
            <button class="sim-tab" type="button" data-sim-source="pdf">PDF</button>
            <button class="sim-tab" type="button" data-sim-source="web">Web</button>
          </div>
          <div class="sim-meta sim-meta-simple">
            <div class="sim-prompt-card">
              <span>Try this question</span>
              <p class="sim-user-question">What is this YouTube video arguing, and what evidence does it use?</p>
              <strong class="sim-source-name" id="sim-source-name" hidden>YouTube video</strong><code class="sim-url" id="sim-url" hidden>youtube.com/watch?v=…</code>
            </div>
            <div class="sim-actions"><button class="sim-run" id="sim-run" type="button">See the difference →</button><button class="sim-reset" id="sim-reset" type="button" hidden>Reset</button></div>
          </div>
          <div class="sim-grid" aria-live="polite">
            <article class="sim-panel without">
              <div class="sim-panel-head"><div><div class="sim-panel-title">Without Link2AI</div><span class="sim-panel-sub">Simulated Claude conversation · same public link</span></div><span class="sim-state" id="sim-left-state">Ready</span></div>
              <div class="sim-body"><div class="sim-chat-user"><span>You</span><p class="sim-user-question">What is this YouTube video arguing, and what evidence does it use?</p></div><div class="sim-answer sim-fail show" id="sim-left-answer"><span class="sim-chat-speaker">Claude</span><p>I can see the YouTube URL, but I do not have enough of the video content to summarize its argument reliably.</p></div></div>
            </article>
            <article class="sim-panel with">
              <div class="sim-panel-head"><div><div class="sim-panel-title">With Link2AI</div><span class="sim-panel-sub">Simulated Claude conversation · Link2AI connected</span></div><span class="sim-state" id="sim-right-state">Ready</span></div>
              <div class="sim-body"><div class="sim-chat-user"><span>You</span><p class="sim-user-question">What is this YouTube video arguing, and what evidence does it use?</p></div><div class="sim-tool show" id="sim-tool">Link2AI · Source loaded <i>shared source engine</i></div><div class="sim-answer show" id="sim-right-answer"><span class="sim-chat-speaker">Claude</span><strong>The source is loaded and ready for a grounded answer.</strong><ul><li>Transcript-based context supplies the video's actual claims.</li><li>Metadata and evidence remain attached to the result.</li></ul></div></div>
            </article>
          </div>
          <div class="sim-conclusion" id="sim-conclusion" hidden>Same AI. Same link. <strong>Missing context fixed.</strong></div>
        </div>
        <div class="experience-hero-cta reveal"><a class="btn purple" href="/start?from=hero-simulation">Connect to Claude →</a><a class="btn alt" href="/developers">Use the API</a><span class="micro">10 processing units · No card required · Failed reads cost 0</span></div>
        <div class="clarity-strip reveal" aria-label="How to start using Link2AI">
          <div class="clarity-item"><b>1</b><div><strong>Connect Link2AI</strong><span>Use the button above to connect directly today. We are also preparing a Claude Connector Directory listing, but you do not need to wait for it to start.</span></div></div>
          <div class="clarity-item"><b>2</b><div><strong>Enable it in the chat</strong><span>Claude can say Connected before Link2AI is turned on for the specific conversation. Open + → Connectors → Link2AI once in that chat.</span></div></div>
          <div class="clarity-item"><b>3</b><div><strong>Paste the link in Claude</strong><span>After that, use Claude normally. Paste the public link into Claude's message box and ask your question there.</span></div></div>
        </div>
      </div>
    </section>

    <script src="/home.js?v=20260917-homeonly2" defer></script>
  </main>`, `${env().PUBLIC_BRAND_NAME} — Public links to AI-ready source context`, `/`));
});


app.get('/examples',async(req,reply)=>{
  await trackWebsiteVisit(req,reply,'/examples');
  return reply.type('text/html').send(siteShell(`<main id="main-content"><section class="section" style="padding-top:72px"><div class="section-head"><div><span class="section-index">Examples</span><h2>See what changes when the source actually reaches Claude.</h2></div><p class="sub">Representative workflows for the same kinds of public links Link2AI is built to read.</p></div><div class="use-grid"><div class="use-card"><h3>YouTube / Shorts</h3><p>Ask for the video's main claim, evidence, examples, or a concise summary without copying a transcript by hand.</p><div class="example-prompt">“What is this video arguing, and what evidence does it use?”</div></div><div class="use-card"><h3>GitHub Issues / PRs</h3><p>Bring the actual developer thread into the conversation so Claude can reason from the issue or review context.</p><div class="example-prompt">“Review this issue and suggest the next fix.”</div></div><div class="use-card"><h3>Readable webpages</h3><p>Use the page itself as source context instead of relying on search snippets or a manually pasted excerpt.</p><div class="example-prompt">“Summarize the argument on this page and list the key evidence.”</div></div><div class="use-card"><h3>Text-layer PDFs</h3><p>Let Claude work from readable PDF text when the document is publicly accessible.</p><div class="example-prompt">“Compare the recommendations in this PDF and flag the tradeoffs.”</div></div></div><div class="actions"><a class="btn purple" href="/">Try the interactive comparison →</a></div></section></main>`, `Examples · ${env().PUBLIC_BRAND_NAME}`, '/examples'));
});

app.get('/use-cases',async(req,reply)=>{
  await trackWebsiteVisit(req,reply,'/use-cases');
  return reply.type('text/html').send(siteShell(`<main id="main-content"><section class="section" style="padding-top:72px"><div class="section-head"><div><span class="section-index">Use cases</span><h2>Use the link normally. Keep the conversation moving.</h2></div><p class="sub">Link2AI is useful when your question depends on a public source Claude cannot reliably read by itself.</p></div><div class="feature-grid"><div class="card"><div class="kicker">Understand</div><h3>Summaries grounded in the source</h3><p>Ask what a video, article, thread or document actually says without manually copying the content first.</p></div><div class="card"><div class="kicker">Analyze</div><h3>Reason from the original context</h3><p>Compare claims, inspect evidence, find tradeoffs, or ask follow-up questions while the source stays available to the conversation.</p></div><div class="card"><div class="kicker">Build</div><h3>Work from developer discussions</h3><p>Use GitHub Issues, pull requests and Hacker News discussions as context for debugging, planning and technical analysis.</p></div></div><div class="actions"><a class="btn purple" href="/">Try it from the homepage →</a><a class="btn alt" href="/sources">See supported sources</a></div></section></main>`, `Use cases · ${env().PUBLIC_BRAND_NAME}`, '/use-cases'));
});

app.get('/sources',async(req,reply)=>{
  await trackWebsiteVisit(req,reply,'/sources');
  return reply.type('text/html').send(siteShell(`<main id="main-content"><section class="section" style="padding-top:72px"><div class="section-head"><div><span class="section-index">Supported sources</span><h2>Public links Link2AI is built to read.</h2></div><p class="sub">Availability can still vary with the source platform. Failed, unsupported or inaccessible reads cost 0 processing units.</p></div><div class="source-grid"><div class="source-card"><div class="source-icon">▶</div><h3>Video & social</h3><p>YouTube / Shorts, TikTok, Instagram, X and Bluesky public links.</p></div><div class="source-card"><div class="source-icon">&lt;/&gt;</div><h3>Developer discussions</h3><p>GitHub Issues / pull requests and Hacker News discussions.</p></div><div class="source-card"><div class="source-icon">W</div><h3>Web pages</h3><p>Readable public webpages and articles that can be fetched safely.</p></div><div class="source-card"><div class="source-icon">PDF</div><h3>Documents</h3><p>Public text-layer PDFs. Image-only or inaccessible documents are not claimed as readable.</p></div><div class="source-card"><div class="source-icon">R</div><h3>Reddit</h3><p>${redditOAuthReady?'Available through configured Reddit OAuth Data API access.':'Paused until approved Reddit OAuth Data API credentials are configured.'}</p></div></div><div class="actions"><a class="btn purple" href="/">Try the interactive comparison →</a><a class="btn alt" href="/support">Need help?</a></div></section></main>`, `Supported sources · ${env().PUBLIC_BRAND_NAME}`, '/sources'));
});

const homeExperienceJs=`(()=>{
      const redditAvailable=${redditOAuthReady?'true':'false'};
      const demos={
        reddit:{name:'Reddit thread',url:'reddit.com/r/ClaudeAI/comments/…',question:'What are people disagreeing about in this Reddit thread?',fail:'I can’t reliably access the contents of that Reddit page. If you paste the content here, I can help.',lead:'The thread splits around where the access failure actually happens.',points:['One group treats Reddit access itself as the blocker.','Another group points to whether the connector is loaded and invoked.','The useful follow-up is separating source availability from tool-selection behavior.']},
        youtube:{name:'YouTube / Shorts',url:'youtube.com/watch?v=…',question:'What is this YouTube video arguing, and what evidence does it use?',fail:'I can see the YouTube URL, but I do not have enough of the video content to summarize its argument reliably.',lead:'The video argues that AI agents are becoming capable faster than the workflows around them are improving.',points:['Coding agents can now complete longer multi-step tasks with less supervision.','Research and tool-use examples show the bottleneck shifting from model capability to the surrounding workflow.','The conclusion argues that better orchestration matters as much as stronger models.']},
        tiktok:{name:'TikTok post',url:'tiktok.com/@creator/video/…',question:'What is this TikTok claiming, and what evidence does the clip actually give?',fail:'I can see the TikTok URL, but I do not have enough of the clip itself to answer from the source reliably.',lead:'The clip makes one central claim and backs it with two concrete examples.',points:['The opening states the claim directly.','The examples support one part of the claim but not every implication.','The ending adds a broader conclusion than the clip fully demonstrates.']},
        instagram:{name:'Instagram post',url:'instagram.com/reel/…',question:'What is this Instagram post claiming, and what details support it?',fail:'I can see the Instagram URL, but the exact post content is not available to me reliably from the link alone.',lead:'The post makes a specific claim and supports it with details from the caption and clip.',points:['The caption gives the central claim.','The media adds one concrete example.','The strongest conclusion goes slightly beyond what is directly shown.']},
        x:{name:'X post',url:'x.com/creator/status/…',question:'What exactly is this post claiming, and what context matters?',fail:'I can see the X URL, but I do not have enough of the exact post content to answer confidently.',lead:'The post makes one direct claim, with context that changes how strongly it should be read.',points:['The wording is narrower than the headline interpretation.','One linked detail supports the factual part of the claim.','The broader conclusion is still the author’s interpretation.']},
        bluesky:{name:'Bluesky post',url:'bsky.app/profile/…/post/…',question:'Summarize this Bluesky post and the context around its claim.',fail:'I can see the Bluesky URL, but I do not have enough exact post content to summarize it reliably.',lead:'The post states a clear position and gives enough surrounding context to explain what it is reacting to.',points:['The main claim is explicit in the post text.','The surrounding context explains what prompted it.','The useful distinction is between the factual event and the author’s judgment.']},
        hn:{name:'Hacker News discussion',url:'news.ycombinator.com/item?id=…',question:'Where do commenters in this Hacker News discussion actually disagree?',fail:'I can open the story, but I do not have enough of the discussion thread to summarize the disagreement reliably.',lead:'The discussion splits into a few recurring arguments rather than one consensus.',points:['One group accepts the article’s central premise.','Another challenges whether the evidence supports that conclusion.','A third group focuses on practical consequences instead of the original claim.']},
        pdf:{name:'Public PDF',url:'example.org/research-paper.pdf',question:'What are the paper’s main findings and biggest limitation?',fail:'This fetch did not expose enough of the PDF text to answer from the document itself.',lead:'The paper reports a clear result, but the strongest limitation is in how broadly it can be generalized.',points:['The central finding is consistent across the reported experiments.','The evidence is strongest inside the study’s measured setting.','The paper itself leaves external validity as the main caution.']},
        web:{name:'Public webpage',url:'example.org/article',question:'Summarize this article and separate evidence from opinion.',fail:'This fetch did not expose enough of the exact page content to separate its evidence from opinion reliably.',lead:'The article mixes reported facts with the author’s interpretation.',points:['The factual section relies on named events and published figures.','The analysis section makes a broader causal claim.','The conclusion is more confident than the evidence shown earlier.']}
      };
      const sourceExplore={
        reddit:redditAvailable?{label:'Reddit · public discussion',title:'Bring the public discussion into context.',question:'“Where do people in this Reddit thread disagree?”',result:'Approved Reddit Data API access is configured for this deployment.',sim:'reddit'}:{label:'Reddit · temporarily paused',title:'Reddit now requires approved Data API access from hosted services.',question:'Link2AI will re-enable Reddit after approved OAuth access is configured.',result:'We do not bypass Reddit’s access controls. Failed or unavailable reads cost 0 units.',sim:null},
        youtube:{label:'YouTube · public video',title:'Turn the video into a conversation.',question:'“What is this video arguing, and what evidence does it use?”',result:'Link2AI can supply transcript-based source context for supported public videos.',sim:'youtube'},
        github:{label:'GitHub · public Issue / PR',title:'Keep the whole developer thread in view.',question:'“Review this Issue and suggest the next fix to try.”',result:'Claude can work from the public Issue or PR context instead of just the URL.',sim:'github'},
        x:{label:'X · supported public post',title:'Bring a public post into context.',question:'“What claim is this post making, and what context matters?”',result:'Supported public X content can be retrieved when available.',sim:'x'},
        web:{label:'Web · readable public page',title:'Ask the page a better question.',question:'“Separate the evidence in this article from the author’s opinion.”',result:'Readable public webpages and articles can become source context.',sim:'web'},
        pdf:{label:'PDF · public text-layer document',title:'Use the document without manual copy-paste.',question:'“What are this paper’s main findings and limitations?”',result:'Public PDFs with a usable text layer can be processed within product limits.',sim:'pdf'},
        instagram:{label:'Instagram · supported public post',title:'Use the public post as source context.',question:'“What is being claimed in this post, and what details support it?”',result:'Supported public Instagram posts can be retrieved when available.',sim:'instagram'},
        tiktok:{label:'TikTok · supported public post',title:'Move from clip to question.',question:'“What is the main argument in this TikTok, and what is left out?”',result:'Supported public TikTok content can be processed when available.',sim:'tiktok'},
        hn:{label:'Hacker News · public discussion',title:'Read the argument across the thread.',question:'“What are the strongest disagreements in this Hacker News discussion?”',result:'Public Hacker News discussions can be loaded as structured source context.',sim:'hn'},
        bluesky:{label:'Bluesky · public post',title:'Bring the public conversation with you.',question:'“Summarize the claim and the key replies around it.”',result:'Supported public Bluesky content can be retrieved when available.',sim:'bluesky'}
      };
      const usecases={
        reddit:{prompt:'Summarize this Reddit thread and tell me where people disagree.',lead:'The disagreement is mostly about where the failure happens.',points:['One side blames source access.','Another side points to whether the connector was loaded and invoked.','The useful follow-up is to separate source availability from tool-selection behavior.']},
        youtube:{prompt:'What is this YouTube video arguing, and what evidence does it use?',lead:'The creator makes one central claim and supports it in three stages.',points:['The opening establishes the problem.','The middle uses examples to support the thesis.','The ending narrows the claim but leaves one assumption unresolved.']},
        github:{prompt:'Review this GitHub issue and suggest the next fix to try.',lead:'The Issue points to one likely failure path before a code change is justified.',points:['The bug appears after a reconnect flow.','Comments narrow the likely state boundary.','Instrument the reconnect path first, then change the smallest confirmed cause.']},
        research:{prompt:'Compare this PDF with this article. Where do they agree and disagree?',lead:'The sources overlap on the core observation but diverge on how strongly to interpret it.',points:['Both sources describe the same underlying trend.','The PDF is more cautious about generalization.','The article makes a broader causal claim than the paper directly supports.']}
      };
      const q=(sel)=>document.querySelector(sel),qa=(sel)=>Array.from(document.querySelectorAll(sel));
      const state={source:'youtube',timers:new Set(),runId:0,interacted:false};
      const clearTimers=()=>{for(const id of state.timers)clearTimeout(id);state.timers.clear();};
      const setTimer=(fn,ms,runId=state.runId)=>{const id=setTimeout(()=>{state.timers.delete(id);if(runId!==state.runId)return;fn();},ms);state.timers.add(id);return id;};
      const resetDemo=(markInteraction=false,showPreview=false)=>{if(markInteraction)state.interacted=true;state.runId++;clearTimers();const d=demos[state.source];q('#sim-left-state').textContent=showPreview?'Link only':'Ready';q('#sim-right-state').textContent=showPreview?'Source ready':'Ready';q('#sim-left-state').className=showPreview?'sim-state failed':'sim-state';q('#sim-right-state').className=showPreview?'sim-state loaded':'sim-state';q('#sim-left-answer').classList.toggle('show',showPreview);q('#sim-right-answer').classList.toggle('show',showPreview);q('#sim-left-answer').innerHTML=showPreview?'<span class="sim-chat-speaker">Claude</span><p>'+d.fail+'</p>':'';if(showPreview)renderAnswer(q('#sim-right-answer'),d.lead,d.points);else q('#sim-right-answer').innerHTML='';q('#sim-tool').classList.toggle('show',showPreview);q('#sim-tool').innerHTML=showPreview?'Link2AI · Source loaded <i>shared source engine</i>':'Link2AI · Reading source…';q('#sim-run').textContent='See the difference →';q('#sim-run').disabled=false;q('#sim-conclusion').classList.remove('show');q('#sim-conclusion').hidden=true;qa('#sim-left-thinking .sim-line,#sim-right-thinking .sim-line').forEach(el=>el.classList.remove('live'));};
      const renderDemoSource=(key)=>{const d=demos[key];if(!d)return;state.source=key;q('#sim-source-name').textContent=d.name;q('#sim-url').textContent=d.url;qa('.sim-user-question').forEach(el=>{el.textContent=d.question;});qa('.sim-tab').forEach(b=>b.classList.toggle('active',b.dataset.simSource===key));resetDemo(false,true);};
      const renderAnswer=(el,lead,points)=>{el.innerHTML='<span class=\"sim-chat-speaker\">Claude</span><strong>'+lead+'</strong><ul>'+points.slice(0,2).map(point=>'<li>'+point+'</li>').join('')+'</ul>';};
      const renderRedditPaused=()=>{q('#sim-left-state').textContent='Ready';q('#sim-left-state').className='sim-state';q('#sim-right-state').textContent='Temporarily paused';q('#sim-right-state').className='sim-state failed';qa('#sim-left-thinking .sim-line,#sim-right-thinking .sim-line').forEach(el=>el.classList.remove('live'));q('#sim-tool').classList.add('show');q('#sim-tool').innerHTML='Reddit · Approved OAuth access required <i>0 units</i>';q('#sim-right-answer').innerHTML='<span class="sim-chat-speaker">Claude</span><p>Reddit reads are paused on this deployment rather than bypassing Reddit’s hosted-service access controls.</p>';q('#sim-right-answer').classList.add('show');q('#sim-conclusion').classList.remove('show');q('#sim-conclusion').hidden=true;};
      const runDemo=(markInteraction=false)=>{if(markInteraction)state.interacted=true;resetDemo();if(state.source==='reddit'&&!redditAvailable){renderRedditPaused();return;}const runId=state.runId;const d=demos[state.source];const reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;const t=reduced?0:1;q('#sim-run').textContent='Comparing…';q('#sim-run').disabled=true;q('#sim-left-state').textContent='Trying source';q('#sim-right-state').textContent='Starting';q('#sim-left-state').className='sim-state reading';q('#sim-right-state').className='sim-state reading';qa('#sim-left-thinking .sim-line,#sim-right-thinking .sim-line').forEach(el=>el.classList.add('live'));setTimer(()=>{q('#sim-tool').classList.add('show');q('#sim-right-state').textContent='Reading';},350*t,runId);setTimer(()=>{q('#sim-left-state').textContent='Blocked';q('#sim-left-state').className='sim-state failed';qa('#sim-left-thinking .sim-line').forEach(el=>el.classList.remove('live'));q('#sim-left-answer').innerHTML='<span class="sim-chat-speaker">Claude</span><p>'+d.fail+'</p>';q('#sim-left-answer').classList.add('show');},900*t,runId);setTimer(()=>{q('#sim-tool').innerHTML='Link2AI · Source loaded';q('#sim-right-state').textContent='Source loaded';q('#sim-right-state').className='sim-state loaded';},1300*t,runId);setTimer(()=>{qa('#sim-right-thinking .sim-line').forEach(el=>el.classList.remove('live'));renderAnswer(q('#sim-right-answer'),d.lead,d.points);q('#sim-right-answer').classList.add('show');},1750*t,runId);setTimer(()=>{q('#sim-conclusion').hidden=false;q('#sim-conclusion').classList.add('show');q('#sim-run').textContent='Run again ↻';q('#sim-run').disabled=false;},2150*t,runId);};
      qa('.sim-tab').forEach(btn=>btn.addEventListener('click',()=>{state.interacted=true;renderDemoSource(btn.dataset.simSource);if(btn.dataset.simSource==='reddit'&&!redditAvailable)renderRedditPaused();}));q('#sim-run').addEventListener('click',()=>runDemo(true));q('#sim-reset').addEventListener('click',()=>resetDemo(true,true));
      const showSource=(key)=>{const d=sourceExplore[key];if(!d)return;qa('.source-button').forEach(b=>b.classList.toggle('active',b.dataset.sourceKey===key));q('#source-preview-label').textContent=d.label;q('#source-preview-title').textContent=d.title;q('#source-preview-question').textContent=d.question;q('#source-mini-result').innerHTML='<strong>What changes</strong>'+d.result;q('#source-open-sim').hidden=!d.sim;q('#source-open-sim').dataset.sim=d.sim||'';};
      qa('.source-button').forEach(btn=>btn.addEventListener('click',()=>{state.interacted=true;showSource(btn.dataset.sourceKey);}));q('#source-open-sim')?.addEventListener('click',(e)=>{state.interacted=true;const key=e.currentTarget.dataset.sim;if(!key)return;renderDemoSource(key);document.getElementById('simulation').scrollIntoView({behavior:'smooth'});});
      const showUsecase=(key)=>{const d=usecases[key];if(!d)return;qa('.usecase-option').forEach(b=>b.classList.toggle('active',b.dataset.usecase===key));q('#usecase-user').textContent=d.prompt;q('#usecase-result').innerHTML='<div class="usecase-result-label">Example output · representative</div><strong>'+d.lead+'</strong><ul>'+d.points.map(x=>'<li>'+x+'</li>').join('')+'</ul>';};
      qa('.usecase-option').forEach(btn=>btn.addEventListener('click',()=>{if(btn.dataset.usecase==='reddit'&&!redditAvailable)return;showUsecase(btn.dataset.usecase);}));
      const reveals=qa('.reveal');if('IntersectionObserver' in window&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){const io=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('in');io.unobserve(entry.target);}});},{threshold:.13});reveals.forEach(el=>io.observe(el));}else{reveals.forEach(el=>el.classList.add('in'));}
      resetDemo(false,true);
})();`;
app.get('/home.js',async(_req,reply)=>reply.header('Cache-Control','no-cache, max-age=0, must-revalidate').type('application/javascript; charset=utf-8').send(homeExperienceJs));

app.get('/connect',async(req,reply)=>{
  await trackWebsiteVisit(req,reply,'/connect');
  const install='/connect/start';
  return reply.type('text/html').send(siteShell(`<main id="main-content"><section class="connect-hero"><span class="badge"><span class="badge-dot"></span>Claude connector</span><h1>Connect Link2AI. Then finish one step in Claude.</h1><p>When Claude says <strong>Connected</strong>, your account is authorized. Return to the Claude conversation where you want to use Link2AI and confirm it is available from <strong>+ → Connectors</strong>.</p><div class="guide-status"><span>About 2 minutes</span><span>10 units free</span><span>No card</span></div></section><section class="setup-shell"><div class="setup-main"><h2>Set up Link2AI in three steps.</h2><p>The button opens Claude's custom-connector setup with Link2AI's name and MCP URL prefilled. You do not need to copy the URL or enter a client secret.</p><div class="setup-cta"><a class="btn purple" id="claude-install" href="${install}" target="_blank" rel="noopener">Add Link2AI to Claude →</a><span class="setup-note" id="connect-state">Claude should open Add custom connector with <strong>${env().PUBLIC_BRAND_NAME}</strong> and its MCP URL prefilled. Confirm it, then finish Link2AI sign-in when prompted.</span></div><div class="guide-grid"><div class="guide-card"><div class="guide-copy"><span class="guide-num">1</span><h3>Add the prefilled Link2AI connector.</h3><p>Confirm <strong>${env().PUBLIC_BRAND_NAME}</strong> and the prefilled MCP URL, then press <strong>Add</strong> or <strong>Connect</strong>.</p><span class="tiny-pill">Name + MCP URL prefilled</span></div><div class="guide-shot" style="min-height:250px;display:grid;place-items:center;padding:28px"><div style="max-width:360px;width:100%;background:white;border:1px solid var(--line);border-radius:20px;padding:26px;box-shadow:0 16px 45px rgba(31,26,44,.08)"><span class="badge"><span class="badge-dot"></span>Claude custom connector</span><h3 style="font-size:27px;margin:18px 0 9px">Link2AI</h3><p style="color:var(--muted);line-height:1.55">The connector name and Link2AI MCP server URL are prefilled. Confirm them, then add the connector.</p></div></div></div><div class="guide-card reverse"><div class="guide-shot" style="min-height:250px;display:grid;place-items:center;padding:28px"><div style="max-width:360px;width:100%;background:white;border:1px solid var(--line);border-radius:20px;padding:26px;box-shadow:0 16px 45px rgba(31,26,44,.08)"><span class="badge"><span class="badge-dot"></span>Link2AI account</span><h3 style="font-size:27px;margin:18px 0 9px">Sign in once</h3><p style="color:var(--muted);line-height:1.55">Your trial, usage and plan stay attached to the same account.</p></div></div><div class="guide-copy"><span class="guide-num">2</span><h3>Sign in to Link2AI.</h3><p>Claude will open Link2AI authorization. Sign in or create your Link2AI account, then approve the connection.</p><p class="micro"><strong>Connected = authorization finished.</strong> It does not guarantee Link2AI is already loaded in the Claude conversation you are using.</p></div></div><div class="guide-card"><div class="guide-copy"><span class="guide-num">3</span><h3>Confirm Link2AI in the Claude conversation.</h3><p>Return to the Claude chat and open <strong>+ → Connectors</strong>. Confirm Link2AI is available there, then paste the public link into Claude's normal message box and ask your question.</p><p class="micro">If Claude does not load Link2AI reliably, open <strong>+ → Connectors → Tool access</strong>. Claude may show <strong>Load tools when needed</strong>; you can switch to <strong>Tools already loaded</strong> so Link2AI is loaded from the start.</p><span class="tiny-pill">Connected first. Use it from Claude second.</span></div><div class="guide-shot"><img loading="lazy" decoding="async" src="/guide/claude-tool-access.png" alt="Claude Connectors and Tool access menu used to make Link2AI available in a conversation"></div></div></div><div class="why-write"><strong>Why Claude may ask before “Read public link”:</strong> a successful read creates a Link2AI processing job and can use processing units. It does <strong>not</strong> edit or delete the source link, your Claude chats, or your files.</div><div id="setup-complete" hidden class="coming" style="margin-bottom:16px"><div><strong>Connected ✓ Authorization is done.</strong><span>Return to Claude and open <strong>+ → Connectors</strong>. Confirm Link2AI is available, then paste the public link into Claude's normal message box and ask your question. If Claude does not load it, use <strong>Tool access → Tools already loaded</strong>.</span></div><a class="btn purple sm" href="https://claude.ai" target="_blank" rel="noopener">Open Claude →</a></div><div class="coming"><div><strong>Your first 30-second test</strong><span>After Link2AI is enabled in the conversation, paste a supported public link in Claude and try: “What are the main claims in this video?” or “Review this GitHub Issue and suggest the next fix.”</span></div><a class="btn alt sm" href="/examples">See examples</a></div><div class="coming" style="margin-top:12px"><div><strong>Still not seeing Link2AI?</strong><span>Open <strong>+ → Connectors</strong> in that Claude conversation and confirm Link2AI is toggled on before retrying the link.</span></div><a class="btn alt sm" href="/support">Need help?</a></div></div></section><script>(()=>{const button=document.getElementById('claude-install');const state=document.getElementById('connect-state');let since=Number(sessionStorage.getItem('link2ai_connect_started')||0);let timer=null;const check=async()=>{if(!since)return;try{const response=await fetch('/api/connect/status?since='+encodeURIComponent(String(since)),{cache:'no-store',credentials:'same-origin'});if(!response.ok)return;const data=await response.json();if(data.connected){if(state)state.textContent='Connected ✓ Authorization is complete. Return to Claude, open + → Connectors, confirm Link2AI is available, then paste your link.';clearInterval(timer);const done=document.getElementById('setup-complete');if(done)done.hidden=false;return;}if(data.authenticated&&state)state.textContent='Signed in. Finish Claude authorization; after Connected, return to Claude and confirm Link2AI under + → Connectors.';}catch{}};button?.addEventListener('click',()=>{since=Date.now();sessionStorage.setItem('link2ai_connect_started',String(since));if(state)state.textContent='Claude connector setup opened. Confirm Link2AI, add/connect it, and finish sign-in; this page will keep checking.';clearInterval(timer);timer=setInterval(check,1500);setTimeout(check,500);});if(since){timer=setInterval(check,1500);check();}})();</script></main>`, `Connect ${env().PUBLIC_BRAND_NAME} to Claude`, `/connect`));
});

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
  const connected=Boolean(r.rows[0]?.connected);
  if(connected)await trackWebsiteEvent(req,'connect_complete','/connect');
  return reply.send({authenticated:true,connected});
});


function founderEscape(value:unknown):string{
  return String(value??'').replace(/[&<>\"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"}[ch]??ch));
}
function founderTime(value:unknown):string{
  if(!value)return '—';
  const d=new Date(String(value));
  if(Number.isNaN(d.getTime()))return '—';
  return new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
}
function founderNum(value:unknown):number{return Number(value??0)||0;}
function founderPct(part:number,total:number):string{return total>0?`${Math.round((part/total)*100)}%`:'0%';}
function founderUnits(seconds:unknown):string{
  const n=founderNum(seconds)/60;
  return n>=100?`${Math.round(n)}`:n.toFixed(n>=10?1:2).replace(/\\.00$/,'').replace(/(\\.\\d)0$/,'$1');
}
function founderPlanLabel(value:unknown):string{
  const v=String(value??'');
  return ({trial:'試用',basic:'Basic',pro:'Pro'} as Record<string,string>)[v]??v;
}
function founderAccountStatusLabel(value:unknown):string{
  const v=String(value??'');
  return ({active:'正常',past_due:'付款逾期',canceled:'已取消',disabled:'已停用'} as Record<string,string>)[v]??v;
}
function founderJobStatusLabel(value:unknown):string{
  const v=String(value??'');
  return ({queued:'排隊中',processing:'處理中',completed:'已完成',failed:'失敗',awaiting_payment:'等待付款',pending:'等待中'} as Record<string,string>)[v]??v;
}
function founderActionLabel(value:unknown):string{
  const v=String(value??'');
  return ({account_update:'帳號調整'} as Record<string,string>)[v]??v;
}
function founderShell(body:string,title=`${env().PUBLIC_BRAND_NAME} 後台`){
  const supportEmail=env().SUPPORT_EMAIL?.trim();
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow,noarchive"><title>${title}</title><link rel="icon" href="/logo.svg"><style>${siteCss}</style></head><body class="founder-page"><div class="wrap"><nav><a class="brand" href="/"><img src="/logo.svg" alt=""><span>${env().PUBLIC_BRAND_NAME}</span></a><div class="navlinks"><a class="hide-sm" href="/">首頁</a><a class="hide-sm" href="/pricing">方案</a><a class="hide-sm" href="/support">客服</a><a class="btn sm purple" href="/connect">連接 AI</a></div></nav>${body}<footer><span>© 2026 ${env().PUBLIC_BRAND_NAME}</span><span class="legal-links"><a href="/privacy">隱私權</a> · <a href="/terms">服務條款</a> · <a href="/status">系統狀態</a> · <a href="/account">帳號</a>${supportEmail?` · <a href="mailto:${supportEmail}">客服：${supportEmail}</a>`:''}</span></footer></div></body></html>`;
}
function founderOriginOk(req:{headers:Record<string,string|string[]|undefined>}):boolean{
  return browserSameOriginOk(req.headers,env().PUBLIC_BASE_URL,env().NODE_ENV==='production');
}
function founderPrivateHeaders(reply:FastifyReply):void{
  reply.header('Cache-Control','no-store, private');
  reply.header('Pragma','no-cache');
  reply.header('X-Frame-Options','DENY');
  reply.header('X-Content-Type-Options','nosniff');
  reply.header('Referrer-Policy','no-referrer');
  reply.header('X-Robots-Tag','noindex, nofollow, noarchive');
  reply.header('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');
  reply.header('Cross-Origin-Opener-Policy','same-origin');
  reply.header('Cross-Origin-Resource-Policy','same-origin');
  reply.header('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}
function founderReturnTo(raw:unknown):string{
  const value=String(raw??'/founder');
  if((value.startsWith('/founder')||value==='/admin'||value.startsWith('/admin/'))&&!value.startsWith('//')&&!value.includes('\\')&&value.length<=300)return value;
  return '/founder';
}
async function requireFounder(req:FastifyRequest,reply:FastifyReply,returnTo='/founder',stepUp=true){
  founderPrivateHeaders(reply);
  const founderEmail=env().FOUNDER_EMAIL?.trim().toLowerCase();
  if(!founderEmail){reply.code(404).type('text/plain').send('Not found');return null;}
  const founder=await userFromSessionCookie(req.headers.cookie);
  // Private admin surface: never advertise its existence to signed-out or non-Founder requests.
  if(!founder||(founder.email??'').trim().toLowerCase()!==founderEmail){
    reply.code(404).type('text/plain').send('Not found');
    return null;
  }
  if(stepUp&&!hasFounderStepUp(req.headers.cookie)){
    reply.redirect(`/founder/unlock?return_to=${encodeURIComponent(founderReturnTo(returnTo))}`);
    return null;
  }
  return founder;
}
function founderCss(){return `<style>
  .founder-page{background:#f5f7fb;color:#1f2937}.founder-page .wrap{max-width:1500px;padding:0 24px}.founder-page nav{background:rgba(245,247,251,.94)}
  .fd{padding:24px 0 56px;color:#1f2937}.fd-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:20px}.fd-head-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.fd-data-status{display:flex;align-items:flex-start;gap:10px;min-height:40px;padding:9px 12px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.04)}.fd-live-dot{width:8px;height:8px;border-radius:50%;background:#26a773;box-shadow:0 0 0 4px rgba(38,167,115,.11);margin-top:5px;flex:0 0 auto}.fd-data-status strong{display:block;font-size:12px;line-height:1.35}.fd-data-status span{display:block;font-size:10px;color:#6b7280;line-height:1.4;margin-top:2px}.fd h1{font-size:30px;letter-spacing:0;line-height:1.2;margin:10px 0 6px}.fd-sub{color:#6b7280;margin:0;line-height:1.5}
  .fd-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:20px 0}.fd-card{background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:18px;min-width:0;min-height:150px;display:flex;flex-direction:column;box-shadow:0 4px 16px rgba(0,0,0,.06)}.fd-label{font-size:14px;text-transform:none;letter-spacing:0;color:#6b7280;font-weight:600;line-height:1.4}.fd-value{font-size:34px;font-weight:700;letter-spacing:0;line-height:1.15;margin-top:10px}.fd-measure{margin-top:8px}.fd-measure .fd-value{margin-top:0}.fd-unitline{margin-top:3px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8b8493}.fd-note{font-size:13px;color:#6b7280;margin-top:8px;line-height:1.5;text-wrap:pretty}
  .fd-funnel,.fd-funnel.activation{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:16px 0 24px;overflow:visible}.fd-step{padding:16px;border-radius:18px;border:1px solid #e5e7eb;background:#fff;box-shadow:0 4px 16px rgba(0,0,0,.05);min-width:0}.fd-step b{display:block;font-size:24px;font-weight:700;line-height:1.15}.fd-step span{display:block;margin-top:6px;font-size:12px;color:#6b7280;line-height:1.4;text-wrap:pretty}
  .fd-panel{margin-top:16px;border:1px solid #e5e7eb;border-radius:18px;background:#fff;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.06)}.fd-panel-head{padding:18px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.fd-panel-head h2{font-size:18px;margin:0;letter-spacing:0}.fd-scroll{overflow:auto}.fd-table{width:100%;border-collapse:collapse;font-size:13px;min-width:900px;table-layout:auto}.fd-table th,.fd-table td{text-align:left;padding:12px;border-bottom:1px solid #e5e7eb;white-space:nowrap;height:52px}.fd-table th{font-size:12px;text-transform:none;letter-spacing:0;color:#6b7280;background:#fff;font-weight:600}.fd-table tbody tr:hover{background:#fafafa}.fd-table a{font-weight:700}
  .fd-status{font-size:11px;font-weight:800;border-radius:999px;padding:4px 8px;display:inline-block}.fd-status.ok{color:#117557;background:#e8f7f1}.fd-status.bad{color:#a33b3b;background:#fdeeee}.fd-status.wait{color:#785d18;background:#fff6dc}.fd-chips{display:flex;flex-wrap:wrap;gap:8px}.fd-chip{border:1px solid #e5e7eb;background:#fff;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:700}.fd-private{font-size:12px;color:#6b7280;margin-top:16px}.fd-warning{border:1px dashed #cbd5e1;padding:12px 14px;border-radius:14px;color:#6b7280;font-size:12px;margin-top:14px}.fd-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.fd-input,.fd-select{border:1px solid #e5e7eb;background:#fff;border-radius:10px;padding:10px 12px;font:inherit;color:#1f2937;min-height:40px}.fd-input{min-width:240px}.fd-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.fd-field{display:grid;gap:6px}.fd-field label{font-size:12px;font-weight:700;color:#4b5563}.fd-field small{color:#6b7280;font-size:11px;line-height:1.4}.fd-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.fd-kv{display:grid;grid-template-columns:170px 1fr;gap:8px 16px;font-size:13px}.fd-kv b{color:#4b5563}.fd-nav{display:flex;gap:8px;align-items:center}.fd-muted{color:#6b7280}.fd-email{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.fd-okflash{padding:10px 12px;border-radius:10px;background:#e8f7f1;color:#117557;font-size:12px;font-weight:800;margin:12px 0}.fd-badflash{padding:10px 12px;border-radius:10px;background:#fdeeee;color:#a33b3b;font-size:12px;font-weight:800;margin:12px 0}.fd-security{font-size:12px;color:#4b5563}.founder-lock{max-width:760px;margin:24px auto;background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:24px;box-shadow:0 4px 16px rgba(0,0,0,.06)}
  @media(max-width:1200px){.fd-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.fd-funnel,.fd-funnel.activation{grid-template-columns:repeat(2,minmax(0,1fr))}.fd-head{flex-direction:column}.fd-head-actions{justify-content:flex-start;width:100%}}
  @media(max-width:700px){.founder-page .wrap{padding:0 16px}.fd{padding-top:18px}.fd-grid{grid-template-columns:1fr}.fd-funnel,.fd-funnel.activation{grid-template-columns:1fr}.fd-card{min-height:0;padding:16px}.fd-value{font-size:30px}.fd-form-grid{grid-template-columns:1fr}.fd-input{min-width:0;width:100%}.fd-kv{grid-template-columns:1fr}.fd-kv b{margin-top:6px}.fd-data-status{width:100%}.fd-head-actions{align-items:stretch}.founder-lock{padding:18px;margin:18px auto}}
</style>`;}

app.get('/founder/unlock',async(req,reply)=>{
  const returnTo=founderReturnTo((req.query as {return_to?:string})?.return_to);
  const founder=await requireFounder(req,reply,returnTo,false);
  if(!founder)return;
  if(hasFounderStepUp(req.headers.cookie))return reply.redirect(returnTo);
  const csrf=csrfTokenFromSessionCookie(req.headers.cookie);
  if(!csrf)return reply.code(401).type('text/plain').send('Session expired');
  const query=req.query as {sent?:string;error?:string;locked?:string;send_error?:string};
  const sent=String(query?.sent??'')==='1';
  const error=String(query?.error??'')==='1';
  const locked=String(query?.locked??'')==='1';
  const sendError=String(query?.send_error??'')==='1';
  const body=`<main class="fd">${founderCss()}<section class="founder-lock"><span class="badge"><span class="badge-dot"></span>Founder security</span><h1>重新確認管理權限</h1><p>Founder 後台包含帳號、方案與額度控制。請把 6 位數驗證碼寄到設定的 Founder Email；驗證碼 10 分鐘內有效，通過後管理權限維持 15 分鐘。</p>${sent?'<div class="fd-okflash">驗證碼已寄出。請查看 Founder Email。</div>':''}${sendError?'<div class="fd-badflash">目前無法寄送驗證碼，或寄送太頻繁。請稍後再試。</div>':''}${error?`<div class="fd-badflash">${locked?'驗證碼錯誤次數過多，這組驗證碼已失效。請重新寄送。':'驗證碼不正確、已使用或已過期。'}</div>`:''}<form method="post" action="/founder/unlock/send"><input type="hidden" name="csrf" value="${founderEscape(csrf)}"><input type="hidden" name="return_to" value="${founderEscape(returnTo)}"><div class="actions"><button class="btn alt" type="submit">${sent?'重新寄送驗證碼':'寄送 6 位驗證碼'}</button></div></form><form method="post" action="/founder/unlock"><input type="hidden" name="csrf" value="${founderEscape(csrf)}"><input type="hidden" name="return_to" value="${founderEscape(returnTo)}"><label>6 位數驗證碼</label><input type="text" name="code" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="000000"><div class="actions"><button class="btn purple" type="submit">驗證並解鎖 15 分鐘</button><a class="btn alt" href="/account">返回帳號</a></div></form><p class="fd-private">驗證碼只寄到 FOUNDER_EMAIL，且綁定目前登入 Session。此頁禁止快取、禁止 iframe。</p></section></main>`;
  return reply.type('text/html').send(founderShell(body,`${env().PUBLIC_BRAND_NAME} Founder 驗證`));
});

app.post('/founder/unlock/send',async(req,reply)=>{
  const body=(req.body??{}) as Record<string,unknown>;
  const returnTo=founderReturnTo(body.return_to);
  const founder=await requireFounder(req,reply,returnTo,false);
  if(!founder)return;
  if(!founderOriginOk(req as unknown as {headers:Record<string,string|string[]|undefined>})||!verifyCsrfToken(req.headers.cookie,String(body.csrf??''))){
    return reply.code(403).type('text/plain').send('Invalid request');
  }
  try{
    await beginFounderStepUp(founder.id,String(founder.email??''),req.headers.cookie,returnTo);
    await pool.query(`INSERT INTO founder_security_events(founder_user_id,action,success) VALUES($1,'otp_request',true)`,[founder.id]).catch(()=>{});
    return reply.redirect(`/founder/unlock?sent=1&return_to=${encodeURIComponent(returnTo)}`);
  }catch{
    await pool.query(`INSERT INTO founder_security_events(founder_user_id,action,success) VALUES($1,'otp_request',false)`,[founder.id]).catch(()=>{});
    return reply.redirect(`/founder/unlock?send_error=1&return_to=${encodeURIComponent(returnTo)}`);
  }
});

app.post('/founder/unlock',async(req,reply)=>{
  const body=(req.body??{}) as Record<string,unknown>;
  const returnTo=founderReturnTo(body.return_to);
  const founder=await requireFounder(req,reply,returnTo,false);
  if(!founder)return;
  if(!founderOriginOk(req as unknown as {headers:Record<string,string|string[]|undefined>})||!verifyCsrfToken(req.headers.cookie,String(body.csrf??''))){
    return reply.code(403).type('text/plain').send('Invalid request');
  }
  let result={ok:false,locked:false};
  try{result=await verifyFounderStepUp(founder.id,String(founder.email??''),req.headers.cookie,String(body.code??''));}catch{result={ok:false,locked:false};}
  await pool.query(`INSERT INTO founder_security_events(founder_user_id,action,success) VALUES($1,'otp_verify',$2)`,[founder.id,result.ok]).catch(()=>{});
  if(!result.ok)return reply.redirect(`/founder/unlock?error=1${result.locked?'&locked=1':''}&return_to=${encodeURIComponent(returnTo)}`);
  const cookie=createFounderStepUpCookie(req.headers.cookie,900);
  if(!cookie)return reply.code(401).type('text/plain').send('Session expired');
  reply.header('Set-Cookie',cookie);
  return reply.redirect(returnTo);
});

app.post('/founder/lock',async(req,reply)=>{
  const founder=await requireFounder(req,reply,'/founder',false);
  if(!founder)return;
  const body=(req.body??{}) as Record<string,unknown>;
  if(!founderOriginOk(req as unknown as {headers:Record<string,string|string[]|undefined>})||!verifyCsrfToken(req.headers.cookie,String(body.csrf??''))){
    return reply.code(403).type('text/plain').send('Invalid request');
  }
  await invalidateFounderStepUpChallenges(founder.id,req.headers.cookie).catch(()=>{});
  reply.header('Set-Cookie',clearFounderStepUpCookie());
  await pool.query(`INSERT INTO founder_security_events(founder_user_id,action,success) VALUES($1,'lock',true)`,[founder.id]).catch(()=>{});
  return reply.redirect('/account');
});

app.get('/founder',async(req,reply)=>{
  const founder=await requireFounder(req,reply,'/founder',true);
  if(!founder)return;
  const founderEmail=String(founder.email??'').trim().toLowerCase();
  const founderCsrf=csrfTokenFromSessionCookie(req.headers.cookie)??'';

  const q=String((req.query as {q?:string})?.q??'').trim().slice(0,160);
  const rawPage=Number((req.query as {page?:string})?.page??1);
  const page=Number.isFinite(rawPage)?Math.max(1,Math.floor(rawPage)):1;
  const pageSize=100;
  const offset=(page-1)*pageSize;

  const [summaryResult,recentJobsResult,platformResult,accountsCountResult,accountsResult,analyticsResult,topPagesResult,activationResult,sourceResult]=await Promise.all([
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
    pool.query<{user_id:string;email:string|null;platform:string;client_source:string;status:string;duration_seconds:number|null;error_code:string|null;created_at:string}>(
      `SELECT j.user_id,u.email,j.platform,j.client_source,j.status,j.duration_seconds,j.error_code,j.created_at
       FROM transcript_jobs j LEFT JOIN users u ON u.id=j.user_id
       ORDER BY j.created_at DESC LIMIT 20`
    ),
    pool.query<{platform:string;count:string}>(
      `SELECT j.platform,COUNT(*)::text AS count FROM usage_ledger l JOIN transcript_jobs j ON j.id=l.job_id GROUP BY j.platform ORDER BY COUNT(*) DESC`
    ),
    pool.query<{count:string}>(`SELECT COUNT(*)::text AS count FROM users WHERE email IS NOT NULL AND ($1='' OR email ILIKE '%'||$1||'%')`,[q]),
    pool.query<{
      id:string;email:string;plan:string;account_status:string;trial_eligible:boolean;analytics_excluded:boolean;admin_bonus_seconds:number;admin_bonus_videos:number;created_at:string;
      connected:boolean;links:string;seconds:string;failed:string;last_activity:string|null;
    }>(`SELECT u.id,u.email,u.plan,u.account_status,u.trial_eligible,u.analytics_excluded,u.admin_bonus_seconds,u.admin_bonus_videos,u.created_at,
        (EXISTS(SELECT 1 FROM oauth_access_tokens a WHERE a.user_id=u.id AND a.revoked_at IS NULL AND a.expires_at>now())
         OR EXISTS(SELECT 1 FROM oauth_refresh_tokens r WHERE r.user_id=u.id AND r.revoked_at IS NULL AND r.expires_at>now())) AS connected,
        COALESCE(us.links,0)::text AS links,COALESCE(us.seconds,0)::text AS seconds,COALESCE(js.failed,0)::text AS failed,
        GREATEST(u.updated_at,us.last_used,js.last_job) AS last_activity
       FROM users u
       LEFT JOIN (SELECT user_id,COUNT(*) links,COALESCE(SUM(seconds),0) seconds,MAX(created_at) last_used FROM usage_ledger GROUP BY user_id) us ON us.user_id=u.id
       LEFT JOIN (SELECT user_id,COUNT(*) FILTER(WHERE status='failed') failed,MAX(created_at) last_job FROM transcript_jobs GROUP BY user_id) js ON js.user_id=u.id
       WHERE u.email IS NOT NULL AND ($1='' OR u.email ILIKE '%'||$1||'%')
       ORDER BY GREATEST(u.updated_at,us.last_used,js.last_job) DESC NULLS LAST,u.created_at DESC LIMIT $2 OFFSET $3`,[q,pageSize,offset]),
    pool.query<{
      visitors_total:string;visitors_24h:string;visitors_7d:string;pageviews_total:string;pageviews_24h:string;pageviews_7d:string;
      external_pageviews_total:string;external_pageviews_24h:string;external_pageviews_7d:string;
      connect_visitors_total:string;signed_up_total:string;activated_visitors_total:string;non_founder_7d:string;
      historical_visitors_total:string;historical_pageviews_total:string;tracking_started_at:string|null;tracking_last_at:string|null;
    }>(`SELECT
      (SELECT COUNT(*) FROM website_visitors)::text AS visitors_total,
      (SELECT COUNT(DISTINCT visitor_id) FROM website_pageviews WHERE created_at>now()-interval '24 hours')::text AS visitors_24h,
      (SELECT COUNT(DISTINCT visitor_id) FROM website_pageviews WHERE created_at>now()-interval '7 days')::text AS visitors_7d,
      (SELECT COUNT(*) FROM website_pageviews)::text AS pageviews_total,
      (SELECT COUNT(*) FROM website_pageviews WHERE created_at>now()-interval '24 hours')::text AS pageviews_24h,
      (SELECT COUNT(*) FROM website_pageviews WHERE created_at>now()-interval '7 days')::text AS pageviews_7d,
      (SELECT COUNT(*) FROM website_pageviews p JOIN website_visitors v ON v.visitor_id=p.visitor_id LEFT JOIN users u ON u.id=v.user_id WHERE COALESCE(lower(u.email),'')<>$1 AND COALESCE(u.analytics_excluded,false)=false)::text AS external_pageviews_total,
      (SELECT COUNT(*) FROM website_pageviews p JOIN website_visitors v ON v.visitor_id=p.visitor_id LEFT JOIN users u ON u.id=v.user_id WHERE p.created_at>now()-interval '24 hours' AND COALESCE(lower(u.email),'')<>$1 AND COALESCE(u.analytics_excluded,false)=false)::text AS external_pageviews_24h,
      (SELECT COUNT(*) FROM website_pageviews p JOIN website_visitors v ON v.visitor_id=p.visitor_id LEFT JOIN users u ON u.id=v.user_id WHERE p.created_at>now()-interval '7 days' AND COALESCE(lower(u.email),'')<>$1 AND COALESCE(u.analytics_excluded,false)=false)::text AS external_pageviews_7d,
      (SELECT COUNT(DISTINCT visitor_id) FROM website_pageviews WHERE path='/connect')::text AS connect_visitors_total,
      (SELECT COUNT(*) FROM website_visitors WHERE signed_up_at IS NOT NULL)::text AS signed_up_total,
      (SELECT COUNT(DISTINCT v.visitor_id) FROM website_visitors v JOIN usage_ledger l ON l.user_id=v.user_id WHERE v.signed_up_at IS NOT NULL)::text AS activated_visitors_total,
      (SELECT COUNT(*) FROM website_visitors v LEFT JOIN users u ON u.id=v.user_id WHERE v.last_seen_at>now()-interval '7 days' AND COALESCE(lower(u.email),'')<>$1 AND COALESCE(u.analytics_excluded,false)=false)::text AS non_founder_7d,
      (SELECT COUNT(*) FROM website_visitors WHERE analytics_source='historical_backfill')::text AS historical_visitors_total,
      (SELECT COUNT(*) FROM website_pageviews WHERE source_key IS NOT NULL)::text AS historical_pageviews_total,
      (SELECT MIN(created_at) FROM website_pageviews) AS tracking_started_at,
      GREATEST(
        (SELECT MAX(created_at) FROM website_pageviews),
        (SELECT MAX(created_at) FROM usage_ledger),
        (SELECT MAX(created_at) FROM transcript_jobs)
      ) AS tracking_last_at`,[founderEmail]),
    pool.query<{path:string;views:string;visitors:string}>(
      `SELECT path,COUNT(*)::text AS views,COUNT(DISTINCT visitor_id)::text AS visitors
       FROM website_pageviews WHERE created_at>now()-interval '7 days'
       GROUP BY path ORDER BY COUNT(*) DESC,COUNT(DISTINCT visitor_id) DESC LIMIT 10`
    ),
    pool.query<{
      external_visitors_all:string;activation_visitors:string;activation_started_at:string|null;
      cta_starts:string;signup_views:string;signup_submits:string;signup_failures:string;external_signups:string;connect_clicks:string;
      external_connected:string;external_activated:string;external_paid:string;
    }>(`WITH epoch AS (
      SELECT started_at FROM analytics_epochs WHERE key='website_v2_activation'
    )
    SELECT
      (SELECT COUNT(*) FROM website_visitors v LEFT JOIN users u ON u.id=v.user_id WHERE COALESCE(lower(u.email),'')<>$1 AND COALESCE(u.analytics_excluded,false)=false)::text AS external_visitors_all,
      (SELECT COUNT(DISTINCT p.visitor_id)
         FROM website_pageviews p
         JOIN website_visitors v ON v.visitor_id=p.visitor_id
         LEFT JOIN users u ON u.id=v.user_id
         CROSS JOIN epoch ep
        WHERE p.created_at>=ep.started_at AND COALESCE(lower(u.email),'')<>$1 AND COALESCE(u.analytics_excluded,false)=false)::text AS activation_visitors,
      (SELECT started_at FROM epoch) AS activation_started_at,
      (SELECT COUNT(DISTINCT e.visitor_id)
         FROM website_events e
         JOIN website_visitors v ON v.visitor_id=e.visitor_id
         LEFT JOIN users u ON u.id=v.user_id
         CROSS JOIN epoch ep
        WHERE e.event_name='cta_start' AND e.created_at>=ep.started_at AND COALESCE(lower(u.email),'')<>$1 AND COALESCE(u.analytics_excluded,false)=false)::text AS cta_starts,
      (SELECT COUNT(DISTINCT p.visitor_id)
         FROM website_pageviews p
         JOIN website_visitors v ON v.visitor_id=p.visitor_id
         LEFT JOIN users u ON u.id=v.user_id
         CROSS JOIN epoch ep
        WHERE p.path='/signup' AND p.created_at>=ep.started_at AND COALESCE(lower(u.email),'')<>$1 AND COALESCE(u.analytics_excluded,false)=false)::text AS signup_views,
      (SELECT COUNT(DISTINCT e.visitor_id)
         FROM website_events e
         JOIN website_visitors v ON v.visitor_id=e.visitor_id
         LEFT JOIN users u ON u.id=v.user_id
         CROSS JOIN epoch ep
        WHERE e.event_name='signup_submit' AND e.created_at>=ep.started_at AND COALESCE(lower(u.email),'')<>$1 AND COALESCE(u.analytics_excluded,false)=false)::text AS signup_submits,
      (SELECT COUNT(DISTINCT e.visitor_id)
         FROM website_events e
         JOIN website_visitors v ON v.visitor_id=e.visitor_id
         LEFT JOIN users u ON u.id=v.user_id
         CROSS JOIN epoch ep
        WHERE e.event_name='signup_failed' AND e.created_at>=ep.started_at AND COALESCE(lower(u.email),'')<>$1 AND COALESCE(u.analytics_excluded,false)=false)::text AS signup_failures,
      (SELECT COUNT(*)
         FROM website_visitors v
         JOIN users u ON u.id=v.user_id
         CROSS JOIN epoch ep
        WHERE v.signed_up_at>=ep.started_at AND lower(u.email)<>$1 AND u.analytics_excluded=false)::text AS external_signups,
      (SELECT COUNT(DISTINCT e.visitor_id)
         FROM website_events e
         JOIN website_visitors v ON v.visitor_id=e.visitor_id
         LEFT JOIN users u ON u.id=v.user_id
         CROSS JOIN epoch ep
        WHERE e.event_name='connect_install_click' AND e.created_at>=ep.started_at AND COALESCE(lower(u.email),'')<>$1 AND COALESCE(u.analytics_excluded,false)=false)::text AS connect_clicks,
      (SELECT COUNT(DISTINCT v.visitor_id)
         FROM website_visitors v
         JOIN users u ON u.id=v.user_id
         CROSS JOIN epoch ep
        WHERE v.signed_up_at>=ep.started_at AND lower(u.email)<>$1 AND u.analytics_excluded=false
          AND (EXISTS(SELECT 1 FROM oauth_access_tokens a WHERE a.user_id=u.id AND a.revoked_at IS NULL AND a.expires_at>now())
            OR EXISTS(SELECT 1 FROM oauth_refresh_tokens r WHERE r.user_id=u.id AND r.revoked_at IS NULL AND r.expires_at>now())))::text AS external_connected,
      (SELECT COUNT(DISTINCT v.visitor_id)
         FROM website_visitors v
         JOIN users u ON u.id=v.user_id
         JOIN usage_ledger l ON l.user_id=u.id
         CROSS JOIN epoch ep
        WHERE v.signed_up_at>=ep.started_at AND l.created_at>=ep.started_at AND lower(u.email)<>$1 AND u.analytics_excluded=false)::text AS external_activated,
      (SELECT COUNT(DISTINCT v.visitor_id)
         FROM website_visitors v
         JOIN users u ON u.id=v.user_id
         CROSS JOIN epoch ep
        WHERE v.signed_up_at>=ep.started_at AND lower(u.email)<>$1 AND u.analytics_excluded=false AND u.plan IN ('basic','pro') AND u.account_status='active')::text AS external_paid`,[founderEmail]),
    pool.query<{source:string;visitors:string;signups:string}>(`WITH epoch AS (
      SELECT started_at FROM analytics_epochs WHERE key='website_v2_activation'
    ), active_visitors AS (
      SELECT DISTINCT p.visitor_id
      FROM website_pageviews p CROSS JOIN epoch ep
      WHERE p.created_at>=ep.started_at
    )
    SELECT
      COALESCE(NULLIF(v.utm_source,''),NULLIF(v.first_referrer,''),'direct / unknown') AS source,
      COUNT(*)::text AS visitors,
      COUNT(*) FILTER(WHERE v.signed_up_at>=(SELECT started_at FROM epoch))::text AS signups
      FROM active_visitors av
      JOIN website_visitors v ON v.visitor_id=av.visitor_id
      LEFT JOIN users u ON u.id=v.user_id
      WHERE COALESCE(lower(u.email),'')<>$1 AND COALESCE(u.analytics_excluded,false)=false
      GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 12`,[founderEmail])
  ]);

  const productFunnelResult=await pool.query<{
    connect_cta_click:string;connection_started:string;connection_success:string;
    connector_enabled:string;first_link_attempt:string;first_successful_read:string;
  }>(`SELECT
      COUNT(DISTINCT user_id) FILTER(WHERE event_name='connect_cta_click')::text AS connect_cta_click,
      COUNT(DISTINCT user_id) FILTER(WHERE event_name='connection_started')::text AS connection_started,
      COUNT(DISTINCT user_id) FILTER(WHERE event_name='connection_success')::text AS connection_success,
      COUNT(DISTINCT user_id) FILTER(WHERE event_name='connector_enabled')::text AS connector_enabled,
      COUNT(DISTINCT user_id) FILTER(WHERE event_name='first_link_attempt')::text AS first_link_attempt,
      COUNT(DISTINCT user_id) FILTER(WHERE event_name='first_successful_read')::text AS first_successful_read
    FROM product_activation_events e
    JOIN users u ON u.id=e.user_id
    WHERE COALESCE(e.distribution_profile,'default')='default'
      AND COALESCE(lower(u.email),'')<>$1
      AND COALESCE(u.analytics_excluded,false)=false`,[founderEmail]);

  const providerHealthResult=await pool.query<{
    platform:string;operation:string;provider:string;attempts:string;successes:string;failures:string;
    retryable_failures:string;avg_duration_ms:string;last_error_code:string|null;
  }>(`SELECT
      platform,operation,provider,
      SUM(attempts)::text AS attempts,
      SUM(successes)::text AS successes,
      SUM(failures)::text AS failures,
      SUM(retryable_failures)::text AS retryable_failures,
      CASE WHEN SUM(attempts)>0 THEN ROUND(SUM(total_duration_ms)::numeric/SUM(attempts))::text ELSE '0' END AS avg_duration_ms,
      (array_agg(last_error_code ORDER BY bucket_start DESC) FILTER(WHERE last_error_code IS NOT NULL))[1] AS last_error_code
    FROM provider_health_hourly
    WHERE bucket_start>=date_trunc('hour',now()-interval '24 hours')
    GROUP BY platform,operation,provider
    ORDER BY platform,operation,provider`);

  const m=summaryResult.rows[0];
  const accounts=founderNum(m?.accounts_total),connected=founderNum(m?.connected_total),activated=founderNum(m?.activated_total),paid=founderNum(m?.paid_total);
  const links=founderNum(m?.links_total),seconds=founderNum(m?.seconds_total);
  const a=analyticsResult.rows[0];
  const visitors=founderNum(a?.visitors_total),visitorSignups=founderNum(a?.signed_up_total),visitorActivated=founderNum(a?.activated_visitors_total),connectVisitors=founderNum(a?.connect_visitors_total);
  const externalPageviews=founderNum(a?.external_pageviews_total),externalPageviews24h=founderNum(a?.external_pageviews_24h),externalPageviews7d=founderNum(a?.external_pageviews_7d);
  const activation=activationResult.rows[0];
  const externalVisitorsAll=founderNum(activation?.external_visitors_all),activationVisitors=founderNum(activation?.activation_visitors),ctaStarts=founderNum(activation?.cta_starts),signupViews=founderNum(activation?.signup_views),signupSubmits=founderNum(activation?.signup_submits),signupFailures=founderNum(activation?.signup_failures),externalSignups=founderNum(activation?.external_signups),connectClicks=founderNum(activation?.connect_clicks),externalConnected=founderNum(activation?.external_connected),externalActivated=founderNum(activation?.external_activated),externalPaid=founderNum(activation?.external_paid);
  const activationStarted=founderTime(activation?.activation_started_at);
  const productFunnel=productFunnelResult.rows[0];
  const productConnectCta=founderNum(productFunnel?.connect_cta_click);
  const productConnectionStarted=founderNum(productFunnel?.connection_started);
  const productConnectionSuccess=founderNum(productFunnel?.connection_success);
  const productConnectorEnabled=founderNum(productFunnel?.connector_enabled);
  const productFirstLinkAttempt=founderNum(productFunnel?.first_link_attempt);
  const productFirstSuccessfulRead=founderNum(productFunnel?.first_successful_read);
  const providerHealthRows=providerHealthResult.rows.map(row=>{
    const attempts=founderNum(row.attempts),successes=founderNum(row.successes),failures=founderNum(row.failures);
    const health=attempts>0?Math.round(successes/attempts*100):0;
    return `<tr><td>${founderEscape(row.platform)}</td><td>${founderEscape(row.operation)}</td><td class="fd-email">${founderEscape(row.provider)}</td><td>${attempts}</td><td><span class="fd-status ${health>=90?'ok':health>=60?'wait':'bad'}">${health}%</span></td><td>${failures}</td><td>${founderNum(row.retryable_failures)}</td><td>${founderNum(row.avg_duration_ms)} ms</td><td>${founderEscape(row.last_error_code??'—')}</td></tr>`;
  }).join('')||'<tr><td colspan="9">最近 24 小時尚無 provider attempts。</td></tr>';
  const sourceRows=sourceResult.rows.map(row=>`<tr><td class="fd-source">${founderEscape(row.source)}</td><td>${founderNum(row.visitors)}</td><td>${founderNum(row.signups)}</td><td>${founderPct(founderNum(row.signups),Math.max(founderNum(row.visitors),1))}</td></tr>`).join('')||'<tr><td colspan="4">尚無外部來源資料。</td></tr>';
  const renderedAt=founderTime(new Date().toISOString());
  const trackingStarted=founderTime(a?.tracking_started_at);
  const trackingLast=founderTime(a?.tracking_last_at);
  const topPages=topPagesResult.rows.map(row=>`<tr><td class="fd-email">${founderEscape(row.path)}</td><td>${founderNum(row.visitors)}</td><td>${founderNum(row.views)}</td></tr>`).join('')||'<tr><td colspan="3">目前還沒有網站瀏覽紀錄。</td></tr>';
  const recentJobs=recentJobsResult.rows.map(row=>`<tr><td>${founderTime(row.created_at)}</td><td class="fd-email"><a href="/founder/user/${founderEscape(row.user_id)}">${founderEscape(row.email??'匿名')}</a></td><td>${founderEscape(clientSourceLabel(row.client_source))}</td><td>${founderEscape(row.platform)}</td><td><span class="fd-status ${row.status==='completed'?'ok':row.status==='failed'?'bad':'wait'}">${founderEscape(founderJobStatusLabel(row.status))}</span></td><td>${row.duration_seconds?`${Math.ceil(row.duration_seconds/60)} 分鐘`:'—'}</td><td>${founderEscape(row.error_code??'—')}</td></tr>`).join('')||'<tr><td colspan="7">目前還沒有工作紀錄。</td></tr>';
  const platforms=platformResult.rows.map(row=>`<span class="fd-chip">${founderEscape(row.platform)} · ${founderNum(row.count)}</span>`).join('')||'<span class="fd-chip">目前還沒有成功連結</span>';
  const totalMatched=founderNum(accountsCountResult.rows[0]?.count);
  const totalPages=Math.max(1,Math.ceil(totalMatched/pageSize));
  const accountRows=accountsResult.rows.map(row=>`<tr><td class="fd-email"><a href="/founder/user/${founderEscape(row.id)}">${founderEscape(row.email)}</a></td><td>${founderEscape(founderPlanLabel(row.plan))}</td><td>${founderEscape(founderAccountStatusLabel(row.account_status))}</td><td>${row.trial_eligible?'是':'否'}</td><td>${row.analytics_excluded?'排除':'external'}</td><td>${row.connected?'✓':'—'}</td><td>${founderNum(row.links)}</td><td>${founderUnits(row.seconds)}</td><td>${founderNum(row.failed)}</td><td>${founderTime(row.last_activity)}</td><td><a class="btn alt sm" href="/founder/user/${founderEscape(row.id)}">管理</a></td></tr>`).join('')||'<tr><td colspan="11">找不到符合的帳號。</td></tr>';
  const searchValue=founderEscape(q);
  const querySuffix=q?`&q=${encodeURIComponent(q)}`:'';
  const prev=page>1?`<a class="btn alt sm" href="/founder?page=${page-1}${querySuffix}">← 上一頁</a>`:'';
  const next=page<totalPages?`<a class="btn alt sm" href="/founder?page=${page+1}${querySuffix}">下一頁 →</a>`:'';

  const html=`<main class="fd">${founderCss()}<div class="fd-head"><div><span class="badge"><span class="badge-dot"></span>Founder 私人後台</span><h1>Link2AI 後台</h1><p class="fd-sub">網站流量、產品使用情況與帳號管理。完整 Email 只會顯示在這裡。</p></div><div class="fd-head-actions"><div class="fd-data-status"><span class="fd-live-dot"></span><div><strong>資料截至 ${renderedAt}</strong><span>台灣時間 · 網站記錄自 ${trackingStarted} · 最近事件 ${trackingLast}</span></div></div><span class="fd-security">已通過 Founder 驗證 · 15 分鐘</span><a class="btn alt sm" href="/founder">重新整理</a><form method="post" action="/founder/lock" style="margin:0"><input type="hidden" name="csrf" value="${founderEscape(founderCsrf)}"><button class="btn alt sm" type="submit">鎖定後台</button></form></div></div>
    <section class="fd-grid">
      <div class="fd-card"><div class="fd-label">瀏覽次數</div><div class="fd-value">${externalPageviews}</div><div class="fd-note">今天 ${externalPageviews24h} · 近 7 天 ${externalPageviews7d} · 排除 Founder / 內部測試</div></div>
      <div class="fd-card"><div class="fd-label">外部訪客</div><div class="fd-value">${externalVisitorsAll}</div><div class="fd-note">近 7 天 ${founderNum(a?.non_founder_7d)} · 不重複訪客</div></div>
      <div class="fd-card"><div class="fd-label">外部註冊</div><div class="fd-value">${externalSignups}</div><div class="fd-note">註冊率 ${founderPct(externalSignups,Math.max(activationVisitors,1))} · 送出 ${signupSubmits} · 失敗 ${signupFailures}</div></div>
      <div class="fd-card"><div class="fd-label">首次成功使用</div><div class="fd-value">${externalActivated}</div><div class="fd-note">外部已連接 AI ${externalConnected} · 註冊→首次成功 ${founderPct(externalActivated,Math.max(externalSignups,1))}</div></div>
      <div class="fd-card"><div class="fd-label">成功讀取</div><div class="fd-value">${links}</div><div class="fd-note">今天 +${founderNum(m?.links_24h)} · 近 7 天 +${founderNum(m?.links_7d)}</div></div>
      <div class="fd-card"><div class="fd-label">失敗工作</div><div class="fd-value">${founderNum(m?.failed_24h)}</div><div class="fd-note">今天 · 近 7 天 ${founderNum(m?.failed_7d)}</div></div>
      <div class="fd-card"><div class="fd-label">付費使用者</div><div class="fd-value">${paid}</div><div class="fd-note">Basic ${founderNum(m?.basic_total)} · Pro ${founderNum(m?.pro_total)}</div></div>
      <div class="fd-card"><div class="fd-label">已處理內容</div><div class="fd-measure"><div class="fd-value">${founderUnits(seconds)}</div><div class="fd-unitline">processing units</div></div><div class="fd-note">近 7 天 ${founderUnits(m?.seconds_7d)} units</div></div>
    </section>
    <section><div class="fd-label" style="margin-bottom:8px">外部啟用漏斗 · 排除 Founder / 內部測試 · 自 ${activationStarted} 起</div><div class="fd-funnel activation"><div class="fd-step"><b>${activationVisitors}</b><span>可比較外部訪客</span></div><div class="fd-step"><b>${ctaStarts}</b><span>點主 CTA · ${founderPct(ctaStarts,Math.max(activationVisitors,1))}</span></div><div class="fd-step"><b>${signupViews}</b><span>看註冊頁 · ${founderPct(signupViews,Math.max(activationVisitors,1))}</span></div><div class="fd-step"><b>${signupSubmits}</b><span>送出註冊 · ${founderPct(signupSubmits,Math.max(signupViews,1))}</span></div><div class="fd-step"><b>${externalSignups}</b><span>完成註冊 · ${founderPct(externalSignups,Math.max(signupSubmits,1))}</span></div><div class="fd-step"><b>${externalConnected}</b><span>AI connected · ${founderPct(externalConnected,Math.max(externalSignups,1))}</span></div><div class="fd-step"><b>${externalActivated}</b><span>首次成功 read · ${founderPct(externalActivated,Math.max(externalConnected,1))}</span></div><div class="fd-step"><b>${externalPaid}</b><span>付費 · ${founderPct(externalPaid,Math.max(externalActivated,1))}</span></div></div><div class="fd-note">舊 Railway 回補流量仍保留在總訪客與熱門頁面，但不混進這條新漏斗的轉換率；這樣接下來累積到約 100 個 relevant external visitors 時才可直接比較。</div></section>
    <section><div class="fd-label" style="margin-bottom:8px">Claude 連線 → 首次成功讀取 · 新 activation 埋點</div><div class="fd-funnel activation"><div class="fd-step"><b>${productConnectCta}</b><span>Connect CTA</span></div><div class="fd-step"><b>${productConnectionStarted}</b><span>OAuth started · ${founderPct(productConnectionStarted,Math.max(productConnectCta,1))}</span></div><div class="fd-step"><b>${productConnectionSuccess}</b><span>Connected · ${founderPct(productConnectionSuccess,Math.max(productConnectionStarted,1))}</span></div><div class="fd-step"><b>${productConnectorEnabled}</b><span>Connector usable* · ${founderPct(productConnectorEnabled,Math.max(productConnectionSuccess,1))}</span></div><div class="fd-step"><b>${productFirstLinkAttempt}</b><span>First link attempt · ${founderPct(productFirstLinkAttempt,Math.max(productConnectorEnabled,1))}</span></div><div class="fd-step"><b>${productFirstSuccessfulRead}</b><span>First successful read · ${founderPct(productFirstSuccessfulRead,Math.max(productFirstLinkAttempt,1))}</span></div></div><div class="fd-note">* Claude 不提供「使用者剛剛切開 connector toggle」的 server-side webhook，因此 connector usable 是在第一個已驗證 Link2AI tool call 抵達後推定；它可以區分「已授權但從未真正用到」與「connector 已經在對話中可被呼叫」。這組資料從本版上線後開始累積，不回推舊使用者。</div></section>
    <section class="fd-panel"><div class="fd-panel-head"><div><h2>Source provider health</h2><div class="fd-note">最近 24 小時 · 每個 provider attempt 都會記成功／失敗、延遲與錯誤類型；不保存來源 URL 或內容。</div></div><span class="fd-label">rolling 24h</span></div><div class="fd-scroll"><table class="fd-table" style="min-width:980px"><thead><tr><th>平台</th><th>操作</th><th>Provider</th><th>Attempts</th><th>成功率</th><th>失敗</th><th>可重試失敗</th><th>平均延遲</th><th>最近錯誤</th></tr></thead><tbody>${providerHealthRows}</tbody></table></div></section>
    <section class="fd-panel"><div class="fd-panel-head"><div><h2>流量來源</h2><div class="fd-note">UTM source 優先；沒有 UTM 時只保存 referrer hostname，不保存完整 referrer URL、IP 或 User-Agent。</div></div><span class="fd-label">external only</span></div><div class="fd-scroll"><table class="fd-table" style="min-width:620px"><thead><tr><th>來源</th><th>訪客</th><th>註冊</th><th>註冊率</th></tr></thead><tbody>${sourceRows}</tbody></table></div></section>
    <section class="fd-panel"><div class="fd-panel-head"><div><h2>熱門網站頁面</h2><div class="fd-note">最近 7 天 · 匿名第一方統計</div></div><span class="fd-label">不儲存 IP</span></div><div class="fd-scroll"><table class="fd-table" style="min-width:520px"><thead><tr><th>頁面</th><th>不重複訪客</th><th>瀏覽次數</th></tr></thead><tbody>${topPages}</tbody></table></div></section>
    <section><div class="fd-label" style="margin-bottom:8px">產品轉換漏斗</div><div class="fd-funnel"><div class="fd-step"><b>${accounts}</b><span>帳號</span></div><div class="fd-step"><b>${connected}</b><span>已連接 AI · ${founderPct(connected,accounts)}</span></div><div class="fd-step"><b>${activated}</b><span>首次成功連結 · ${founderPct(activated,accounts)}</span></div><div class="fd-step"><b>${paid}</b><span>付費 · 佔已啟用使用者 ${founderPct(paid,Math.max(activated,1))}</span></div></div></section>
    <section class="fd-panel"><div class="fd-panel-head"><div><h2>所有帳號</h2><div class="fd-note">${totalMatched} 筆符合 · 第 ${page}／${totalPages} 頁</div></div><form method="get" action="/founder" class="fd-tools"><input class="fd-input" type="search" name="q" value="${searchValue}" placeholder="搜尋 Email"><button class="btn alt sm" type="submit">搜尋</button>${q?'<a class="btn alt sm" href="/founder">清除</a>':''}</form></div><div class="fd-scroll"><table class="fd-table"><thead><tr><th>Email</th><th>方案</th><th>狀態</th><th>試用資格</th><th>統計</th><th>AI</th><th>成功連結</th><th>Processing units</th><th>失敗</th><th>最後活動</th><th></th></tr></thead><tbody>${accountRows}</tbody></table></div><div class="fd-panel-head"><span class="fd-label">每頁 100 筆</span><div class="fd-nav">${prev}${next}</div></div></section>
    <section class="fd-panel"><div class="fd-panel-head"><h2>最近工作</h2><span class="fd-label">最近 20 筆</span></div><div class="fd-scroll"><table class="fd-table"><thead><tr><th>時間</th><th>Email</th><th>使用入口</th><th>平台</th><th>狀態</th><th>長度</th><th>錯誤</th></tr></thead><tbody>${recentJobs}</tbody></table></div></section>
    <div class="fd-warning">Analytics 上線前的可辨識網站瀏覽已從 Railway 舊 HTTP logs 回補。歷史不重複訪客是匿名估算值；明顯 bot／爬蟲已排除。回補資料只保存匿名識別碼、頁面與時間，不保存原始 IP 或 User-Agent，也不推測無法確認的歷史註冊歸因。</div><div class="fd-warning">後台調整不會刪除使用紀錄。額外額度會加在原方案上；手動修改方案後，之後仍可能被 Lemon Squeezy 的正式訂閱 webhook 更新。</div>
    <p class="fd-private">私人頁面。除了 FOUNDER_EMAIL 登入外，還需要 15 分鐘有效的 Founder Email 驗證；管理 POST 另外驗證 CSRF 與同源請求。</p></main>`;
  return reply.type('text/html').send(founderShell(html,`${env().PUBLIC_BRAND_NAME} 後台`));
});

app.get('/founder/user/:id',async(req,reply)=>{
  const targetId=String((req.params as {id?:string})?.id??'');
  const founder=await requireFounder(req,reply,`/founder/user/${encodeURIComponent(targetId)}`,true);
  if(!founder)return;
  const founderCsrf=csrfTokenFromSessionCookie(req.headers.cookie)??'';
  const accountResult=await pool.query<{
    id:string;email:string|null;plan:string;account_status:string;trial_eligible:boolean;analytics_excluded:boolean;admin_bonus_seconds:number;admin_bonus_videos:number;created_at:string;updated_at:string;connected:boolean;
  }>(`SELECT u.id,u.email,u.plan,u.account_status,u.trial_eligible,u.analytics_excluded,u.admin_bonus_seconds,u.admin_bonus_videos,u.created_at,u.updated_at,
      (EXISTS(SELECT 1 FROM oauth_access_tokens a WHERE a.user_id=u.id AND a.revoked_at IS NULL AND a.expires_at>now())
       OR EXISTS(SELECT 1 FROM oauth_refresh_tokens r WHERE r.user_id=u.id AND r.revoked_at IS NULL AND r.expires_at>now())) AS connected
      FROM users u WHERE u.id=$1`,[targetId]);
  if(!accountResult.rowCount)return reply.code(404).type('text/plain').send('Not found');
  const account=accountResult.rows[0];
  const [usage,allTimeResult,jobsResult,clientUsageResult,accessResult,auditResult]=await Promise.all([
    getUsageSnapshot(targetId),
    pool.query<{links:string;seconds:string;failed:string;last_job:string|null}>(`SELECT
      (SELECT COUNT(*) FROM usage_ledger WHERE user_id=$1)::text links,
      COALESCE((SELECT SUM(seconds) FROM usage_ledger WHERE user_id=$1),0)::text seconds,
      (SELECT COUNT(*) FROM transcript_jobs WHERE user_id=$1 AND status='failed')::text failed,
      (SELECT MAX(created_at) FROM transcript_jobs WHERE user_id=$1) last_job`,[targetId]),
    pool.query<{id:string;platform:string;client_source:string;status:string;duration_seconds:number|null;error_code:string|null;created_at:string}>(`SELECT id,platform,client_source,status,duration_seconds,error_code,created_at FROM transcript_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`,[targetId]),
    pool.query<{client_source:string;accesses:string;cache_reuses:string;billed_seconds:string}>(`WITH access AS (
      SELECT client_source,COUNT(*)::bigint accesses,COUNT(*) FILTER(WHERE reused)::bigint cache_reuses
      FROM source_access_events WHERE user_id=$1 GROUP BY client_source
    ), billed AS (
      SELECT j.client_source,COALESCE(SUM(l.seconds),0)::bigint billed_seconds
      FROM usage_ledger l JOIN transcript_jobs j ON j.id=l.job_id
      WHERE l.user_id=$1 GROUP BY j.client_source
    )
    SELECT COALESCE(a.client_source,b.client_source) client_source,
      COALESCE(a.accesses,0)::text accesses,COALESCE(a.cache_reuses,0)::text cache_reuses,COALESCE(b.billed_seconds,0)::text billed_seconds
    FROM access a FULL JOIN billed b ON b.client_source=a.client_source
    ORDER BY COALESCE(a.accesses,0) DESC,COALESCE(b.billed_seconds,0) DESC`,[targetId]),
    pool.query<{created_at:string;client_source:string;platform:string;reused:boolean;job_id:string|null;status:string|null}>(`SELECT e.created_at,e.client_source,e.platform,e.reused,e.job_id,j.status
      FROM source_access_events e LEFT JOIN transcript_jobs j ON j.id=e.job_id
      WHERE e.user_id=$1 ORDER BY e.created_at DESC LIMIT 30`,[targetId]),
    pool.query<{action:string;before_state:unknown;after_state:unknown;created_at:string}>(`SELECT action,before_state,after_state,created_at FROM founder_admin_events WHERE target_user_id=$1 ORDER BY created_at DESC LIMIT 10`,[targetId])
  ]);
  const a=allTimeResult.rows[0];
  const flash=String((req.query as {saved?:string;error?:string})?.saved??'')==='1'?'<div class="fd-okflash">已儲存。</div>':String((req.query as {error?:string})?.error??'')?`<div class="fd-badflash">${founderEscape((req.query as {error?:string}).error)}</div>`:'';
  const jobRows=jobsResult.rows.map(row=>`<tr><td>${founderTime(row.created_at)}</td><td>${founderEscape(clientSourceLabel(row.client_source))}</td><td>${founderEscape(row.platform)}</td><td>${founderEscape(founderJobStatusLabel(row.status))}</td><td>${row.duration_seconds?`${Math.ceil(row.duration_seconds/60)} 分鐘`:'—'}</td><td>${founderEscape(row.error_code??'—')}</td><td class="fd-email">${founderEscape(row.id)}</td></tr>`).join('')||'<tr><td colspan="7">目前還沒有工作紀錄。</td></tr>';
  const clientUsageRows=clientUsageResult.rows.map(row=>`<tr><td>${founderEscape(clientSourceLabel(row.client_source))}</td><td>${founderNum(row.accesses)}</td><td>${founderNum(row.cache_reuses)}</td><td>${founderUnits(row.billed_seconds)}</td></tr>`).join('')||'<tr><td colspan="4">本帳號尚無可歸因的使用紀錄。</td></tr>';
  const accessRows=accessResult.rows.map(row=>`<tr><td>${founderTime(row.created_at)}</td><td>${founderEscape(clientSourceLabel(row.client_source))}</td><td>${founderEscape(row.platform)}</td><td>${row.reused?'Cache / in-flight reuse':'New job'}</td><td>${founderEscape(row.status?founderJobStatusLabel(row.status):'—')}</td><td class="fd-email">${founderEscape(row.job_id??'—')}</td></tr>`).join('')||'<tr><td colspan="6">目前還沒有使用入口紀錄。</td></tr>';
  const auditRows=auditResult.rows.map(row=>`<tr><td>${founderTime(row.created_at)}</td><td>${founderEscape(founderActionLabel(row.action))}</td><td class="fd-muted">${founderEscape(JSON.stringify(row.after_state??{}))}</td></tr>`).join('')||'<tr><td colspan="3">目前還沒有 Founder 調整紀錄。</td></tr>';
  const self=targetId===founder.id;
  const html=`<main class="fd">${founderCss()}<div class="fd-head"><div><a href="/founder" class="fd-note">← 所有帳號</a><h1 style="font-size:clamp(30px,5vw,52px)">${founderEscape(account.email??'匿名')}</h1><p class="fd-sub fd-email">${founderEscape(account.id)}</p></div><div class="fd-tools"><span class="fd-security">Founder 驗證中</span><a class="btn alt sm" href="/founder/user/${founderEscape(targetId)}">重新整理</a><form method="post" action="/founder/lock" style="margin:0"><input type="hidden" name="csrf" value="${founderEscape(founderCsrf)}"><button class="btn alt sm" type="submit">鎖定</button></form></div></div>${flash}
    <section class="fd-grid">
      <div class="fd-card"><div class="fd-label">方案</div><div class="fd-value" style="font-size:26px">${founderEscape(founderPlanLabel(account.plan))}</div><div class="fd-note">${founderEscape(founderAccountStatusLabel(account.account_status))}</div></div>
      <div class="fd-card"><div class="fd-label">目前用量</div><div class="fd-measure"><div class="fd-value" style="font-size:26px">${founderUnits(usage.used_seconds)}</div><div class="fd-unitline">processing units</div></div><div class="fd-note">本期上限 ${founderUnits(usage.limit_seconds)} units · 連結數不設固定上限</div></div>
      <div class="fd-card"><div class="fd-label">剩餘額度</div><div class="fd-measure"><div class="fd-value" style="font-size:26px">${founderUnits(usage.remaining_seconds)}</div><div class="fd-unitline">processing units</div></div><div class="fd-note">本期到 ${founderTime(usage.period_end)}</div></div>
      <div class="fd-card"><div class="fd-label">AI connection</div><div class="fd-value" style="font-size:26px">${account.connected?'已連接':'—'}</div><div class="fd-note">試用資格：${account.trial_eligible?'有':'無'}</div></div>
      <div class="fd-card"><div class="fd-label">累計成功連結</div><div class="fd-value">${founderNum(a?.links)}</div><div class="fd-note">累計 ${founderUnits(a?.seconds)} processing units</div></div>
      <div class="fd-card"><div class="fd-label">失敗工作</div><div class="fd-value">${founderNum(a?.failed)}</div><div class="fd-note">最後工作 ${founderTime(a?.last_job)}</div></div>
      <div class="fd-card"><div class="fd-label">額外額度</div><div class="fd-measure"><div class="fd-value" style="font-size:26px">${founderUnits(account.admin_bonus_seconds)}</div><div class="fd-unitline">processing units</div></div><div class="fd-note">Legacy link bonus ${founderNum(account.admin_bonus_videos)}（V2 不再限制連結數）</div></div>
      <div class="fd-card"><div class="fd-label">建立時間</div><div class="fd-value" style="font-size:20px">${founderTime(account.created_at)}</div><div class="fd-note">更新於 ${founderTime(account.updated_at)}</div></div>
    </section>
    <section class="fd-panel"><div class="fd-panel-head"><div><h2>調整帳號</h2><div class="fd-note">使用紀錄不會被刪除。</div></div></div><div style="padding:18px"><form method="post" action="/founder/user/${founderEscape(targetId)}/update"><input type="hidden" name="csrf" value="${founderEscape(founderCsrf)}"><div class="fd-form-grid">
      <div class="fd-field"><label>方案</label><select class="fd-select" name="plan"><option value="trial" ${account.plan==='trial'?'selected':''}>試用</option><option value="basic" ${account.plan==='basic'?'selected':''}>Basic</option><option value="pro" ${account.plan==='pro'?'selected':''}>Pro</option></select><small>手動調整方案；之後 Lemon Squeezy webhook 仍可能依正式訂閱狀態更新。</small></div>
      <div class="fd-field"><label>帳號狀態</label><select class="fd-select" name="account_status"><option value="active" ${account.account_status==='active'?'selected':''}>正常</option><option value="past_due" ${account.account_status==='past_due'?'selected':''}>付款逾期</option><option value="canceled" ${account.account_status==='canceled'?'selected':''}>已取消</option><option value="disabled" ${account.account_status==='disabled'?'selected':''}>已停用</option></select><small>停用後會阻擋網站登入、OAuth 與新的處理工作。${self?' 你不能在這裡停用自己的 Founder 帳號。':''}</small></div>
      <div class="fd-field"><label>試用資格</label><select class="fd-select" name="trial_eligible"><option value="true" ${account.trial_eligible?'selected':''}>可試用</option><option value="false" ${!account.trial_eligible?'selected':''}>不可試用</option></select><small>只有帳號目前是試用方案時才會生效。</small></div>
      <div class="fd-field"><label>外部轉換統計</label><select class="fd-select" name="analytics_excluded"><option value="false" ${!account.analytics_excluded?'selected':''}>計入 external</option><option value="true" ${account.analytics_excluded?'selected':''}>排除（Founder / 內部測試）</option></select><small>自己的測試帳號請設為排除；會從外部訪客、註冊、連接、首次成功與付費漏斗中排除。</small></div>
      <div class="fd-field"><label>額外 processing units</label><input class="fd-input" type="number" name="bonus_minutes" min="0" max="100000" step="1" value="${Math.floor(founderNum(account.admin_bonus_seconds)/60)}"><small>直接加在原方案額度上，不會更動既有使用紀錄。</small></div>
      <div class="fd-field"><label>額外連結數</label><input class="fd-input" type="number" name="bonus_links" min="0" max="100000" step="1" value="${founderNum(account.admin_bonus_videos)}"><small>Legacy 欄位，目前 V2 不再以連結數限制方案；保留值只為相容舊資料。</small></div>
    </div><div class="fd-actions"><button class="btn purple" type="submit">儲存變更</button><a class="btn alt" href="/founder">返回</a></div></form></div></section>
    <section class="fd-panel"><div class="fd-panel-head"><div><h2>使用入口</h2><div class="fd-note">同一個 Link2AI 帳號共用方案與餘額；這裡分開顯示實際 read 次數、cache reuse 與真正產生的 billed units。</div></div><span class="fd-label">account-wide</span></div><div class="fd-scroll"><table class="fd-table"><thead><tr><th>Client</th><th>Reads</th><th>Cache reuse</th><th>Billed units</th></tr></thead><tbody>${clientUsageRows}</tbody></table></div></section>
    <section class="fd-panel"><div class="fd-panel-head"><h2>最近使用入口</h2><span class="fd-label">最近 30 次 read</span></div><div class="fd-scroll"><table class="fd-table"><thead><tr><th>時間</th><th>Client</th><th>來源平台</th><th>處理方式</th><th>Job 狀態</th><th>工作 ID</th></tr></thead><tbody>${accessRows}</tbody></table></div></section>
    <section class="fd-panel"><div class="fd-panel-head"><h2>最近工作</h2><span class="fd-label">最近 30 筆</span></div><div class="fd-scroll"><table class="fd-table"><thead><tr><th>時間</th><th>Job origin</th><th>平台</th><th>狀態</th><th>長度</th><th>錯誤</th><th>工作 ID</th></tr></thead><tbody>${jobRows}</tbody></table></div></section>
    <section class="fd-panel"><div class="fd-panel-head"><h2>Founder 調整紀錄</h2><span class="fd-label">最近 10 筆</span></div><div class="fd-scroll"><table class="fd-table"><thead><tr><th>時間</th><th>動作</th><th>新狀態</th></tr></thead><tbody>${auditRows}</tbody></table></div></section>
    <p class="fd-private">完整 Email 與帳號控制只會顯示給 FOUNDER_EMAIL。</p></main>`;
  return reply.type('text/html').send(founderShell(html,`${env().PUBLIC_BRAND_NAME} 帳號管理`));
});

app.post('/founder/user/:id/update',async(req,reply)=>{
  const targetId=String((req.params as {id?:string})?.id??'');
  const founder=await requireFounder(req,reply,`/founder/user/${encodeURIComponent(targetId)}`,true);
  if(!founder)return;
  const body=(req.body??{}) as Record<string,unknown>;
  if(!founderOriginOk(req as unknown as {headers:Record<string,string|string[]|undefined>})||!verifyCsrfToken(req.headers.cookie,String(body.csrf??'')))return reply.code(403).type('text/plain').send('Invalid request');
  const plan=String(body.plan??'');
  const accountStatus=String(body.account_status??'');
  const trialEligible=String(body.trial_eligible??'')==='true';
  const analyticsExcluded=String(body.analytics_excluded??'')==='true';
  const bonusMinutes=Number(body.bonus_minutes??0);
  const bonusLinks=Number(body.bonus_links??0);
  if(!['trial','basic','pro'].includes(plan)||!['active','past_due','canceled','disabled'].includes(accountStatus)||!Number.isInteger(bonusMinutes)||bonusMinutes<0||bonusMinutes>100000||!Number.isInteger(bonusLinks)||bonusLinks<0||bonusLinks>100000){
    return reply.redirect(`/founder/user/${encodeURIComponent(targetId)}?error=${encodeURIComponent('帳號設定格式不正確。')}`);
  }
  if(targetId===founder.id&&accountStatus==='disabled')return reply.redirect(`/founder/user/${encodeURIComponent(targetId)}?error=${encodeURIComponent('不能從 Founder 後台停用自己的帳號。')}`);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const before=await client.query<{id:string;email:string|null;plan:string;account_status:string;trial_eligible:boolean;analytics_excluded:boolean;admin_bonus_seconds:number;admin_bonus_videos:number}>(`SELECT id,email,plan,account_status,trial_eligible,analytics_excluded,admin_bonus_seconds,admin_bonus_videos FROM users WHERE id=$1 FOR UPDATE`,[targetId]);
    if(!before.rowCount){await client.query('ROLLBACK');return reply.code(404).type('text/plain').send('Not found');}
    const after=await client.query<{id:string;email:string|null;plan:string;account_status:string;trial_eligible:boolean;analytics_excluded:boolean;admin_bonus_seconds:number;admin_bonus_videos:number}>(`UPDATE users SET plan=$2,account_status=$3,trial_eligible=$4,analytics_excluded=$5,admin_bonus_seconds=$6,admin_bonus_videos=$7,updated_at=now() WHERE id=$1 RETURNING id,email,plan,account_status,trial_eligible,analytics_excluded,admin_bonus_seconds,admin_bonus_videos`,[targetId,plan,accountStatus,trialEligible,analyticsExcluded,bonusMinutes*60,bonusLinks]);
    await client.query(`INSERT INTO founder_admin_events(founder_user_id,target_user_id,action,before_state,after_state) VALUES($1,$2,'account_update',$3::jsonb,$4::jsonb)`,[founder.id,targetId,JSON.stringify(before.rows[0]),JSON.stringify(after.rows[0])]);
    await client.query('COMMIT');
    return reply.redirect(`/founder/user/${encodeURIComponent(targetId)}?saved=1`);
  }catch(err){
    await client.query('ROLLBACK');
    logErrorEvent('founder_account_update_error',err);
    return reply.redirect(`/founder/user/${encodeURIComponent(targetId)}?error=${encodeURIComponent('儲存失敗。')}`);
  }finally{client.release();}
});


app.get('/developers',async(req,reply)=>{
  await trackWebsiteVisit(req,reply,'/developers');
  const base=env().PUBLIC_BASE_URL.replace(/\/$/,'');
  return reply.type('text/html').send(siteShell(developerDocs(base), `${env().PUBLIC_BRAND_NAME} API for developers`, '/developers'));
});


app.get('/support',async(req,reply)=>{await trackWebsiteVisit(req,reply,'/support');return reply.type('text/html').send(siteShell(`<main id="main-content"><section class="connect-hero" style="text-align:left;margin-left:0"><span class="badge"><span class="badge-dot"></span>Support</span><h1>Something got in the way?</h1><p>Start with the three checks below. They cover the most common causes in order: connection setup, link scope, then temporary third-party extraction problems.</p><div class="actions">${env().SUPPORT_EMAIL?`<a class="btn purple" href="mailto:${env().SUPPORT_EMAIL}">Email support →</a>`:''}<a class="btn alt" href="/connect">Open setup guide</a><a class="btn alt" href="/status">Check API status</a></div>${env().SUPPORT_EMAIL?`<p class="micro">Support email: <a href="mailto:${env().SUPPORT_EMAIL}"><strong>${env().SUPPORT_EMAIL}</strong></a></p>`:''}</section><section class="support-grid"><div class="card"><div class="kicker">1 · Connection</div><h3>Your AI cannot see Link2AI</h3><p>Reconnect from the setup page and finish Link2AI authorization in the AI client. Claude users who want Link2AI loaded from the start can use Tool access → Tools already loaded for the conversation.</p></div><div class="card"><div class="kicker">2 · Link scope</div><h3>A public link did not process</h3><p>Make sure the URL points to one supported public item — not a profile, feed, search page, private item, paywall or DRM-protected source. Failed reads use 0 processing units. If a supported source needs more units than your current balance, Link2AI stops and asks you to add units instead of intentionally returning a size-truncated result.</p></div><div class="card"><div class="kicker">3 · Send useful context</div><h3>What to include in a support email</h3><p>Include your Link2AI account email, platform, public URL, exact error message and job ID. Never send passwords, card numbers or private-account credentials.</p></div></section><div class="scope-note" style="margin-bottom:70px"><div class="scope-icon">i</div><div><strong>The source still looks incomplete?</strong><p>Link2AI does not intentionally cut a supported source because of a fixed content-size limit. If the upstream platform itself does not expose the full source, Link2AI reports that limitation instead of silently calling it complete. If your balance is too small for the source, the job stops and asks you to add units.</p></div></div></main>`, `${env().PUBLIC_BRAND_NAME} Support`, `/support`));});

app.get('/guide/claude-add-connector.png',async(_req,reply)=>reply.type('image/png').send(await readFile('assets/tutorial/claude-add-connector.png')));
app.get('/guide/claude-oauth.png',async(_req,reply)=>reply.type('image/png').send(await readFile('assets/tutorial/claude-oauth.png')));
app.get('/guide/claude-permissions.png',async(_req,reply)=>reply.type('image/png').send(await readFile('assets/tutorial/claude-permissions.png')));
app.get('/guide/claude-tool-access.png',async(_req,reply)=>reply.type('image/png').send(await readFile('assets/tutorial/claude-tool-access.png')));

app.get('/logo.svg',async(_req,reply)=>reply.type('image/svg+xml').send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="224" fill="#0f172a"/><g fill="none" stroke="#fff" stroke-width="74" stroke-linecap="round"><path d="M337 601l-68 68c-70 70-70 184 0 254s184 70 254 0l122-122c70-70 70-184 0-254-38-38-89-55-139-52" transform="translate(0 -94)"/><path d="M687 423l68-68c70-70 70-184 0-254s-184-70-254 0L379 223c-70 70-70 184 0 254 38 38 89 55 139 52" transform="translate(0 94)"/><path d="M414 610l196-196"/></g><path d="M792 213l18 48 48 18-48 18-18 48-18-48-48-18 48-18 18-48z" fill="#fff"/></svg>`));



function legalPage(title:string,body:string){
  const contact=`<p>Questions, support, or privacy requests: <a href="/support">${env().PUBLIC_BRAND_NAME} Support</a>${env().SUPPORT_EMAIL?` · <a href="mailto:${env().SUPPORT_EMAIL}">${env().SUPPORT_EMAIL}</a>`:''}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${env().PUBLIC_BRAND_NAME} ${title}</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:56px auto;padding:0 20px;line-height:1.55;color:#171717}h1,h2{line-height:1.2}a{color:inherit}</style></head><body><h1>${title}</h1><p><small>Last updated September 18, 2026</small></p>${body}${contact}</body></html>`;
}

app.get('/privacy',async(_req,reply)=>reply.type('text/html').send(legalPage('Privacy Policy',`
<h2>What ${env().PUBLIC_BRAND_NAME} processes</h2><p>${env().PUBLIC_BRAND_NAME} receives supported public URLs only when a connected AI asks ${env().PUBLIC_BRAND_NAME} to read them. Depending on the link, it may process public page/post text and metadata, or video metadata, captions and temporary audio needed to produce AI-readable source context.</p>
<h2>Account, API, and billing data</h2><p>${env().PUBLIC_BRAND_NAME} stores the email address used for your account, a salted password hash (never your plaintext password), account/session identifiers, API-key hashes and non-secret key prefixes, plan and quota usage, and identifiers needed to manage a Lemon Squeezy subscription. Full API keys are shown only when created and are not stored in plaintext. To limit repeated free-trial abuse, ${env().PUBLIC_BRAND_NAME} also uses a random first-party browser token associated with trial eligibility. ${env().PUBLIC_BRAND_NAME} does not store card numbers.</p>
<h2>Website analytics</h2><p>${env().PUBLIC_BRAND_NAME} uses a random first-party browser token to count page views, unique visitors and a small set of product-funnel events such as starting signup or opening the AI setup. When present, Link2AI may also store UTM campaign fields and only the referring site hostname (not the full referrer URL) so traffic quality can be measured. It does not store an IP address and does not use a third-party advertising or analytics tracker. A one-time historical backfill used existing Railway request logs to estimate visits from before first-party analytics was enabled; only anonymous synthetic visitor IDs, page paths and timestamps were imported, not raw IP addresses or user-agent strings.</p>
<h2>Retention</h2><p>Downloaded media and derived audio are temporary processing files and are deleted after the job finishes. Source-text/transcript cache is temporary and defaults to 72 hours. Completed and failed job records are retained only as minimal operational/accounting records; stored source URLs and canonical identifiers are scrubbed after the content-retention window. Unpaid pending jobs expire and have their source URL scrubbed after 24 hours.</p>
<h2>Service providers</h2><p>${env().PUBLIC_BRAND_NAME} may send the minimum data needed to service providers used for hosting, billing, media processing, and optional email authentication. These providers process data under their own terms and privacy policies.</p>
<h2>What ${env().PUBLIC_BRAND_NAME} does not do</h2><p>Link2AI does not support private accounts, paid/DRM content or bulk crawling. Scanned image-only PDFs are not OCRed in this release. ${env().PUBLIC_BRAND_NAME} does not sell a source-content corpus and does not intentionally keep raw video, audio or scraped webpages as a content library.</p>`)));

app.get('/terms',async(_req,reply)=>reply.type('text/html').send(legalPage('Terms of Service',`
<h2>Use of the service</h2><p>Use ${env().PUBLIC_BRAND_NAME} only for public content you are authorized to access and process. Do not use the service to bypass private-account controls, authentication, paywalls, DRM, geographic restrictions or other access controls, and do not use it for bulk crawling.</p>
<h2>Plans and billing</h2><p>The one-time trial is intended for evaluation and includes 10 processing units. Basic includes 500 processing units per billing period. Pro includes 2,000 processing units per billing period. Plans are not limited by a fixed number of links, and Link2AI does not impose a plan-specific per-source duration or text-length cap. Video usage is one unit per started processed minute. Text-based usage is one unit per roughly 2,500 estimated tokens successfully processed from the source, with a minimum of one unit for a successful read. If the complete supported source requires more processing units than the account currently has, Link2AI stops the job and asks the user to add units or upgrade rather than intentionally returning a size-truncated source. Unsupported, inaccessible, login-required, empty or failed extractions consume 0 units. Paid subscriptions renew until canceled through the subscription-management flow.</p>
<h2>Availability</h2><p>${env().PUBLIC_BRAND_NAME} processes supported public links. Processing can temporarily fail, and not every public URL is guaranteed to be processable. Link2AI does not intentionally truncate a supported source at a fixed product content-size limit; account processing units are the product-level size budget. Third-party platforms or infrastructure can still fail to expose or process a complete source, and Link2AI reports those limitations rather than silently presenting them as complete. Failed or unsupported reads consume 0 processing units.</p>
<h2>Service guarantee and refunds</h2><p>If core paid service is materially unavailable for supported public links because of our service issue and reasonable access cannot be restored, our Support team may remedy the situation with restored usage quota, account credit, prorated refund, or full refund depending on impact and duration. This does not apply to unsupported or private content, removed or restricted content, or content restricted by third-party platforms.</p>
<h2>Content responsibility</h2><p>${env().PUBLIC_BRAND_NAME} returns source material to the connected AI as untrusted external data. The connected AI, not ${env().PUBLIC_BRAND_NAME}, performs any summary, analysis, translation, recommendation or factual judgment requested by the user.</p>`)));

await registerAuthRoutes(app);
await registerBillingRoutes(app);
await registerPublicApiRoutes(app);

app.setErrorHandler((err,req,reply)=>{
  logErrorEvent(req.url.startsWith('/mcp/openai')?'openai_mcp_request_error':'api_request_error',err,{
    method:req.method,
    distribution_profile:req.url.startsWith('/mcp/openai')?'openai':'default',
    code:typeof (err as {code?:unknown})?.code==='string'?(err as {code:string}).code:undefined
  });
  if(reply.sent)return;
  const message=err instanceof Error?err.message:'Unknown error';
  reply.code(500).send({error:'internal_error',message:env().NODE_ENV==='production'?'Something went wrong.':message});
});

const shutdown=async()=>{await mcpHandler.close();await app.close();await pool.end();};
process.on('SIGTERM',()=>void shutdown());
process.on('SIGINT',()=>void shutdown());

await app.listen({port:env().PORT,host:'0.0.0.0'});
console.log(`[api] Link2AI listening on ${env().PORT}`);
