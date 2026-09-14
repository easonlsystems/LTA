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
  <url><loc>${baseUrl}/pricing</loc><priority>0.9</priority></url>
  <url><loc>${baseUrl}/status</loc><priority>0.5</priority></url>
  <url><loc>${baseUrl}/support</loc><priority>0.8</priority></url>
  <url><loc>${baseUrl}/privacy</loc><priority>0.8</priority></url>
  <url><loc>${baseUrl}/terms</loc><priority>0.8</priority></url>
</urlset>`;
  return reply.type('application/xml').send(xml);
});

const siteCss=`:root{color-scheme:light;--ink:#0f172a;--muted:#667085;--line:#e6eaf0;--soft:#f7f9fc;--accent:#0f172a;--blue:#eef4ff}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:linear-gradient(180deg,#fbfcff 0,#fff 520px)}a{color:inherit}.wrap{max-width:1080px;margin:0 auto;padding:0 26px}nav{display:flex;align-items:center;justify-content:space-between;padding:22px 0;border-bottom:1px solid rgba(230,234,240,.8)}.brand{font-weight:900;letter-spacing:-.04em;font-size:22px;text-decoration:none}.navlinks{display:flex;gap:22px;align-items:center;font-size:14px}.navlinks a{text-decoration:none}.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:13px;padding:12px 18px;background:var(--accent);color:#fff;text-decoration:none;font-weight:780;border:1px solid var(--accent);transition:.16s}.btn:hover{transform:translateY(-1px)}.btn.alt{background:#fff;color:var(--ink);border-color:var(--line)}.btn.disabled{background:#f2f4f7;color:#98a2b3;border-color:#e4e7ec;pointer-events:none}.hero{padding:94px 0 68px;max-width:850px}.eyebrow{font-size:12px;font-weight:850;text-transform:uppercase;letter-spacing:.14em;color:#667085}.hero h1{font-size:clamp(50px,8vw,82px);line-height:.96;letter-spacing:-.065em;margin:18px 0 24px}.hero p{font-size:21px;line-height:1.55;color:var(--muted);max-width:760px}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:30px}.proof{margin-top:20px;font-size:13px;color:#7a8494}.pill{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;border-radius:999px;background:#f2f4f7;font-size:12px;font-weight:750;color:#475467}.dot{width:7px;height:7px;border-radius:50%;background:#22c55e}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:30px 0 82px}.card{border:1px solid var(--line);border-radius:20px;padding:25px;background:rgba(255,255,255,.95);box-shadow:0 8px 30px rgba(15,23,42,.035)}.card h3{margin:0 0 9px;font-size:18px;letter-spacing:-.02em}.card p{margin:0;color:var(--muted);line-height:1.6}.section{padding:74px 0;border-top:1px solid var(--line)}.section h2{font-size:40px;letter-spacing:-.05em;margin:0 0 14px}.section>.sub,.section .sub{color:var(--muted);font-size:18px;max-width:740px;line-height:1.6}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:30px}.stepnum{font-size:12px;color:#8a93a2;font-weight:850;margin-bottom:12px}.visual{margin-top:18px;border:1px solid var(--line);background:var(--soft);border-radius:15px;padding:16px;min-height:112px}.fakebar{height:9px;width:46%;border-radius:8px;background:#dfe4ea;margin-bottom:12px}.fakebar.s{width:28%}.fakebutton{display:inline-flex;padding:8px 12px;border-radius:9px;background:#111827;color:#fff;font-size:12px;font-weight:750}.arrow{font-size:24px;margin:5px 0;color:#98a2b3}.pricing{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:28px}.price{font-size:36px;font-weight:850;letter-spacing:-.04em}.price small{font-size:15px;color:var(--muted);font-weight:500}.recommended{border-width:2px;border-color:#111827}.list{padding:0;margin:18px 0 0;list-style:none;color:var(--muted);line-height:1.9}.platforms{display:flex;gap:9px;flex-wrap:wrap;margin-top:22px}.platform{padding:8px 11px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:12px;font-weight:720;color:#475467}.connect-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:26px 0 44px}.connect-card{border:1px solid var(--line);border-radius:22px;padding:26px;background:#fff}.connect-card h3{font-size:22px;margin:0 0 8px}.connect-card p{color:var(--muted);line-height:1.55}.guide{display:grid;gap:13px;margin:20px 0}.guide-row{display:grid;grid-template-columns:42px 1fr;gap:12px;align-items:start;padding:14px;border-radius:15px;background:var(--soft)}.num{width:32px;height:32px;display:grid;place-items:center;background:#111827;color:#fff;border-radius:10px;font-size:13px;font-weight:800}.guide-row strong{display:block;margin:2px 0 4px}.guide-row span{font-size:13px;color:var(--muted);line-height:1.45}.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all;background:#111827;color:#e5e7eb;border-radius:12px;padding:12px;margin-top:8px}.note{font-size:13px;color:#667085}.beta{display:inline-block;padding:6px 10px;border-radius:999px;background:#f1f3f5;font-size:12px;font-weight:700;color:#4b5563}.mockapp{display:grid;grid-template-columns:88px 1fr;border:1px solid #dfe4ea;border-radius:12px;overflow:hidden;background:#fff;min-height:118px;margin-top:12px}.mockside{background:#f4f5f7;padding:9px 7px;border-right:1px solid #e5e7eb}.mockbrand{font-size:10px;font-weight:900;margin:1px 3px 8px}.mockitem{font-size:9px;padding:6px 7px;border-radius:7px;color:#667085;margin-bottom:4px}.mockitem.hot,.mockrow.hot{background:#111827;color:#fff;font-weight:800}.mockmain{padding:12px}.mockhint{font-size:10px;font-weight:800;color:#475467;margin-bottom:8px}.mockline{height:7px;border-radius:7px;background:#e7eaf0;margin:7px 0}.mockline.w70{width:70%}.mockline.w45{width:45%}.mockpanel{border:1px solid #dfe4ea;border-radius:12px;background:#fff;padding:12px;margin-top:12px}.mockpanelhead{display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:900;margin-bottom:9px}.mockplus{width:24px;height:24px;border-radius:7px;background:#111827;color:#fff;display:grid;place-items:center;font-weight:900}.mockrow{font-size:10px;padding:8px 9px;border-radius:8px;background:#f5f6f8;margin-top:6px}.mockfield{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;padding:9px;border:1px solid #dfe4ea;border-radius:8px;margin:7px 0;overflow-wrap:anywhere;color:#475467}.copybtn{border:1px solid #d0d5dd;background:#fff;color:#111827;border-radius:9px;padding:8px 10px;font-size:11px;font-weight:800;cursor:pointer;margin-top:8px}.chatmock{display:grid;gap:8px;margin-top:12px}.bubble{font-size:10px;line-height:1.45;padding:9px 10px;border-radius:10px;max-width:92%}.bubble.user{justify-self:end;background:#111827;color:#fff}.bubble.ai{justify-self:start;background:#eef1f5;color:#344054}footer{padding:32px 0 48px;color:#7a8391;font-size:13px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}@media(max-width:760px){.grid,.steps,.pricing,.connect-grid{grid-template-columns:1fr}.hero{padding-top:62px}.navlinks a.hide-sm{display:none}.hero h1{font-size:52px}}`;
function siteShell(body:string,title=env().PUBLIC_BRAND_NAME){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="Paste a link. Your AI can read it."><style>${siteCss}</style></head><body><div class="wrap"><nav><a class="brand" href="/">${env().PUBLIC_BRAND_NAME}</a><div class="navlinks"><a class="hide-sm" href="/#how">How it works</a><a href="/pricing">Pricing</a><a href="/status">Status</a><a href="/account">Account</a><a class="btn" href="/connect">Connect</a></div></nav>${body}<footer><span>© 2026 ${env().PUBLIC_BRAND_NAME}</span><span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a></span></footer></div></body></html>`;}

app.get('/',async(_req,reply)=>reply.type('text/html').send(siteShell(`<main><section class="hero"><span class="pill"><span class="dot"></span>Founding Beta</span><div class="eyebrow" style="margin-top:22px">Give your AI the missing context</div><h1>Paste a link.<br>Your AI can read it.</h1><p>${env().PUBLIC_BRAND_NAME} helps ChatGPT and Claude understand supported public links they cannot reliably read on their own. Connect once, then keep chatting like normal.</p><div class="actions"><a class="btn" href="/connect">Connect ${env().PUBLIC_BRAND_NAME} →</a><a class="btn alt" href="/#how">See how it works</a></div><div class="proof">3 successful links or 10 minutes free · No email or card required</div><div class="platforms"><span class="platform">Instagram Reels</span><span class="platform">TikTok</span><span class="platform">YouTube</span><span class="platform">YouTube Shorts</span></div></section><section class="grid"><div class="card"><h3>Paste the link</h3><p>No transcript website. No new chat app. Start with the link you already have.</p></div><div class="card"><h3>Ask normally</h3><p>“What is this about?” “Is this claim true?” “Give me the key points.”</p></div><div class="card"><h3>Your AI answers</h3><p>${env().PUBLIC_BRAND_NAME} supplies missing context only when your AI actually needs it.</p></div></section><section class="section" id="how"><h2>Connect once. Then forget about us.</h2><p class="sub">${env().PUBLIC_BRAND_NAME} stays in the background. Your existing AI remains the interface.</p><div class="steps"><div class="card"><div class="stepnum">01 · CONNECT</div><h3>Add ${env().PUBLIC_BRAND_NAME}</h3><div class="visual"><div class="fakebar"></div><div class="fakebar s"></div><span class="fakebutton">Connect</span></div></div><div class="card"><div class="stepnum">02 · PASTE</div><h3>Drop in a link</h3><div class="visual"><div class="fakebar" style="width:88%"></div><div class="code" style="margin-top:18px">youtube.com/watch?v=…</div></div></div><div class="card"><div class="stepnum">03 · ASK</div><h3>Ask what you want</h3><div class="visual"><div class="fakebar" style="width:76%"></div><div class="fakebar" style="width:92%"></div><div class="fakebar s"></div></div></div></div></section><section class="section"><h2>Simple pricing.</h2><p class="sub">The free trial is for proving it works, not for becoming another free plan.</p><div class="pricing"><div class="card recommended"><span class="beta">Recommended</span><h3>Basic</h3><div class="price">$4.99 <small>/ month</small></div><ul class="list"><li>500 minutes of content / month</li><li>Up to 30 min per link</li><li>2 concurrent jobs</li><li>Instagram, TikTok & YouTube</li></ul></div><div class="card"><h3>Pro</h3><div class="price">$9.99 <small>/ month</small></div><ul class="list"><li>2,000 minutes of content / month</li><li>Up to 120 min per link</li><li>4 concurrent jobs</li><li>Higher processing priority</li></ul></div></div></section></main>`)));

app.get('/connect',async(_req,reply)=>reply.type('text/html').send(siteShell(`<main><section class="hero" style="padding-bottom:24px"><span class="pill"><span class="dot"></span>Setup</span><h1 style="font-size:58px">Choose your AI.</h1><p>Follow the pictures once. After that, this website gets out of the way.</p></section><section class="connect-grid"><div class="connect-card"><h3>Claude</h3><p>Available for the founding beta now.</p><div class="guide"><div class="guide-row"><div class="num">1</div><div><strong>Open Claude and press Customize</strong><span>It is in Claude’s left sidebar.</span><div class="mockapp"><div class="mockside"><div class="mockbrand">Claude</div><div class="mockitem">New chat</div><div class="mockitem hot">Customize</div></div><div class="mockmain"><div class="mockhint">Click the highlighted item</div><div class="mockline w70"></div><div class="mockline w45"></div></div></div></div></div><div class="guide-row"><div class="num">2</div><div><strong>Open Connectors → + → Add custom connector</strong><span>Create one connector named ${env().PUBLIC_BRAND_NAME}.</span><div class="mockpanel"><div class="mockpanelhead"><span>Connectors</span><span class="mockplus">+</span></div><div class="mockrow hot">Add custom connector</div></div></div></div><div class="guide-row"><div class="num">3</div><div><strong>Paste this address and press Connect</strong><span>You only paste it once.</span><div class="mockpanel"><div class="mockfield">${env().PUBLIC_BRAND_NAME}</div><div class="mockfield" id="mcp-address">${env().PUBLIC_BASE_URL}/mcp</div><button class="copybtn" type="button" onclick="navigator.clipboard.writeText('${env().PUBLIC_BASE_URL}/mcp').then(()=>this.textContent='Copied ✓')">Copy address</button></div></div></div><div class="guide-row"><div class="num">4</div><div><strong>Press Continue free</strong><span>${env().PUBLIC_BRAND_NAME} returns you to Claude automatically. No email or card needed for the beta trial.</span><div class="mockpanel"><div class="mockline w45"></div><div class="mockrow hot">Continue free</div></div></div></div><div class="guide-row"><div class="num">5</div><div><strong>Paste a link and ask normally</strong><span>Example:</span><div class="chatmock"><div class="bubble user">https://youtube.com/watch?v=…<br>What is this about?</div><div class="bubble ai">I’ll read the link and answer from its content…</div></div></div></div></div><div class="actions"><a class="btn" href="https://claude.ai/" target="_blank" rel="noopener">Open Claude →</a></div></div><div class="connect-card"><h3>ChatGPT</h3><p>${env().PUBLIC_BRAND_NAME} is being prepared for the Plugins Directory. After approval, users will not copy an MCP address.</p><div class="mockpanel"><div class="mockpanelhead"><span>Link2AI</span><span class="pill">Plugin</span></div><div class="mockline w70"></div><div class="mockline w45"></div><div class="mockrow hot">Install / Connect</div></div><p class="note">Expected public flow: Install → Connect → Continue free → back to ChatGPT.</p></div></section><section class="section"><h2>After setup, just paste links.</h2><p class="sub">You do not need to remember MCP, transcripts, ASR, or ${env().PUBLIC_BRAND_NAME}. Your AI remains the interface.</p></section></main>`, `Connect ${env().PUBLIC_BRAND_NAME}`)));


app.get('/logo.svg',async(_req,reply)=>reply.type('image/svg+xml').send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="224" fill="#0f172a"/><g fill="none" stroke="#fff" stroke-width="74" stroke-linecap="round"><path d="M337 601l-68 68c-70 70-70 184 0 254s184 70 254 0l122-122c70-70 70-184 0-254-38-38-89-55-139-52" transform="translate(0 -94)"/><path d="M687 423l68-68c70-70 70-184 0-254s-184-70-254 0L379 223c-70 70-70 184 0 254 38 38 89 55 139 52" transform="translate(0 94)"/><path d="M414 610l196-196"/></g><path d="M792 213l18 48 48 18-48 18-18 48-18-48-48-18 48-18 18-48z" fill="#fff"/></svg>`));

app.get('/support',async(_req,reply)=>reply.type('text/html').send(siteShell(`<main><section class="hero" style="padding-bottom:34px"><span class="pill"><span class="dot"></span>Support</span><h1 style="font-size:58px">Need help?</h1><p>For connection, account, billing, privacy, or supported-link problems, contact ${env().PUBLIC_BRAND_NAME} support.</p><div class="actions">${env().SUPPORT_EMAIL?`<a class="btn" href="mailto:${env().SUPPORT_EMAIL}">Email support →</a>`:''}<a class="btn alt" href="/status">Check service status</a></div></section><section class="grid"><div class="card"><h3>Connection issue</h3><p>Open the <a href="/connect">visual setup guide</a> and reconnect ${env().PUBLIC_BRAND_NAME} from your AI.</p></div><div class="card"><h3>Link did not process</h3><p>Private, deleted, login-only, paid/DRM, geo-restricted, or unsupported links may not be processable. Failed jobs do not consume completed-job quota.</p></div><div class="card"><h3>Billing or privacy</h3><p>Include the email used at checkout if you have one. Do not send passwords, card numbers, or government ID documents.</p></div></section></main>`, `${env().PUBLIC_BRAND_NAME} Support`)));


function legalPage(title:string,body:string){
  const contact=`<p>Questions, support, or privacy requests: <a href="/support">${env().PUBLIC_BRAND_NAME} Support</a>${env().SUPPORT_EMAIL?` · <a href="mailto:${env().SUPPORT_EMAIL}">${env().SUPPORT_EMAIL}</a>`:''}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${env().PUBLIC_BRAND_NAME} ${title}</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:56px auto;padding:0 20px;line-height:1.55;color:#171717}h1,h2{line-height:1.2}a{color:inherit}</style></head><body><h1>${title}</h1><p><small>Last updated September 14, 2026</small></p>${body}${contact}</body></html>`;
}

app.get('/privacy',async(_req,reply)=>reply.type('text/html').send(legalPage('Privacy Policy',`
<h2>What ${env().PUBLIC_BRAND_NAME} processes</h2><p>${env().PUBLIC_BRAND_NAME} receives public Instagram Reel, TikTok and YouTube URLs only when a connected AI asks ${env().PUBLIC_BRAND_NAME} to read them. To provide a transcript, ${env().PUBLIC_BRAND_NAME} may process the URL, public video metadata, captions and temporary audio derived from the public video.</p>
<h2>Account and billing data</h2><p>${env().PUBLIC_BRAND_NAME} stores an account/session identifier, plan and quota usage, and identifiers needed to manage a Lemon Squeezy subscription. During the founding beta, a free trial can be started without an email address; if email sign-in is enabled later, the email address used to sign in is stored with the account. To limit repeated free-trial abuse, ${env().PUBLIC_BRAND_NAME} also uses a random first-party browser token associated with trial eligibility and returning beta sessions. ${env().PUBLIC_BRAND_NAME} does not store card numbers.</p>
<h2>Retention</h2><p>Downloaded media and derived audio are temporary processing files and are deleted after the job finishes. Transcript cache is temporary and defaults to 72 hours. Completed and failed job records are retained only as minimal operational/accounting records; the stored video URL and canonical media identifier are scrubbed after the transcript retention window. Unpaid pending jobs expire and have their media URL scrubbed after 24 hours.</p>
<h2>Service providers</h2><p>${env().PUBLIC_BRAND_NAME} may send the minimum data needed to service providers used for hosting, email authentication, billing, and media processing. These providers process data under their own terms and privacy policies.</p>
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
