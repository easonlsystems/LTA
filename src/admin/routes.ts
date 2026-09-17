import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import {
  clearFounderStepUpCookie,
  createFounderStepUpCookie,
  csrfTokenFromSessionCookie,
  hasFounderStepUp,
  parseCookies,
  revokeWebSession,
  sessionCookieName,
  userFromSessionCookie,
  verifyCsrfToken,
} from '../auth/service.js';
import { browserSameOriginOk } from '../config/publicUrl.js';
import { hmacSha256, randomToken, sha256 } from '../util/crypto.js';

const ADMIN_CHALLENGE_COOKIE='link2ai_admin_challenge';
const CHALLENGE_TTL_SECONDS=300;
const ADMIN_SESSION_SECONDS=30*24*60*60;
const STEPUP_SECONDS=15*60;

type FounderRow={id:string;email:string};
type PasskeyRow={
  id:string;
  founder_user_id:string;
  credential_id:string;
  public_key:Buffer;
  counter:string|number;
  transports:string[]|null;
  device_name:string;
  device_type:string|null;
  backed_up:boolean;
  created_at:string;
  last_used_at:string|null;
};

function esc(value:unknown):string{
  return String(value??'').replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]??ch));
}
function founderConfiguredEmail():string{return env().FOUNDER_EMAIL?.trim().toLowerCase()??'';}
function expectedWebAuthn():{rpID:string;origin:string}{
  const url=new URL(env().PUBLIC_BASE_URL);
  return {rpID:url.hostname,origin:url.origin};
}
function secureSuffix():string{return env().NODE_ENV==='production'?'; Secure':'';}
function challengeCookie(token:string,maxAge=CHALLENGE_TTL_SECONDS):string{
  return `${ADMIN_CHALLENGE_COOKIE}=${encodeURIComponent(token)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureSuffix()}`;
}
function clearChallengeCookie():string{return challengeCookie('',0);}
function challengeSessionHash(token:string):string{return hmacSha256(env().APP_SECRET,`admin-webauthn:${token}`);}
function recoveryHash(code:string):string{return hmacSha256(env().APP_SECRET,`admin-recovery:${code.replace(/[^A-Z0-9]/gi,'').toUpperCase()}`);}
function newRecoveryCode():string{
  const raw=randomBytes(10).toString('hex').toUpperCase();
  return raw.match(/.{1,5}/g)!.join('-');
}
function privateHeaders(reply:FastifyReply):void{
  reply.header('Cache-Control','no-store, private');
  reply.header('Pragma','no-cache');
  reply.header('X-Frame-Options','DENY');
  reply.header('X-Content-Type-Options','nosniff');
  reply.header('Referrer-Policy','no-referrer');
  reply.header('X-Robots-Tag','noindex, nofollow, noarchive');
  reply.header('Cross-Origin-Opener-Policy','same-origin');
  reply.header('Cross-Origin-Resource-Policy','same-origin');
  reply.header('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), publickey-credentials-get=(self), publickey-credentials-create=(self)');
  reply.header('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}
function sameOrigin(req:FastifyRequest):boolean{
  return browserSameOriginOk(req.headers as Record<string,string|string[]|undefined>,env().PUBLIC_BASE_URL,env().NODE_ENV==='production');
}
async function configuredFounder():Promise<FounderRow|null>{
  const email=founderConfiguredEmail();
  if(!email)return null;
  const r=await pool.query<FounderRow>(`SELECT id,email FROM users WHERE lower(email)=lower($1) LIMIT 1`,[email]);
  return r.rows[0]??null;
}
async function currentFounder(req:FastifyRequest):Promise<FounderRow|null>{
  const email=founderConfiguredEmail();
  if(!email)return null;
  const user=await userFromSessionCookie(req.headers.cookie);
  if(!user||String(user.email??'').trim().toLowerCase()!==email)return null;
  return {id:user.id,email:String(user.email)};
}
async function activePasskeys(founderId:string):Promise<PasskeyRow[]>{
  const r=await pool.query<PasskeyRow>(`SELECT id,founder_user_id,credential_id,public_key,counter,transports,device_name,device_type,backed_up,created_at,last_used_at FROM founder_passkeys WHERE founder_user_id=$1 AND revoked_at IS NULL ORDER BY created_at`,[founderId]);
  return r.rows;
}
async function logSecurity(founderId:string,action:string,success:boolean):Promise<void>{
  await pool.query(`INSERT INTO founder_security_events(founder_user_id,action,success) VALUES($1,$2,$3)`,[founderId,action,success]).catch(()=>{});
}
async function storeChallenge(founderId:string,ceremony:'registration'|'authentication',challenge:string,browserToken:string):Promise<void>{
  await pool.query(`DELETE FROM founder_webauthn_challenges WHERE expires_at<now() OR consumed_at IS NOT NULL`);
  await pool.query(`INSERT INTO founder_webauthn_challenges(founder_user_id,browser_session_hash,ceremony,challenge,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes')`,[founderId,challengeSessionHash(browserToken),ceremony,challenge]);
}
async function consumeChallenge(founderId:string,ceremony:'registration'|'authentication',browserToken:string):Promise<string|null>{
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query<{id:string;challenge:string}>(`SELECT id,challenge FROM founder_webauthn_challenges WHERE founder_user_id=$1 AND browser_session_hash=$2 AND ceremony=$3 AND consumed_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,[founderId,challengeSessionHash(browserToken),ceremony]);
    if(!r.rowCount){await client.query('ROLLBACK');return null;}
    await client.query(`UPDATE founder_webauthn_challenges SET consumed_at=now() WHERE id=$1`,[r.rows[0].id]);
    await client.query('COMMIT');
    return r.rows[0].challenge;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
function getOrCreateBrowserToken(req:FastifyRequest,reply:FastifyReply):string{
  const existing=parseCookies(req.headers.cookie)[ADMIN_CHALLENGE_COOKIE];
  if(existing&&existing.length>=32&&existing.length<=256)return existing;
  const token=randomToken(32);
  reply.header('Set-Cookie',challengeCookie(token));
  return token;
}
async function createAdminWebSession(founderId:string):Promise<string>{
  const token=randomToken(32);
  await pool.query(`INSERT INTO web_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 days')`,[founderId,sha256(token)]);
  return token;
}
function sessionCookies(sessionToken:string):string[]{
  const base=`${sessionCookieName()}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_SECONDS}${secureSuffix()}`;
  const step=createFounderStepUpCookie(`${sessionCookieName()}=${encodeURIComponent(sessionToken)}`,STEPUP_SECONDS);
  return [base,...(step?[step]:[]),clearChallengeCookie()];
}
async function issueRecoveryCodes(founderId:string):Promise<string[]>{
  const codes=Array.from({length:10},()=>newRecoveryCode());
  const setId=randomToken(18);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`UPDATE founder_recovery_codes SET revoked_at=now() WHERE founder_user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL`,[founderId]);
    for(const code of codes){
      await client.query(`INSERT INTO founder_recovery_codes(founder_user_id,set_id,code_hash) VALUES($1,$2,$3)`,[founderId,setId,recoveryHash(code)]);
    }
    await client.query('COMMIT');
    return codes;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}

const adminCss=`:root{color-scheme:light;--ink:#17151f;--muted:#716b79;--line:rgba(44,39,55,.12);--purple:#6f54e8;--bg:#f7f6fb}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 80% -10%,rgba(111,84,232,.17),transparent 35%),var(--bg);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink)}.shell{width:min(880px,100%);margin:0 auto;padding:26px 18px 56px}.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:28px}.brand{display:flex;align-items:center;gap:10px;font-size:19px;font-weight:900}.brand img{width:36px;height:36px;border-radius:10px}.pill{font-size:11px;font-weight:850;padding:7px 10px;border-radius:999px;background:#ede9ff;color:#5b45c0}.hero,.card{background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:24px;box-shadow:0 18px 55px rgba(38,30,62,.07)}.hero{padding:26px}.card{padding:20px;margin-top:14px}h1{font-size:38px;letter-spacing:-.05em;line-height:1;margin:8px 0 12px}h2{font-size:19px;margin:0 0 8px}p{color:var(--muted);line-height:1.58}.actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:18px}.btn,button{appearance:none;border:0;border-radius:13px;padding:12px 15px;font:inherit;font-weight:850;cursor:pointer;text-decoration:none}.primary{background:linear-gradient(135deg,#6f54e8,#8d77ff);color:#fff}.secondary{background:#f0eef3;color:#27222d}.danger{background:#fff0f0;color:#9b3131}.status{margin-top:14px;font-size:12px;color:#6c6574;min-height:18px}.device{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:13px 0;border-top:1px solid var(--line)}.device:first-of-type{border-top:0}.device strong{display:block}.device span{font-size:11px;color:var(--muted)}.recovery{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:14px}.recovery code{padding:10px;border:1px solid var(--line);background:#faf9fc;border-radius:10px;font-size:12px}.hidden{display:none!important}input{width:100%;border:1px solid var(--line);border-radius:12px;padding:13px;font:inherit;margin-top:8px}.fine{font-size:11px;color:#8a8391}.install-help{display:none;margin-top:10px;font-size:12px;color:var(--muted)}@media(max-width:620px){.shell{padding:18px 13px 40px}.hero{padding:21px 17px;border-radius:20px}h1{font-size:32px}.actions{display:grid}.btn,button{width:100%;min-height:48px}.recovery{grid-template-columns:1fr}.top{margin-bottom:18px}}`;
function adminPage(body:string,csrf=''):string{
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="theme-color" content="#17151f"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="apple-mobile-web-app-title" content="Link2AI Admin"><meta name="admin-csrf" content="${esc(csrf)}"><title>Link2AI Admin</title><link rel="manifest" href="/admin/manifest.webmanifest"><link rel="icon" href="/logo.svg"><link rel="apple-touch-icon" href="/logo.svg"><style>${adminCss}</style></head><body><main class="shell"><div class="top"><div class="brand"><img src="/logo.svg" alt=""><span>Link2AI Admin</span></div><span class="pill">Private</span></div>${body}</main><script src="/admin/vendor/webauthn.js"></script><script src="/admin/app.js" defer></script></body></html>`;
}

const adminAppJs=`(()=>{
  const $=s=>document.querySelector(s);const csrf=$('meta[name="admin-csrf"]')?.content||'';const msg=(t,bad=false)=>{const e=$('#admin-status');if(e){e.textContent=t;e.style.color=bad?'#a33b3b':'#6c6574';}};
  const post=async(url,body={},needsCsrf=false)=>{const headers={'content-type':'application/json'};if(needsCsrf&&csrf)headers['x-csrf-token']=csrf;const r=await fetch(url,{method:'POST',credentials:'same-origin',cache:'no-store',headers,body:JSON.stringify(body)});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.message||data.error||('Request failed '+r.status));return data;};
  const auth=$('#passkey-auth');auth?.addEventListener('click',async()=>{try{auth.disabled=true;msg('Waiting for Face ID / Touch ID / Windows Hello…');const optionsJSON=await post('/admin/auth/options');const response=await SimpleWebAuthnBrowser.startAuthentication({optionsJSON});await post('/admin/auth/verify',{response});location.href='/founder';}catch(e){msg(e?.message||'Passkey verification failed.',true);auth.disabled=false;}});
  const add=$('#passkey-add');add?.addEventListener('click',async()=>{try{add.disabled=true;msg('Creating a trusted passkey…');const optionsJSON=await post('/admin/passkeys/options',{},true);const response=await SimpleWebAuthnBrowser.startRegistration({optionsJSON});const result=await post('/admin/passkeys/verify',{response,deviceName:(navigator.userAgentData?.platform||navigator.platform||'Trusted device')},true);if(result.recoveryCodes?.length){const box=$('#recovery-codes');box.innerHTML=result.recoveryCodes.map(c=>'<code>'+c+'</code>').join('');$('#recovery-wrap')?.classList.remove('hidden');msg('Passkey added. Save these recovery codes now; they are shown once.');}else{msg('Passkey added.');setTimeout(()=>location.reload(),700);}}catch(e){msg(e?.message||'Could not add passkey.',true);add.disabled=false;}});
  const rotate=$('#recovery-rotate');rotate?.addEventListener('click',async()=>{if(!confirm('Replace all unused recovery codes?'))return;try{const result=await post('/admin/recovery/rotate',{},true);const box=$('#recovery-codes');box.innerHTML=result.recoveryCodes.map(c=>'<code>'+c+'</code>').join('');$('#recovery-wrap')?.classList.remove('hidden');msg('New recovery codes created. Older unused codes are revoked.');}catch(e){msg(e?.message||'Could not rotate recovery codes.',true);}});
  let installPrompt=null;const ib=$('#install-admin');const help=$('#install-help');window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;if(ib)ib.hidden=false;});ib?.addEventListener('click',async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;ib.hidden=true;}else if(help){help.style.display='block';}});if('serviceWorker'in navigator)navigator.serviceWorker.register('/admin/sw.js',{scope:'/admin/'}).catch(()=>{});
})();`;

export async function registerAdminRoutes(app:FastifyInstance):Promise<void>{
  app.get('/admin/manifest.webmanifest',async(_req,reply)=>reply.header('Cache-Control','public, max-age=3600').type('application/manifest+json').send({name:'Link2AI Admin',short_name:'Link2AI Admin',description:'Private Link2AI founder administration',start_url:'/admin',scope:'/admin/',display:'standalone',background_color:'#f7f6fb',theme_color:'#17151f',icons:[{src:'/logo.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}]}));
  app.get('/admin/sw.js',async(_req,reply)=>reply.header('Cache-Control','no-cache').type('application/javascript').send(`self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin===location.origin&&(u.pathname.startsWith('/admin')||u.pathname.startsWith('/founder')))e.respondWith(fetch(e.request,{cache:'no-store'}));});`));
  app.get('/admin/app.js',async(_req,reply)=>reply.header('Cache-Control','no-cache').type('application/javascript').send(adminAppJs));
  app.get('/admin/vendor/webauthn.js',async(_req,reply)=>{
    let bundle:Buffer;
    try{bundle=await readFile('node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js');}
    catch{bundle=await readFile('node_modules/@simplewebauthn/browser/dist/bundle/index.es5.umd.min.js');}
    return reply.header('Cache-Control','public, max-age=31536000, immutable').type('application/javascript').send(bundle);
  });

  app.get('/admin',async(req,reply)=>{
    privateHeaders(reply);
    const configured=await configuredFounder();
    if(!configured)return reply.code(404).type('text/plain').send('Not found');
    const passkeys=await activePasskeys(configured.id);
    const current=await currentFounder(req);
    const stepped=Boolean(current&&hasFounderStepUp(req.headers.cookie));
    const csrf=current?csrfTokenFromSessionCookie(req.headers.cookie)??'':'';
    if(!passkeys.length&&!current)return reply.code(404).type('text/plain').send('Not found');
    if(!passkeys.length){
      const body=`<section class="hero"><span class="pill">One-time setup</span><h1>Secure this admin app with a passkey.</h1><p>The first passkey requires the existing Founder email verification once. After enrollment, email codes stop being an admin unlock method.</p><div class="actions">${stepped?'<button id="passkey-add" class="primary">Create first passkey</button>':'<a class="btn primary" href="/founder/unlock?return_to=%2Fadmin">Verify Founder email once</a>'}<button id="install-admin" class="secondary" hidden>Install Admin App</button></div><p id="install-help" class="install-help">On iPhone/iPad use Share → Add to Home Screen. On desktop/Android use the browser Install App option.</p><div id="admin-status" class="status"></div><div id="recovery-wrap" class="card hidden"><h2>Save these recovery codes offline</h2><p>Each code works once. They are the emergency path if every trusted device is lost.</p><div id="recovery-codes" class="recovery"></div></div></section>`;
      return reply.type('text/html').send(adminPage(body,csrf));
    }
    if(!stepped){
      const body=`<section class="hero"><span class="pill">Passkey protected</span><h1>Unlock Link2AI Admin.</h1><p>Use a registered passkey. The private key stays in your device or passkey provider; Link2AI stores only the public credential.</p><div class="actions"><button id="passkey-auth" class="primary">Unlock with passkey</button><button id="install-admin" class="secondary" hidden>Install Admin App</button></div><p id="install-help" class="install-help">On iPhone/iPad use Share → Add to Home Screen. On desktop/Android use the browser Install App option.</p><div id="admin-status" class="status"></div><div class="card"><h2>Lost every trusted device?</h2><form method="post" action="/admin/recovery"><input name="code" autocomplete="one-time-code" maxlength="40" placeholder="Recovery code" required><button class="secondary" style="margin-top:10px">Use one-time recovery code</button></form></div></section>`;
      return reply.type('text/html').send(adminPage(body));
    }
    const devices=passkeys.map(p=>`<div class="device"><div><strong>${esc(p.device_name)}</strong><span>Added ${esc(new Date(p.created_at).toLocaleDateString('en-CA'))}${p.last_used_at?` · last used ${esc(new Date(p.last_used_at).toLocaleDateString('en-CA'))}`:''}${p.backed_up?' · synced/backed up':''}</span></div><form method="post" action="/admin/passkeys/${encodeURIComponent(p.id)}/revoke"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="danger" type="submit">Remove</button></form></div>`).join('');
    const body=`<section class="hero"><span class="pill">Passkey verified</span><h1>Admin security.</h1><p>This device has a short-lived Founder authorization. Add another trusted device before you need it.</p><div class="actions"><a class="btn primary" href="/founder">Open Founder dashboard</a><button id="passkey-add" class="secondary">Add trusted passkey</button><button id="install-admin" class="secondary" hidden>Install Admin App</button></div><p id="install-help" class="install-help">On iPhone/iPad use Share → Add to Home Screen. On desktop/Android use the browser Install App option.</p><div id="admin-status" class="status"></div></section><section class="card"><h2>Trusted passkeys</h2>${devices}<p class="fine">The final passkey cannot be removed. Add another first, or keep recovery codes offline.</p></section><section class="card"><h2>Emergency recovery</h2><p>Recovery codes are single-use. Generating a new set revokes every unused old code.</p><button id="recovery-rotate" class="secondary">Generate new recovery codes</button><div id="recovery-wrap" class="hidden"><div id="recovery-codes" class="recovery"></div></div></section>`;
    return reply.type('text/html').send(adminPage(body,csrf));
  });

  app.post('/admin/auth/options',async(req,reply)=>{
    privateHeaders(reply);
    if(!sameOrigin(req))return reply.code(403).send({error:'invalid_request'});
    const founder=await configuredFounder();
    if(!founder)return reply.code(404).send({error:'not_found'});
    const passkeys=await activePasskeys(founder.id);
    if(!passkeys.length)return reply.code(409).send({error:'bootstrap_required'});
    const {rpID}=expectedWebAuthn();
    const options=await generateAuthenticationOptions({rpID,userVerification:'required',timeout:60_000,allowCredentials:passkeys.map(p=>({id:p.credential_id,transports:(p.transports??[]) as any}))});
    const browserToken=getOrCreateBrowserToken(req,reply);
    await storeChallenge(founder.id,'authentication',options.challenge,browserToken);
    return reply.send(options);
  });

  app.post('/admin/auth/verify',async(req,reply)=>{
    privateHeaders(reply);
    if(!sameOrigin(req))return reply.code(403).send({error:'invalid_request'});
    const founder=await configuredFounder();
    if(!founder)return reply.code(404).send({error:'not_found'});
    const body=(req.body??{}) as any;
    const credentialId=String(body?.response?.id??'');
    const p=await pool.query<PasskeyRow>(`SELECT id,founder_user_id,credential_id,public_key,counter,transports,device_name,device_type,backed_up,created_at,last_used_at FROM founder_passkeys WHERE founder_user_id=$1 AND credential_id=$2 AND revoked_at IS NULL LIMIT 1`,[founder.id,credentialId]);
    const passkey=p.rows[0];
    const browserToken=parseCookies(req.headers.cookie)[ADMIN_CHALLENGE_COOKIE]??'';
    const expectedChallenge=browserToken?await consumeChallenge(founder.id,'authentication',browserToken):null;
    if(!passkey||!expectedChallenge){await logSecurity(founder.id,'passkey_auth',false);return reply.code(401).send({error:'passkey_failed'});}
    try{
      const {rpID,origin}=expectedWebAuthn();
      const verification=await verifyAuthenticationResponse({response:body.response,expectedChallenge,expectedOrigin:origin,expectedRPID:rpID,credential:{id:passkey.credential_id,publicKey:new Uint8Array(passkey.public_key),counter:Number(passkey.counter),transports:(passkey.transports??[]) as any},requireUserVerification:true});
      if(!verification.verified)throw new Error('not verified');
      await pool.query(`UPDATE founder_passkeys SET counter=$2,last_used_at=now() WHERE id=$1`,[passkey.id,verification.authenticationInfo.newCounter]);
      const sessionToken=await createAdminWebSession(founder.id);
      reply.header('Set-Cookie',sessionCookies(sessionToken));
      await logSecurity(founder.id,'passkey_auth',true);
      return reply.send({verified:true});
    }catch(error){await logSecurity(founder.id,'passkey_auth',false);return reply.code(401).send({error:'passkey_failed',message:'Passkey verification failed.'});}
  });

  app.post('/admin/passkeys/options',async(req,reply)=>{
    privateHeaders(reply);
    const founder=await currentFounder(req);
    if(!founder||!hasFounderStepUp(req.headers.cookie))return reply.code(401).send({error:'locked'});
    if(!sameOrigin(req)||!verifyCsrfToken(req.headers.cookie,String(req.headers['x-csrf-token']??'')))return reply.code(403).send({error:'invalid_request'});
    const passkeys=await activePasskeys(founder.id);
    const {rpID}=expectedWebAuthn();
    const options=await generateRegistrationOptions({rpName:'Link2AI Admin',rpID,userName:'Link2AI Founder',userDisplayName:'Link2AI Founder',userID:new Uint8Array(Buffer.from(founder.id.replace(/-/g,''),'hex')),attestationType:'none',timeout:60_000,supportedAlgorithmIDs:[-7,-257],excludeCredentials:passkeys.map(p=>({id:p.credential_id,transports:(p.transports??[]) as any})),authenticatorSelection:{residentKey:'required',userVerification:'required'}});
    const browserToken=getOrCreateBrowserToken(req,reply);
    await storeChallenge(founder.id,'registration',options.challenge,browserToken);
    return reply.send(options);
  });

  app.post('/admin/passkeys/verify',async(req,reply)=>{
    privateHeaders(reply);
    const founder=await currentFounder(req);
    if(!founder||!hasFounderStepUp(req.headers.cookie))return reply.code(401).send({error:'locked'});
    if(!sameOrigin(req)||!verifyCsrfToken(req.headers.cookie,String(req.headers['x-csrf-token']??'')))return reply.code(403).send({error:'invalid_request'});
    const body=(req.body??{}) as any;
    const browserToken=parseCookies(req.headers.cookie)[ADMIN_CHALLENGE_COOKIE]??'';
    const expectedChallenge=browserToken?await consumeChallenge(founder.id,'registration',browserToken):null;
    if(!expectedChallenge)return reply.code(401).send({error:'challenge_expired'});
    try{
      const {rpID,origin}=expectedWebAuthn();
      const verification=await verifyRegistrationResponse({response:body.response,expectedChallenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,supportedAlgorithmIDs:[-7,-257]});
      if(!verification.verified||!verification.registrationInfo)throw new Error('not verified');
      const info=verification.registrationInfo;
      const credential=info.credential;
      const countBefore=Number((await pool.query<{count:string}>(`SELECT COUNT(*)::text count FROM founder_passkeys WHERE founder_user_id=$1 AND revoked_at IS NULL`,[founder.id])).rows[0]?.count??0);
      const deviceName=String(body.deviceName??'Trusted device').trim().slice(0,80)||'Trusted device';
      await pool.query(`INSERT INTO founder_passkeys(founder_user_id,credential_id,public_key,counter,transports,device_name,device_type,backed_up,last_used_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()) ON CONFLICT(credential_id) DO NOTHING`,[founder.id,credential.id,Buffer.from(credential.publicKey),credential.counter,credential.transports??[],deviceName,info.credentialDeviceType??null,Boolean(info.credentialBackedUp)]);
      const recoveryCodes=countBefore===0?await issueRecoveryCodes(founder.id):undefined;
      await logSecurity(founder.id,'passkey_register',true);
      return reply.send({verified:true,recoveryCodes});
    }catch(error){await logSecurity(founder.id,'passkey_register',false);return reply.code(400).send({error:'passkey_registration_failed',message:'Could not register this passkey.'});}
  });

  app.post('/admin/passkeys/:id/revoke',async(req,reply)=>{
    privateHeaders(reply);
    const founder=await currentFounder(req);
    if(!founder||!hasFounderStepUp(req.headers.cookie))return reply.code(404).type('text/plain').send('Not found');
    const body=(req.body??{}) as Record<string,unknown>;
    if(!sameOrigin(req)||!verifyCsrfToken(req.headers.cookie,String(body.csrf??'')))return reply.code(403).type('text/plain').send('Invalid request');
    const id=String((req.params as {id?:string})?.id??'');
    const count=Number((await pool.query<{count:string}>(`SELECT COUNT(*)::text count FROM founder_passkeys WHERE founder_user_id=$1 AND revoked_at IS NULL`,[founder.id])).rows[0]?.count??0);
    if(count<=1)return reply.code(409).type('text/plain').send('Add another trusted passkey before removing the final one.');
    await pool.query(`UPDATE founder_passkeys SET revoked_at=now() WHERE id=$1 AND founder_user_id=$2 AND revoked_at IS NULL`,[id,founder.id]);
    await logSecurity(founder.id,'passkey_revoke',true);
    return reply.redirect('/admin');
  });

  app.post('/admin/recovery/rotate',async(req,reply)=>{
    privateHeaders(reply);
    const founder=await currentFounder(req);
    if(!founder||!hasFounderStepUp(req.headers.cookie))return reply.code(401).send({error:'locked'});
    if(!sameOrigin(req)||!verifyCsrfToken(req.headers.cookie,String(req.headers['x-csrf-token']??'')))return reply.code(403).send({error:'invalid_request'});
    const recoveryCodes=await issueRecoveryCodes(founder.id);
    await logSecurity(founder.id,'recovery_rotate',true);
    return reply.send({recoveryCodes});
  });

  app.post('/admin/recovery',async(req,reply)=>{
    privateHeaders(reply);
    if(!sameOrigin(req))return reply.code(403).type('text/plain').send('Invalid request');
    const founder=await configuredFounder();
    if(!founder)return reply.code(404).type('text/plain').send('Not found');
    const code=String((req.body as Record<string,unknown>|undefined)?.code??'');
    const hash=recoveryHash(code);
    const client=await pool.connect();
    let ok=false;
    try{
      await client.query('BEGIN');
      const r=await client.query<{id:string}>(`SELECT id FROM founder_recovery_codes WHERE founder_user_id=$1 AND code_hash=$2 AND consumed_at IS NULL AND revoked_at IS NULL LIMIT 1 FOR UPDATE`,[founder.id,hash]);
      if(r.rowCount){await client.query(`UPDATE founder_recovery_codes SET consumed_at=now() WHERE id=$1`,[r.rows[0].id]);ok=true;}
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
    await logSecurity(founder.id,'recovery_use',ok);
    if(!ok)return reply.code(401).type('text/html').send(adminPage(`<section class="hero"><h1>Recovery code not accepted.</h1><p>The code is invalid, already used, or revoked.</p><div class="actions"><a class="btn secondary" href="/admin">Try again</a></div></section>`));
    const sessionToken=await createAdminWebSession(founder.id);
    reply.header('Set-Cookie',sessionCookies(sessionToken));
    return reply.redirect('/admin');
  });

  app.post('/admin/logout',async(req,reply)=>{
    privateHeaders(reply);
    const founder=await currentFounder(req);
    if(!founder)return reply.code(404).type('text/plain').send('Not found');
    const body=(req.body??{}) as Record<string,unknown>;
    if(!sameOrigin(req)||!verifyCsrfToken(req.headers.cookie,String(body.csrf??'')))return reply.code(403).type('text/plain').send('Invalid request');
    await revokeWebSession(req.headers.cookie).catch(()=>{});
    reply.header('Set-Cookie',[`${sessionCookieName()}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureSuffix()}`,clearFounderStepUpCookie(),clearChallengeCookie()]);
    return reply.redirect('/admin');
  });
}
