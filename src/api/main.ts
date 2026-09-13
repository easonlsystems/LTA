import { createMcpFastifyApp } from '@modelcontextprotocol/fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { registerAuthRoutes } from '../auth/routes.js';
import { registerBillingRoutes } from '../billing/routes.js';
import { authInfoFromBearer } from '../auth/service.js';
import { buildMcpServer } from '../mcp/server.js';
import { readinessIssues } from '../config/readiness.js';
import { publicHostAllowlist } from '../config/publicUrl.js';

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
  const status={ok:dbOk,timestamp:new Date().toISOString(),service:'link2ai-api',note:'Core API and database state only. Individual public video availability can vary with third-party platforms.'};
  return dbOk?reply.send(status):reply.code(503).send(status);
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
  <url><loc>${baseUrl}/pricing</loc><priority>0.9</priority></url>
  <url><loc>${baseUrl}/status</loc><priority>0.5</priority></url>
  <url><loc>${baseUrl}/privacy</loc><priority>0.8</priority></url>
  <url><loc>${baseUrl}/terms</loc><priority>0.8</priority></url>
</urlset>`;
  return reply.type('application/xml').send(xml);
});

const siteCss=`:root{color-scheme:light;--ink:#111827;--muted:#5f6877;--line:#e6e9ee;--panel:#f7f8fa;--accent:#111827}*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:#fff}a{color:inherit}.wrap{max-width:1040px;margin:0 auto;padding:0 24px}nav{display:flex;align-items:center;justify-content:space-between;padding:22px 0}.brand{font-weight:800;letter-spacing:-.03em;font-size:21px;text-decoration:none}.navlinks{display:flex;gap:20px;align-items:center;font-size:14px}.navlinks a{text-decoration:none}.btn{display:inline-flex;align-items:center;justify-content:center;border-radius:12px;padding:12px 17px;background:var(--accent);color:#fff;text-decoration:none;font-weight:700;border:1px solid var(--accent)}.btn.alt{background:#fff;color:var(--ink);border-color:var(--line)}.hero{padding:92px 0 62px;max-width:820px}.eyebrow{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:#6b7280}.hero h1{font-size:clamp(46px,8vw,80px);line-height:.98;letter-spacing:-.065em;margin:18px 0 24px}.hero p{font-size:21px;line-height:1.55;color:var(--muted);max-width:720px}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:30px}.proof{margin-top:22px;font-size:13px;color:#6b7280}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:32px 0 84px}.card{border:1px solid var(--line);border-radius:18px;padding:24px;background:#fff}.card h3{margin:0 0 8px;font-size:18px}.card p{margin:0;color:var(--muted);line-height:1.55}.section{padding:74px 0;border-top:1px solid var(--line)}.section h2{font-size:38px;letter-spacing:-.045em;margin:0 0 14px}.section>.sub,.section .sub{color:var(--muted);font-size:18px;max-width:700px}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:28px}.stepnum{font-size:12px;color:#8a93a2;font-weight:800;margin-bottom:10px}.pricing{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:28px}.price{font-size:36px;font-weight:800;letter-spacing:-.04em}.price small{font-size:15px;color:var(--muted);font-weight:500}.recommended{border-width:2px;border-color:#111827}.list{padding:0;margin:18px 0 0;list-style:none;color:var(--muted);line-height:1.9}.beta{display:inline-block;padding:6px 10px;border-radius:999px;background:#f1f3f5;font-size:12px;font-weight:700;color:#4b5563}footer{padding:32px 0 48px;color:#7a8391;font-size:13px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}@media(max-width:760px){.grid,.steps,.pricing{grid-template-columns:1fr}.hero{padding-top:62px}.navlinks a.hide-sm{display:none}}`;
function siteShell(body:string,title=env().PUBLIC_BRAND_NAME){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="Paste a video link. Your AI can read it."><style>${siteCss}</style></head><body><div class="wrap"><nav><a class="brand" href="/">${env().PUBLIC_BRAND_NAME}</a><div class="navlinks"><a class="hide-sm" href="/#how">How it works</a><a href="/pricing">Pricing</a><a href="/status">Status</a><a href="/account">Account</a><a class="btn" href="/login?return_to=/connect">Start free</a></div></nav>${body}<footer><span>© 2026 ${env().PUBLIC_BRAND_NAME}</span><span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>${env().SUPPORT_EMAIL?` · <a href="mailto:${env().SUPPORT_EMAIL}">Support</a>`:''}</span></footer></div></body></html>`;}

app.get('/',async(_req,reply)=>reply.type('text/html').send(siteShell(`<main><section class="hero"><span class="beta">Founding Beta</span><div class="eyebrow" style="margin-top:22px">The missing link between social video and AI</div><h1>Paste a video link.<br>Your AI can read it.</h1><p>${env().PUBLIC_BRAND_NAME} turns public Instagram Reels, TikTok and YouTube videos into AI-readable context, then gets out of the way. Keep asking questions in ChatGPT or Claude like you normally would.</p><div class="actions"><a class="btn" href="/login?return_to=/connect">Try 10 videos free</a><a class="btn alt" href="/#how">See how it works</a></div><div class="proof">10 successful videos or 30 minutes free · No card required · Public videos only</div></section><section class="grid"><div class="card"><h3>Instagram Reels</h3><p>Paste a public Reel and let your AI work with what was actually said.</p></div><div class="card"><h3>TikTok</h3><p>Turn public TikTok speech into context your existing AI can reason over.</p></div><div class="card"><h3>YouTube</h3><p>Ask about public videos and Shorts without leaving the AI you already use.</p></div></section><section class="section" id="how"><h2>Use your AI. Not another AI.</h2><p class="sub">${env().PUBLIC_BRAND_NAME} does not summarize, translate or fact-check for you. It gives the video content to the AI you already use.</p><div class="steps"><div class="card"><div class="stepnum">01</div><h3>Connect once</h3><p>Connect ${env().PUBLIC_BRAND_NAME} to a supported AI client through a secure OAuth flow.</p></div><div class="card"><div class="stepnum">02</div><h3>Paste the link</h3><p>Ask your normal question. The AI decides whether it actually needs ${env().PUBLIC_BRAND_NAME}.</p></div><div class="card"><div class="stepnum">03</div><h3>Keep talking</h3><p>${env().PUBLIC_BRAND_NAME} gives your AI the video context it needs, then gets out of the way.</p></div></div></section><section class="section"><h2>Simple pricing.</h2><p class="sub">Try it first. Pay only after ${env().PUBLIC_BRAND_NAME} becomes useful enough to keep.</p><div class="pricing"><div class="card recommended"><span class="beta">Recommended</span><h3>Basic</h3><div class="price">$4.99 <small>/ month</small></div><ul class="list"><li>500 transcript minutes / month</li><li>Up to 30 min per video</li><li>2 concurrent jobs</li><li>Instagram, TikTok & YouTube</li></ul><div class="actions"><a class="btn" href="/login?return_to=/connect">Try it free</a></div></div><div class="card"><h3>Pro</h3><div class="price">$9.99 <small>/ month</small></div><ul class="list"><li>2,000 transcript minutes / month</li><li>Up to 120 min per video</li><li>4 concurrent jobs</li><li>Higher processing priority</li></ul><div class="actions"><a class="btn" href="/login?return_to=/connect">Try it free</a></div></div></div></section><section class="section"><h2>Founding Beta availability</h2><p class="sub">Claude remote-MCP users and eligible ChatGPT custom-app users can connect during beta. Public ChatGPT directory distribution will follow platform review.</p><div class="actions"><a class="btn" href="/login?return_to=/connect">Start free</a></div></section></main>`)));

app.get('/connect',async(_req,reply)=>reply.type('text/html').send(siteShell(`<main><section class="hero" style="padding-bottom:30px"><span class="beta">Founding Beta</span><h1 style="font-size:56px">Connect ${env().PUBLIC_BRAND_NAME}</h1><p>Your ${env().PUBLIC_BRAND_NAME} MCP endpoint is <code>${env().PUBLIC_BASE_URL}/mcp</code>. Authentication happens through ${env().PUBLIC_BRAND_NAME} OAuth.</p></section><section class="grid" style="grid-template-columns:1fr 1fr"><div class="card"><h3>Claude</h3><p>Add ${env().PUBLIC_BRAND_NAME} as a remote/custom MCP connector and use <strong>${env().PUBLIC_BASE_URL}/mcp</strong>. Complete the ${env().PUBLIC_BRAND_NAME} sign-in when prompted.</p></div><div class="card"><h3>ChatGPT</h3><p>During beta, connect from an eligible custom-app/developer-mode workspace using the same MCP URL. Public directory availability follows OpenAI review.</p></div></section><section class="section"><h2>Then just paste links.</h2><p class="sub">You do not need to tell the AI to use ${env().PUBLIC_BRAND_NAME}. It should call ${env().PUBLIC_BRAND_NAME} only when your question actually requires video speech it cannot already access.</p><div class="actions"><a class="btn alt" href="/account">View account</a><a class="btn" href="/pricing">View pricing</a></div></section></main>`, `Connect ${env().PUBLIC_BRAND_NAME}`)));


function legalPage(title:string,body:string){
  const contact=env().SUPPORT_EMAIL?`<p>Questions or privacy requests: <a href="mailto:${env().SUPPORT_EMAIL}">${env().SUPPORT_EMAIL}</a></p>`:'<p>Support contact will be published before public launch.</p>';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${env().PUBLIC_BRAND_NAME} ${title}</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:56px auto;padding:0 20px;line-height:1.55;color:#171717}h1,h2{line-height:1.2}a{color:inherit}</style></head><body><h1>${title}</h1><p><small>Last updated September 13, 2026</small></p>${body}${contact}</body></html>`;
}

app.get('/privacy',async(_req,reply)=>reply.type('text/html').send(legalPage('Privacy Policy',`
<h2>What ${env().PUBLIC_BRAND_NAME} processes</h2><p>${env().PUBLIC_BRAND_NAME} receives public Instagram Reel, TikTok and YouTube URLs only when a connected AI asks ${env().PUBLIC_BRAND_NAME} to read them. To provide a transcript, ${env().PUBLIC_BRAND_NAME} may process the URL, public video metadata, captions and temporary audio derived from the public video.</p>
<h2>Account and billing data</h2><p>${env().PUBLIC_BRAND_NAME} stores the email address used to sign in, authentication records, plan and quota usage, and identifiers needed to manage a Lemon Squeezy subscription. ${env().PUBLIC_BRAND_NAME} does not store card numbers.</p>
<h2>Retention</h2><p>Downloaded media and derived audio are temporary processing files and are deleted after the job finishes. Transcript cache is temporary and defaults to 72 hours. Completed and failed job records are retained only as minimal operational/accounting records; the stored video URL and canonical media identifier are scrubbed after the transcript retention window. Unpaid pending jobs expire and have their media URL scrubbed after 24 hours.</p>
<h2>Service providers</h2><p>${env().PUBLIC_BRAND_NAME} may send the minimum data needed to service providers used for hosting, email authentication, billing, and media processing. These providers process data under their own terms and privacy policies.</p>
<h2>What ${env().PUBLIC_BRAND_NAME} does not do</h2><p>V1 does not support private accounts, paid/DRM content or bulk crawling. ${env().PUBLIC_BRAND_NAME} does not sell a transcript corpus and does not intentionally keep raw video or audio as a content library.</p>`)));

app.get('/terms',async(_req,reply)=>reply.type('text/html').send(legalPage('Terms of Service',`
<h2>Use of the service</h2><p>Use ${env().PUBLIC_BRAND_NAME} only for public content you are authorized to access and process. Do not use the service to bypass private-account controls, authentication, paywalls, DRM, geographic restrictions or other access controls, and do not use it for bulk crawling.</p>
<h2>Plans and billing</h2><p>The one-time trial includes up to 10 successful videos and 30 total transcript minutes, whichever is reached first. Basic is designed for up to 500 transcript minutes per billing period and videos up to 30 minutes. Pro is designed for up to 2,000 transcript minutes per billing period and videos up to 120 minutes. Only successfully completed transcript jobs consume transcript quota. Paid subscriptions renew until canceled through the subscription-management flow.</p>
<h2>Availability</h2><p>${env().PUBLIC_BRAND_NAME} processes public videos from supported platforms. Processing can temporarily fail, and not every public URL is guaranteed to be processable. ${env().PUBLIC_BRAND_NAME} does not guarantee that every public URL can be processed. Failed jobs do not consume transcript quota.</p>
<h2>Service guarantee and refunds</h2><p>If core paid service is materially unavailable for supported public videos because of our service issue and reasonable access cannot be restored, our Support team may remedy the situation with restored transcript quota, account credit, prorated refund, or full refund depending on impact and duration. This does not apply to unsupported or private content, removed or restricted videos, or content restricted by third-party platforms.</p>
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
