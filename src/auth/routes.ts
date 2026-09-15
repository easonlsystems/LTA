import type { FastifyInstance, FastifyReply } from 'fastify';
import { env } from '../config/env.js';
import { Link2AIError } from '../util/errors.js';
import {
  beginEmailLogin, beginGuestLogin, createAuthorizationCode, csrfTokenFromSessionCookie, exchangeAuthorizationCode, exchangeRefreshToken,
  getOAuthClient, loginFlowCookieName, mcpResource, parseCookies, registerOAuthClient, registerPasswordAccount, revokeOAuthToken, revokeWebSession, sessionCookieName,
  userFromSessionCookie, verifyCsrfToken, verifyEmailLogin, verifyPasswordLogin, verifyReviewerLogin, claimTrialDevice, trialDeviceCookieName
} from './service.js';
import { linkWebsiteVisitorToUser, trackWebsiteVisit } from '../analytics/visitors.js';

function escapeHtml(v: unknown): string {
  return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!));
}
function html(body:string): string { return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(env().PUBLIC_BRAND_NAME)}</title><link rel="icon" href="/logo.svg"><style>
:root{color-scheme:light;--ink:#17151f;--muted:#706a78;--line:rgba(44,39,55,.12);--purple:#6f54e8}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:26px;background:radial-gradient(circle at 68% -10%,rgba(135,112,255,.20),transparent 35%),radial-gradient(circle at 5% 90%,rgba(239,154,98,.13),transparent 30%),#fbfaf8;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink)}
.auth{width:min(500px,100%);background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:28px;padding:31px;box-shadow:0 24px 75px rgba(39,31,64,.12);backdrop-filter:blur(16px)}
.logo{display:flex;align-items:center;gap:10px;font-size:19px;font-weight:900;letter-spacing:-.04em;margin-bottom:30px}.logo img{width:34px;height:34px;border-radius:10px}.step{display:inline-flex;align-items:center;gap:8px;padding:7px 10px;border-radius:999px;background:#f0edff;color:#5a45bc;font-size:11px;font-weight:850}
h1{font-size:34px;line-height:1.04;letter-spacing:-.045em;margin:15px 0 11px}p{line-height:1.58;margin:0 0 18px;color:var(--muted)}
label{display:block;font-size:12px;font-weight:800;margin:14px 0 6px}input,button{box-sizing:border-box;width:100%;padding:13px 14px;margin:0 0 10px;font:inherit;border-radius:13px}
input{border:1px solid #d5d0da;background:#fff;outline:none}input:focus{border-color:#8d77ff;box-shadow:0 0 0 4px rgba(111,84,232,.08)}
button{cursor:pointer;border:0;background:linear-gradient(135deg,#6f54e8,#8d77ff);color:#fff;font-weight:820;box-shadow:0 8px 20px rgba(111,84,232,.18)}.muted{color:#706a78;font-size:13px}.tiny{font-size:12px;color:#908997;line-height:1.5}.review{margin-top:24px;padding-top:18px;border-top:1px solid var(--line)}details summary{cursor:pointer;color:#706a78;font-size:13px;font-weight:750}a{color:inherit}.trust{display:flex;gap:8px;flex-wrap:wrap;margin-top:17px}.trust span{font-size:10px;font-weight:800;color:#706a78;background:#f5f3f0;padding:6px 8px;border-radius:999px}
@media(max-width:620px){body{display:block;padding:16px 13px 28px;min-height:100dvh}.auth{width:100%;max-width:none;padding:22px 18px;border-radius:22px;margin:0 auto}.logo{margin-bottom:23px;font-size:18px}.logo img{width:32px;height:32px}h1{font-size:30px;line-height:1.07;margin-top:13px}p{font-size:14px;margin-bottom:16px}label{margin-top:13px}input,button{min-height:48px;font-size:16px;padding:12px 13px;border-radius:12px}button{font-size:15px}.trust{gap:6px}.trust span{font-size:9px}.review{margin-top:19px;padding-top:15px}.tiny{font-size:12px}}
@media(max-width:360px){body{padding-left:10px;padding-right:10px}.auth{padding:19px 15px}h1{font-size:28px}}
</style></head><body><main class="auth"><div class="logo"><img src="/logo.svg" alt=""><span>${escapeHtml(env().PUBLIC_BRAND_NAME)}</span></div>${body}${env().SUPPORT_EMAIL?`<p class="tiny" style="margin-top:18px;padding-top:15px;border-top:1px solid var(--line)">Need help? <a href="mailto:${escapeHtml(env().SUPPORT_EMAIL)}"><strong>${escapeHtml(env().SUPPORT_EMAIL)}</strong></a></p>`:''}</main></body></html>`; }

function safeReturnTo(raw: string | undefined): string {
  if (!raw || raw.length>4096) return '/account';
  try {
    const base = new URL(env().PUBLIC_BASE_URL);
    const url = new URL(raw, base);
    if (url.origin !== base.origin) return '/account';
    return `${url.pathname}${url.search}`;
  } catch { return '/account'; }
}

interface AuthorizeRequest {
  responseType:string;
  clientId:string;
  redirectUri:string;
  challenge:string;
  method:string;
  state:string;
  scope:string;
  resource?:string;
}

function boundedOAuthString(value:unknown,name:string,max:number,{required=true}:{required?:boolean}={}):string{
  const text=String(value??'');
  if((required&&!text)||text.length>max)throw new Link2AIError('AUTH_REQUIRED',`Invalid OAuth ${name}.`,400);
  return text;
}

function parseAuthorizeRequest(input:any):AuthorizeRequest{
  const request:AuthorizeRequest={
    responseType:boundedOAuthString(input?.response_type,'response_type',32),
    clientId:boundedOAuthString(input?.client_id,'client_id',2048),
    redirectUri:boundedOAuthString(input?.redirect_uri,'redirect_uri',2048),
    challenge:boundedOAuthString(input?.code_challenge,'code_challenge',128),
    method:boundedOAuthString(input?.code_challenge_method,'code_challenge_method',32),
    state:boundedOAuthString(input?.state,'state',2048,{required:false}),
    scope:boundedOAuthString(input?.scope??'link2ai:read offline_access','scope',512),
    ...(input?.resource?{resource:boundedOAuthString(input.resource,'resource',2048)}:{})
  };
  if(request.responseType!=='code'||request.method!=='S256'||!/^[A-Za-z0-9_-]{43,128}$/.test(request.challenge)){
    throw new Link2AIError('AUTH_REQUIRED','OAuth requires authorization_code + PKCE S256.',400);
  }
  return request;
}

function authorizeQuery(request:AuthorizeRequest):string{
  const q=new URLSearchParams({
    response_type:request.responseType,client_id:request.clientId,redirect_uri:request.redirectUri,
    code_challenge:request.challenge,code_challenge_method:request.method,scope:request.scope
  });
  if(request.state)q.set('state',request.state);
  if(request.resource)q.set('resource',request.resource);
  return `/oauth/authorize?${q.toString()}`;
}

function authorizeHidden(request:AuthorizeRequest,csrf:string):string{
  const fields:Record<string,string>={
    response_type:request.responseType,client_id:request.clientId,redirect_uri:request.redirectUri,
    code_challenge:request.challenge,code_challenge_method:request.method,scope:request.scope,csrf
  };
  if(request.state)fields.state=request.state;
  if(request.resource)fields.resource=request.resource;
  return Object.entries(fields).map(([k,v])=>`<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join('');
}

function loginFlowCookie(value:string,maxAge:number):string{
  const secure=env().NODE_ENV==='production'?'; Secure':'';
  return `${loginFlowCookieName()}=${encodeURIComponent(value)}; Path=/auth/verify; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/.well-known/oauth-authorization-server', async () => ({
    issuer: env().PUBLIC_BASE_URL,
    authorization_endpoint: `${env().PUBLIC_BASE_URL}/oauth/authorize`,
    token_endpoint: `${env().PUBLIC_BASE_URL}/oauth/token`,
    registration_endpoint: `${env().PUBLIC_BASE_URL}/oauth/register`,
    revocation_endpoint: `${env().PUBLIC_BASE_URL}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code','refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['link2ai:read','offline_access'],
    resource_parameter_supported: true,
    authorization_response_iss_parameter_supported: true,
    revocation_endpoint_auth_methods_supported: ['none']
  }));

  const protectedResourceMetadata = async () => ({
    resource: mcpResource(),
    authorization_servers: [env().PUBLIC_BASE_URL],
    scopes_supported: ['link2ai:read'],
    bearer_methods_supported: ['header']
  });
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResourceMetadata);
  app.get('/.well-known/oauth-protected-resource', protectedResourceMetadata);

  app.post('/oauth/register', async (req, reply) => {
    const b = req.body as any;
    try {
      const applicationType=String(b?.application_type??'web');
      if(!['web','native'].includes(applicationType))throw new Link2AIError('AUTH_REQUIRED','Unsupported OAuth application_type.',400);
      const client = await registerOAuthClient(String(b?.client_name ?? 'MCP Client'), Array.isArray(b?.redirect_uris) ? b.redirect_uris.map(String) : []);
      return reply.code(201).send({ ...client, client_id_issued_at:Math.floor(Date.now()/1000), token_endpoint_auth_method:'none', grant_types:['authorization_code','refresh_token'], response_types:['code'], application_type:applicationType });
    } catch (e) { return oauthError(reply,e); }
  });

  app.get('/login', async (req, reply) => {
    await trackWebsiteVisit(req,reply,'/login');
    const q=req.query as any;
    const returnTo=safeReturnTo(q.return_to);
    const reviewer=Boolean(env().REVIEWER_EMAIL&&env().REVIEWER_PASSWORD);
    const legacyCodeLogin=env().PUBLIC_EMAIL_LOGIN_ENABLED;
    return reply.type('text/html').send(html(`<span class="step">Link2AI account</span><h1>Sign in to continue.</h1><p>Your email is your Link2AI account. It keeps your trial, usage and plan attached to you across browsers and devices.</p><form method="post" action="/auth/password/login"><label>Email</label><input type="email" name="email" required autocomplete="email" placeholder="you@example.com"><label>Password</label><input type="password" name="password" required minlength="10" maxlength="128" autocomplete="current-password" placeholder="Your password"><input type="hidden" name="return_to" value="${escapeHtml(returnTo)}"><button autofocus>Sign in and continue</button></form><p class="tiny">New to ${escapeHtml(env().PUBLIC_BRAND_NAME)}? <a href="/signup?return_to=${encodeURIComponent(returnTo)}"><strong>Create an account</strong></a>. No card required for the trial.</p><div class="trust"><span>3 links or 10 minutes free</span><span>Public links only</span><span>Failed jobs do not count</span></div>${legacyCodeLogin?`<div class="review"><details><summary>Use an email sign-in code instead</summary><form method="post" action="/auth/start" style="margin-top:12px"><label>Email</label><input type="email" name="email" required autocomplete="email" placeholder="you@example.com"><input type="hidden" name="return_to" value="${escapeHtml(returnTo)}"><button>Send sign-in code</button></form></details></div>`:''}${reviewer?`<div class="review"><details><summary>OpenAI reviewer access</summary><form method="post" action="/auth/reviewer" style="margin-top:12px"><label>Reviewer email</label><input type="email" name="email" required autocomplete="username"><label>Reviewer password</label><input type="password" name="password" required autocomplete="current-password"><input type="hidden" name="return_to" value="${escapeHtml(returnTo)}"><button>Reviewer sign in</button></form></details></div>`:''}`));
  });

  app.get('/signup',async(req,reply)=>{
    await trackWebsiteVisit(req,reply,'/signup');
    const q=req.query as any;
    const returnTo=safeReturnTo(q.return_to);
    const current=await userFromSessionCookie(req.headers.cookie);
    const upgrading=Boolean(current&&!current.email);
    return reply.type('text/html').send(html(`<span class="step">${upgrading?'Finish account setup':'Create account'}</span><h1>${upgrading?'Keep this Link2AI account.':'Create your Link2AI account.'}</h1><p>${upgrading?'Add an email and password to the account you already used. Your current usage and Claude connection stay attached.':'Use an email and password so your trial, usage and plan follow you across devices.'}</p><form method="post" action="/auth/password/register"><label>Email</label><input type="email" name="email" required autocomplete="email" placeholder="you@example.com"><label>Password</label><input type="password" name="password" required minlength="10" maxlength="128" autocomplete="new-password" placeholder="At least 10 characters"><input type="hidden" name="return_to" value="${escapeHtml(returnTo)}"><button>${upgrading?'Save account and continue':'Create account and continue'}</button></form><p class="tiny">Already have an account? <a href="/login?return_to=${encodeURIComponent(returnTo)}"><strong>Sign in</strong></a>. Password reset by email will be added after the beta; for now, keep your password safe or contact Support if you lose access.</p><div class="trust"><span>No card for trial</span><span>Same account on every device</span><span>Passwords are salted + hashed</span></div>`));
  });

  app.post('/auth/password/login',async(req,reply)=>{
    const b=req.body as any;
    const returnTo=safeReturnTo(b?.return_to);
    try{
      const result=await verifyPasswordLogin(String(b?.email??''),String(b?.password??''),returnTo);
      await linkWebsiteVisitorToUser(req.headers.cookie,result.user.id,false);
      const priorDevice=parseCookies(req.headers.cookie)[trialDeviceCookieName()];
      const trial=await claimTrialDevice(result.user.id,priorDevice);
      const secure=env().NODE_ENV==='production'?'; Secure':'';
      reply.header('Set-Cookie',[
        `${sessionCookieName()}=${encodeURIComponent(result.sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
        `${trialDeviceCookieName()}=${encodeURIComponent(trial.deviceToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`
      ]);
      return reply.redirect(result.returnTo);
    }catch(e){return friendlyError(reply,e);}
  });

  app.post('/auth/password/register',async(req,reply)=>{
    const b=req.body as any;
    const returnTo=safeReturnTo(b?.return_to);
    try{
      const current=await userFromSessionCookie(req.headers.cookie);
      const result=await registerPasswordAccount(String(b?.email??''),String(b?.password??''),returnTo,current?.id);
      await linkWebsiteVisitorToUser(req.headers.cookie,result.user.id,true);
      const priorDevice=parseCookies(req.headers.cookie)[trialDeviceCookieName()];
      const trial=await claimTrialDevice(result.user.id,priorDevice);
      const secure=env().NODE_ENV==='production'?'; Secure':'';
      reply.header('Set-Cookie',[
        `${sessionCookieName()}=${encodeURIComponent(result.sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
        `${trialDeviceCookieName()}=${encodeURIComponent(trial.deviceToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`
      ]);
      return reply.redirect(result.returnTo);
    }catch(e){return friendlyError(reply,e);}
  });

  app.post('/auth/logout',async(req,reply)=>{
    const b=req.body as any;
    if(!verifyCsrfToken(req.headers.cookie,String(b?.csrf??'')))return reply.code(403).type('text/html').send(html(`<h1>Sign-out expired.</h1><p><a href="/account">Back to account</a></p>`));
    await revokeWebSession(req.headers.cookie).catch(()=>{});
    const secure=env().NODE_ENV==='production'?'; Secure':'';
    reply.header('Set-Cookie',`${sessionCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
    return reply.redirect('/');
  });

  app.post('/auth/guest', async (req, reply) => {
    const b=req.body as any;
    const returnTo=safeReturnTo(b?.return_to);
    try{
      const priorDevice=parseCookies(req.headers.cookie)[trialDeviceCookieName()];
      const result=await beginGuestLogin(priorDevice,returnTo);
      const secure=env().NODE_ENV==='production'?'; Secure':'';
      reply.header('Set-Cookie',[
        `${sessionCookieName()}=${encodeURIComponent(result.sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
        `${trialDeviceCookieName()}=${encodeURIComponent(result.deviceToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`
      ]);
      return reply.redirect(result.returnTo);
    }catch(e){return friendlyError(reply,e);}
  });

  app.post('/auth/start', async (req, reply) => {
    const b = req.body as any;
    const returnTo = safeReturnTo(b?.return_to);
    try {
      const result = await beginEmailLogin(String(b?.email ?? ''), returnTo);
      reply.header('Set-Cookie',loginFlowCookie(result.flowToken,600));
      return reply.type('text/html').send(html(`<span class="step">2 of 2 · Verify</span><h1>Check your email</h1><p>We sent a 6-digit code to <strong style="color:#101828">${escapeHtml(b?.email)}</strong>.</p>${result.devCode ? `<p class="muted">Development code: <strong>${result.devCode}</strong></p>` : ''}<form method="post" action="/auth/verify"><label>6-digit code</label><input type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" name="code" required autofocus placeholder="000000"><input type="hidden" name="email" value="${escapeHtml(b?.email)}"><button>Verify and continue</button></form><p class="tiny">After verification, ${escapeHtml(env().PUBLIC_BRAND_NAME)} continues the connection automatically.</p>`));
    } catch (e) { return friendlyError(reply,e); }
  });

  app.post('/auth/verify', async (req, reply) => {
    const b = req.body as any;
    const flowToken=parseCookies(req.headers.cookie)[loginFlowCookieName()]??'';
    try {
      const result = await verifyEmailLogin(String(b?.email ?? ''), String(b?.code ?? ''), flowToken);
      await linkWebsiteVisitorToUser(req.headers.cookie,result.user.id,false);
      const secure = env().NODE_ENV === 'production' ? '; Secure' : '';
      const priorDevice=parseCookies(req.headers.cookie)[trialDeviceCookieName()];
      const trial=await claimTrialDevice(result.user.id,priorDevice);
      reply.header('Set-Cookie', [
        `${sessionCookieName()}=${encodeURIComponent(result.sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
        `${trialDeviceCookieName()}=${encodeURIComponent(trial.deviceToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
        loginFlowCookie('',0)
      ]);
      return reply.redirect(result.returnTo);
    } catch (e) { return friendlyError(reply,e); }
  });

  app.post('/auth/reviewer', async (req, reply) => {
    const b=req.body as any;
    const returnTo=safeReturnTo(b?.return_to);
    try{
      const result=await verifyReviewerLogin(String(b?.email??''),String(b?.password??''),returnTo);
      const secure=env().NODE_ENV==='production'?'; Secure':'';
      const priorDevice=parseCookies(req.headers.cookie)[trialDeviceCookieName()];
      const trial=await claimTrialDevice(result.user.id,priorDevice);
      reply.header('Set-Cookie',[
        `${sessionCookieName()}=${encodeURIComponent(result.sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`,
        `${trialDeviceCookieName()}=${encodeURIComponent(trial.deviceToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`
      ]);
      return reply.redirect(result.returnTo);
    }catch(e){return friendlyError(reply,e);}
  });

  app.get('/oauth/authorize', async (req, reply) => {
    try{
      const request=parseAuthorizeRequest(req.query as any);
      // Never let an unauthenticated authorize request turn CIMD into an outbound
      // fetch primitive. Validate/fetch the client only after Link2AI sign-in exists.
      const user = await userFromSessionCookie(req.headers.cookie);
      if (!user) return reply.redirect(`/signup?return_to=${encodeURIComponent(authorizeQuery(request))}`);
      if (!user.email) return reply.redirect(`/signup?return_to=${encodeURIComponent(authorizeQuery(request))}`);
      const csrf=csrfTokenFromSessionCookie(req.headers.cookie);
      if(!csrf)return reply.code(401).send('Sign in to connect this service.');
      const client=await getOAuthClient(request.clientId,request.redirectUri);
      if(!client)return reply.code(400).send('Unknown OAuth client or redirect URI.');
      return reply.type('text/html').send(html(`<span class="step">Permission</span><h1>Connect ${escapeHtml(client.client_name)}</h1><p>Allow <strong style="color:#17151f">${escapeHtml(client.client_name)}</strong> to ask ${escapeHtml(env().PUBLIC_BRAND_NAME)} for AI-readable content behind supported public links and to check your ${escapeHtml(env().PUBLIC_BRAND_NAME)} usage.</p><p class="muted">This does not give the AI client access to your email or payment details, and it does not let ${escapeHtml(env().PUBLIC_BRAND_NAME)} post, like, follow, edit or delete anything on the source platform.</p><form method="post" action="/oauth/authorize">${authorizeHidden(request,csrf)}<button>Connect and return</button></form>`));
    }catch(e){return oauthError(reply,e);}
  });

  app.post('/oauth/authorize',async(req,reply)=>{
    try{
      const b=req.body as any;
      const request=parseAuthorizeRequest(b);
      const user=await userFromSessionCookie(req.headers.cookie);
      if(!user)return reply.redirect(`/signup?return_to=${encodeURIComponent(authorizeQuery(request))}`);
      if(!user.email)return reply.redirect(`/signup?return_to=${encodeURIComponent(authorizeQuery(request))}`);
      if(!verifyCsrfToken(req.headers.cookie,String(b?.csrf??'')))return reply.code(403).send('Authorization confirmation expired. Please try connecting again.');
      const client=await getOAuthClient(request.clientId,request.redirectUri);
      if(!client)return reply.code(400).send('Unknown OAuth client or redirect URI.');
      const code=await createAuthorizationCode({userId:user.id,clientId:request.clientId,redirectUri:request.redirectUri,codeChallenge:request.challenge,scope:request.scope,resource:request.resource});
      const target=new URL(request.redirectUri);
      target.searchParams.set('code',code);
      target.searchParams.set('iss',env().PUBLIC_BASE_URL);
      if(request.state)target.searchParams.set('state',request.state);
      return reply.redirect(target.toString());
    }catch(e){return oauthError(reply,e);}
  });

  app.post('/oauth/revoke',async(req,reply)=>{
    const b=req.body as any;
    try{
      await revokeOAuthToken({token:String(b?.token??''),clientId:b?.client_id?String(b.client_id):undefined});
      // RFC 7009 intentionally returns 200 even for an unknown token.
      return reply.code(200).send();
    }catch(e){return oauthError(reply,e);}
  });

  app.post('/oauth/token', async (req, reply) => {
    const b = req.body as any;
    try {
      if (b?.grant_type === 'authorization_code') {
        const code=boundedOAuthString(b.code,'authorization code',512);
        const clientId=boundedOAuthString(b.client_id,'client_id',2048);
        const redirectUri=boundedOAuthString(b.redirect_uri,'redirect_uri',2048);
        const codeVerifier=boundedOAuthString(b.code_verifier,'code_verifier',128);
        if(!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier))throw new Link2AIError('AUTH_REQUIRED','Invalid PKCE code_verifier.',400);
        const result = await exchangeAuthorizationCode({code,clientId,redirectUri,codeVerifier,resource:b.resource?boundedOAuthString(b.resource,'resource',2048):undefined});
        return reply.send({ token_type:'Bearer', ...result });
      }
      if (b?.grant_type === 'refresh_token') {
        const result = await exchangeRefreshToken({refreshToken:boundedOAuthString(b.refresh_token,'refresh token',1024),clientId:boundedOAuthString(b.client_id,'client_id',2048),resource:b.resource?boundedOAuthString(b.resource,'resource',2048):undefined});
        return reply.send({ token_type:'Bearer', ...result });
      }
      return reply.code(400).send({error:'unsupported_grant_type'});
    } catch(e) { return oauthError(reply,e); }
  });
}

function oauthError(reply:FastifyReply,e:unknown){ const err=e instanceof Link2AIError?e:new Link2AIError('INTERNAL_ERROR','OAuth error',500); return reply.code(err.status).send({error:err.status===401?'invalid_grant':'invalid_request',error_description:err.message}); }
function friendlyError(reply:FastifyReply,e:unknown){ const err=e instanceof Error?e.message:'Something went wrong.'; return reply.code(400).type('text/html').send(html(`<h1>${escapeHtml(env().PUBLIC_BRAND_NAME)}</h1><p>${escapeHtml(err)}</p><p><a href="/login">Try again</a></p>`)); }
