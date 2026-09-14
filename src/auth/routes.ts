import type { FastifyInstance, FastifyReply } from 'fastify';
import { env } from '../config/env.js';
import { Link2AIError } from '../util/errors.js';
import {
  beginEmailLogin, beginGuestLogin, createAuthorizationCode, csrfTokenFromSessionCookie, exchangeAuthorizationCode, exchangeRefreshToken,
  getOAuthClient, loginFlowCookieName, mcpResource, parseCookies, registerOAuthClient, revokeOAuthToken, sessionCookieName,
  userFromSessionCookie, verifyCsrfToken, verifyEmailLogin, verifyReviewerLogin, claimTrialDevice, trialDeviceCookieName
} from './service.js';

function escapeHtml(v: unknown): string {
  return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!));
}
function html(body:string): string { return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(env().PUBLIC_BRAND_NAME)}</title><style>
:root{color-scheme:light;--ink:#101828;--muted:#667085;--line:#e4e7ec;--soft:#f8fafc}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:28px;background:radial-gradient(circle at 50% -20%,#eef2ff 0,#f8fafc 38%,#fff 72%);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink)}
.auth{width:min(480px,100%);background:#fff;border:1px solid var(--line);border-radius:22px;padding:30px;box-shadow:0 18px 60px rgba(16,24,40,.08)}
.logo{font-size:19px;font-weight:850;letter-spacing:-.035em;margin-bottom:34px}.step{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;background:#f2f4f7;color:#475467;font-size:12px;font-weight:750}
h1{font-size:32px;line-height:1.05;letter-spacing:-.04em;margin:14px 0 10px}p{line-height:1.55;margin:0 0 18px;color:var(--muted)}
label{display:block;font-size:13px;font-weight:750;margin:14px 0 6px}input,button{box-sizing:border-box;width:100%;padding:13px 14px;margin:0 0 10px;font:inherit;border-radius:12px}
input{border:1px solid #d0d5dd;background:#fff;outline:none}input:focus{border-color:#667085;box-shadow:0 0 0 3px rgba(16,24,40,.06)}
button{cursor:pointer;border:0;background:#101828;color:#fff;font-weight:780}.muted{color:#667085;font-size:13px}.tiny{font-size:12px;color:#98a2b3}
.review{margin-top:24px;padding-top:18px;border-top:1px solid var(--line)}details summary{cursor:pointer;color:#667085;font-size:13px;font-weight:700}
a{color:inherit}
</style></head><body><main class="auth"><div class="logo">${escapeHtml(env().PUBLIC_BRAND_NAME)}</div>${body}</main></body></html>`; }

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
    client_id_metadata_document_supported: true,
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
    const q = req.query as any;
    const returnTo = safeReturnTo(q.return_to);
    const reviewer=Boolean(env().REVIEWER_EMAIL&&env().REVIEWER_PASSWORD);
    const emailLogin=env().PUBLIC_EMAIL_LOGIN_ENABLED;
    return reply.type('text/html').send(html(`<span class="step">Founding beta</span><h1>Connect ${escapeHtml(env().PUBLIC_BRAND_NAME)}</h1><p>Start the free trial on this browser. No email, password or card needed.</p><form method="post" action="/auth/guest"><input type="hidden" name="return_to" value="${escapeHtml(returnTo)}"><button autofocus>Continue free</button></form><p class="tiny">3 successful links or 10 minutes of content, whichever comes first. After this, we return you to your AI automatically.</p>${emailLogin?`<div class="review"><details><summary>Sign in with email</summary><form method="post" action="/auth/start" style="margin-top:12px"><label>Email</label><input type="email" name="email" required autocomplete="email" placeholder="you@example.com"><input type="hidden" name="return_to" value="${escapeHtml(returnTo)}"><button>Send sign-in code</button></form></details></div>`:''}${reviewer?`<div class="review"><details><summary>OpenAI reviewer access</summary><form method="post" action="/auth/reviewer" style="margin-top:12px"><label>Reviewer email</label><input type="email" name="email" required autocomplete="username"><label>Reviewer password</label><input type="password" name="password" required autocomplete="current-password"><input type="hidden" name="return_to" value="${escapeHtml(returnTo)}"><button>Reviewer sign in</button></form></details></div>`:''}`));
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
      if (!user) return reply.redirect(`/login?return_to=${encodeURIComponent(authorizeQuery(request))}`);
      const csrf=csrfTokenFromSessionCookie(req.headers.cookie);
      if(!csrf)return reply.code(401).send('Sign in to connect this service.');
      const client=await getOAuthClient(request.clientId,request.redirectUri);
      if(!client)return reply.code(400).send('Unknown OAuth client or redirect URI.');
      return reply.type('text/html').send(html(`<h1>Connect ${escapeHtml(env().PUBLIC_BRAND_NAME)}</h1><p><strong>${escapeHtml(client.client_name)}</strong> wants permission to read supported public links through your ${escapeHtml(env().PUBLIC_BRAND_NAME)} account.</p><p class="muted">This lets the connected AI request content behind supported links and check your ${escapeHtml(env().PUBLIC_BRAND_NAME)} usage. ${escapeHtml(env().PUBLIC_BRAND_NAME)} does not give the client access to your email or payment details.</p><form method="post" action="/oauth/authorize">${authorizeHidden(request,csrf)}<button>Connect</button></form>`));
    }catch(e){return oauthError(reply,e);}
  });

  app.post('/oauth/authorize',async(req,reply)=>{
    try{
      const b=req.body as any;
      const request=parseAuthorizeRequest(b);
      const user=await userFromSessionCookie(req.headers.cookie);
      if(!user)return reply.redirect(`/login?return_to=${encodeURIComponent(authorizeQuery(request))}`);
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
