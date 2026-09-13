import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { hmacSha256, pkceS256, randomNumericCode, randomToken, sha256, timingSafeEqualHex } from '../util/crypto.js';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { Link2AIError } from '../util/errors.js';
import { fetchCimdOAuthClient, validateOAuthRedirectUris, type ResolvedOAuthClient } from './clientMetadata.js';

const SESSION_COOKIE = 'link2ai_session';
const LOGIN_FLOW_COOKIE = 'link2ai_login_flow';

export interface AuthUser { id: string; email: string | null; plan: 'trial'|'basic'|'pro'; }

export function mcpResource(): string { return new URL('/mcp', env().PUBLIC_BASE_URL).toString(); }

function normalizeResource(raw?: string): string {
  const expected = mcpResource();
  if (!raw) return expected; // Backward-compatible with older MCP clients; issued token is still audience-bound.
  let actual: string;
  try { actual = new URL(raw).toString(); } catch { throw new Link2AIError('AUTH_REQUIRED','Invalid OAuth resource.',400); }
  if (actual !== expected) throw new Link2AIError('AUTH_REQUIRED','OAuth resource does not match this MCP server.',400);
  return expected;
}

function normalizeScope(raw?: string): string {
  const requested=(raw ?? 'link2ai:read offline_access').trim().split(/\s+/).filter(Boolean);
  if (!requested.length) return 'link2ai:read offline_access';
  const allowed=new Set(['link2ai:read','offline_access']);
  if (requested.some(scope => !allowed.has(scope))) throw new Link2AIError('AUTH_REQUIRED','Unsupported OAuth scope.',400);
  if(!requested.includes('link2ai:read'))requested.unshift('link2ai:read');
  return [...new Set(requested)].join(' ');
}

export function sessionCookieName(): string { return SESSION_COOKIE; }
export function loginFlowCookieName(): string { return LOGIN_FLOW_COOKIE; }

export function hashLoginCode(email: string, code: string): string {
  return sha256(`${email.trim().toLowerCase()}:${code}:${env().APP_SECRET}`);
}

export async function beginEmailLogin(emailRaw: string, returnTo: string): Promise<{devCode?:string;flowToken:string}> {
  const email = emailRaw.trim().toLowerCase();
  if (email.length>320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Link2AIError('AUTH_REQUIRED', 'Enter a valid email address.', 400);
  if(returnTo.length>4096)throw new Link2AIError('AUTH_REQUIRED','Sign-in return path is too long.',400);
  const code = randomNumericCode(6);
  const flowToken=randomToken(32);
  const client=await pool.connect();
  let insertedId:string|undefined;
  try{
    await client.query('BEGIN');
    // Serialize the count+insert gate so concurrent API instances cannot overshoot
    // the configured outbound-email circuit breaker.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('link2ai:auth-email-rate-limit'))");
    const globalRecent=await client.query<{count:string}>(`SELECT COUNT(*)::text count FROM login_codes WHERE created_at > now() - interval '15 minutes'`);
    if(Number(globalRecent.rows[0]?.count??0)>=env().AUTH_EMAIL_GLOBAL_LIMIT_15M)throw new Link2AIError('AUTH_REQUIRED','Sign-in is temporarily busy. Try again later.',429);
    const recent = await client.query<{count:string}>(
      `SELECT COUNT(*)::text count FROM login_codes WHERE email=$1 AND created_at > now() - interval '15 minutes'`, [email]
    );
    if (Number(recent.rows[0]?.count ?? 0) >= 5) throw new Link2AIError('AUTH_REQUIRED', 'Too many sign-in codes requested. Try again later.', 429);
    const inserted=await client.query<{id:string}>(
      `INSERT INTO login_codes(email,code_hash,flow_hash,return_to,expires_at) VALUES($1,$2,$3,$4,now() + interval '10 minutes') RETURNING id`,
      [email, hashLoginCode(email, code), sha256(flowToken), returnTo]
    );
    insertedId=inserted.rows[0].id;
    await client.query('COMMIT');
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
  if (env().RESEND_API_KEY) {
    try{
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env().RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: env().AUTH_FROM_EMAIL, to: [email], subject: `Your ${env().PUBLIC_BRAND_NAME} sign-in code`, html: `<p>Your ${env().PUBLIC_BRAND_NAME} sign-in code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>` }),
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new Error(`Resend returned HTTP ${response.status}`);
    }catch{
      if(insertedId)await pool.query('DELETE FROM login_codes WHERE id=$1',[insertedId]).catch(()=>{});
      throw new Link2AIError('INTERNAL_ERROR', 'Could not send the sign-in email.', 502);
    }
  }
  return { ...(env().NODE_ENV !== 'production' && env().DEV_SHOW_LOGIN_CODE ? { devCode: code } : {}), flowToken };
}

export async function verifyEmailLogin(emailRaw: string, code: string, flowToken: string): Promise<{user:AuthUser; sessionToken:string; returnTo:string}> {
  const email = emailRaw.trim().toLowerCase();
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const r = await client.query<{id:string;code_hash:string;return_to:string;attempts:number}>(
      `SELECT id,code_hash,return_to,attempts FROM login_codes
       WHERE email=$1 AND flow_hash=$2 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [email, sha256(flowToken)]
    );
    if (!r.rowCount) throw new Link2AIError('AUTH_REQUIRED', 'That sign-in code is invalid or expired.', 401);
    if (!timingSafeEqualHex(r.rows[0].code_hash, hashLoginCode(email, code.trim()))) {
      const nextAttempts=Number(r.rows[0].attempts ?? 0)+1;
      await client.query(`UPDATE login_codes SET attempts=$2, consumed_at=CASE WHEN $2 >= 5 THEN now() ELSE consumed_at END WHERE id=$1`,[r.rows[0].id,nextAttempts]);
      await client.query('COMMIT');
      committed = true;
      throw new Link2AIError('AUTH_REQUIRED', 'That sign-in code is invalid or expired.', 401);
    }
    await client.query('UPDATE login_codes SET consumed_at=now() WHERE id=$1', [r.rows[0].id]);
    const u = await client.query<AuthUser & {account_status:string}>(
      `INSERT INTO users(email) VALUES($1)
       ON CONFLICT(email) DO UPDATE SET updated_at=now()
       RETURNING id,email,plan,account_status`, [email]
    );
    if(u.rows[0].account_status==='disabled')throw new Link2AIError('AUTH_REQUIRED','This account is disabled.',403);
    const token = randomToken(32);
    await client.query(
      `INSERT INTO web_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now() + interval '30 days')`,
      [u.rows[0].id, sha256(token)]
    );
    await client.query('COMMIT');
    committed = true;
    return { user: u.rows[0], sessionToken: token, returnTo: r.rows[0].return_to };
  } catch (err) {
    if (!committed) await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}

export function parseCookies(header?: string): Record<string,string> {
  if (!header) return {};
  const entries:Array<[string,string]>=[];
  for(const raw of header.split(';')){
    const i=raw.indexOf('=');
    const key=(i<0?raw:raw.slice(0,i)).trim();
    if(!key)continue;
    const encoded=i<0?'':raw.slice(i+1).trim();
    let value=encoded;
    try{value=decodeURIComponent(encoded);}catch{/* Ignore malformed percent encoding; treat it as a non-matching opaque cookie. */}
    entries.push([key,value]);
  }
  return Object.fromEntries(entries);
}

export function csrfTokenFromSessionCookie(cookieHeader?:string):string|null{
  const token=parseCookies(cookieHeader)[SESSION_COOKIE];
  return token?hmacSha256(env().APP_SECRET,`csrf:${token}`):null;
}

export function verifyCsrfToken(cookieHeader:string|undefined,provided:string|undefined):boolean{
  if(!provided)return false;
  const expected=csrfTokenFromSessionCookie(cookieHeader);
  return Boolean(expected&&timingSafeEqualHex(expected,provided));
}

export async function userFromSessionCookie(cookieHeader?: string): Promise<AuthUser | null> {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return null;
  const r = await pool.query<AuthUser>(
    `SELECT u.id,u.email,u.plan FROM web_sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at > now() AND u.account_status <> 'disabled'`, [sha256(token)]
  );
  return r.rows[0] ?? null;
}

export async function userFromBearer(authorization?: string): Promise<AuthUser | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice(7).trim();
  if (!token) return null;
  const r = await pool.query<AuthUser>(
    `SELECT u.id,u.email,u.plan FROM oauth_access_tokens t JOIN users u ON u.id=t.user_id
     WHERE t.token_hash=$1 AND t.resource=$2 AND t.revoked_at IS NULL AND t.expires_at > now()
       AND u.account_status <> 'disabled'`, [sha256(token),mcpResource()]
  );
  return r.rows[0] ?? null;
}

export async function getOAuthClient(clientId:string,redirectUri:string):Promise<ResolvedOAuthClient|null>{
  if(clientId.startsWith('https://')){
    const client=await fetchCimdOAuthClient(clientId);
    return client.redirect_uris.includes(redirectUri)?client:null;
  }
  const r=await pool.query<{client_id:string;client_name:string;redirect_uris:string[]}>(
    `SELECT client_id,client_name,redirect_uris FROM oauth_clients WHERE client_id=$1`,[clientId]
  );
  if(!r.rowCount||!(r.rows[0].redirect_uris as unknown as string[]).includes(redirectUri))return null;
  return {...r.rows[0],source:'dcr'};
}

export async function validateOAuthClient(clientId: string, redirectUri: string): Promise<boolean> {
  return Boolean(await getOAuthClient(clientId,redirectUri));
}

export async function registerOAuthClient(name: string, redirectUris: string[]): Promise<{client_id:string;client_name:string;redirect_uris:string[]}> {
  const safeRedirectUris=validateOAuthRedirectUris(redirectUris);
  const clientName=name.trim()||'MCP Client';
  if(clientName.length>120)throw new Link2AIError('AUTH_REQUIRED','OAuth client_name is too long.',400);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('link2ai:dcr-rate-limit'))");
    const recent=await client.query<{count:string}>(`SELECT COUNT(*)::text count FROM oauth_clients WHERE created_at > now() - interval '1 hour'`);
    if(Number(recent.rows[0]?.count??0)>=env().OAUTH_DCR_GLOBAL_LIMIT_HOUR)throw new Link2AIError('AUTH_REQUIRED','OAuth registration is temporarily busy. Try again later.',429);
    const clientId = `l2a_${randomToken(18)}`;
    const r = await client.query<{client_id:string;client_name:string;redirect_uris:string[]}>(
      `INSERT INTO oauth_clients(client_id,client_name,redirect_uris) VALUES($1,$2,$3::jsonb) RETURNING client_id,client_name,redirect_uris`,
      [clientId, clientName, JSON.stringify(safeRedirectUris)]
    );
    await client.query('COMMIT');
    return r.rows[0];
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
}

export async function revokeOAuthToken(input:{token:string;clientId?:string}):Promise<void>{
  const tokenHash=sha256(input.token.trim());
  if(!input.token.trim())return;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const access=await client.query<{id:string;client_id:string}>(
      `SELECT id,client_id FROM oauth_access_tokens WHERE token_hash=$1 FOR UPDATE`,[tokenHash]
    );
    if(access.rowCount){
      if(input.clientId&&access.rows[0].client_id!==input.clientId){await client.query('COMMIT');return;}
      await client.query('UPDATE oauth_access_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1',[access.rows[0].id]);
      await client.query('COMMIT');return;
    }
    const refresh=await client.query<{id:string;client_id:string}>(
      `SELECT id,client_id FROM oauth_refresh_tokens WHERE token_hash=$1 FOR UPDATE`,[tokenHash]
    );
    if(refresh.rowCount&&(!input.clientId||refresh.rows[0].client_id===input.clientId)){
      await client.query('UPDATE oauth_refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1',[refresh.rows[0].id]);
    }
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function createAuthorizationCode(input: {userId:string;clientId:string;redirectUri:string;codeChallenge:string;scope?:string;resource?:string}): Promise<string> {
  const code = randomToken(32);
  const resource=normalizeResource(input.resource), scope=normalizeScope(input.scope);
  await pool.query(
    `INSERT INTO oauth_codes(code_hash,user_id,client_id,redirect_uri,code_challenge,resource,scope,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,now() + interval '5 minutes')`,
    [sha256(code), input.userId, input.clientId, input.redirectUri, input.codeChallenge, resource, scope]
  );
  return code;
}

export async function exchangeAuthorizationCode(input: {code:string;clientId:string;redirectUri:string;codeVerifier:string;resource?:string}): Promise<{access_token:string;refresh_token?:string;expires_in:number;scope:string}> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<{id:string;user_id:string;client_id:string;redirect_uri:string;code_challenge:string;resource:string;scope:string}>(
      `SELECT id,user_id,client_id,redirect_uri,code_challenge,resource,scope FROM oauth_codes
       WHERE code_hash=$1 AND consumed_at IS NULL AND expires_at > now() FOR UPDATE`, [sha256(input.code)]
    );
    if (!r.rowCount) throw new Link2AIError('AUTH_REQUIRED','Authorization code is invalid or expired.',401);
    const row = r.rows[0];
    const requestedResource=normalizeResource(input.resource);
    if (row.client_id !== input.clientId || row.redirect_uri !== input.redirectUri || pkceS256(input.codeVerifier) !== row.code_challenge || row.resource !== requestedResource) {
      throw new Link2AIError('AUTH_REQUIRED','OAuth code verification failed.',401);
    }
    await client.query('UPDATE oauth_codes SET consumed_at=now() WHERE id=$1',[row.id]);
    const access = randomToken(32);
    await client.query(
      `INSERT INTO oauth_access_tokens(user_id,client_id,token_hash,resource,scope,expires_at) VALUES($1,$2,$3,$4,$5,now() + interval '1 hour')`,
      [row.user_id,row.client_id,sha256(access),row.resource,row.scope]
    );
    let refresh:string|undefined;
    if(row.scope.split(/\s+/).includes('offline_access')){
      refresh=randomToken(40);
      await client.query(
        `INSERT INTO oauth_refresh_tokens(user_id,client_id,token_hash,resource,scope,expires_at) VALUES($1,$2,$3,$4,$5,now() + interval '90 days')`,
        [row.user_id,row.client_id,sha256(refresh),row.resource,row.scope]
      );
    }
    await client.query('COMMIT');
    return { access_token: access, ...(refresh?{refresh_token:refresh}:{}), expires_in: 3600, scope: row.scope };
  } catch(err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}

export async function exchangeRefreshToken(input:{refreshToken:string;clientId:string;resource?:string}): Promise<{access_token:string;refresh_token:string;expires_in:number;scope:string}> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<{id:string;user_id:string;client_id:string;resource:string;scope:string}>(
      `SELECT id,user_id,client_id,resource,scope FROM oauth_refresh_tokens
       WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`, [sha256(input.refreshToken)]
    );
    if (!r.rowCount || r.rows[0].client_id !== input.clientId) throw new Link2AIError('AUTH_REQUIRED','Refresh token is invalid.',401);
    const row = r.rows[0];
    if (row.resource !== normalizeResource(input.resource)) throw new Link2AIError('AUTH_REQUIRED','Refresh token resource mismatch.',401);
    await client.query('UPDATE oauth_refresh_tokens SET revoked_at=now() WHERE id=$1',[row.id]);
    const access = randomToken(32), refresh = randomToken(40);
    await client.query(`INSERT INTO oauth_access_tokens(user_id,client_id,token_hash,resource,scope,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 hour')`,[row.user_id,row.client_id,sha256(access),row.resource,row.scope]);
    await client.query(`INSERT INTO oauth_refresh_tokens(user_id,client_id,token_hash,resource,scope,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '90 days')`,[row.user_id,row.client_id,sha256(refresh),row.resource,row.scope]);
    await client.query('COMMIT');
    return {access_token:access,refresh_token:refresh,expires_in:3600,scope:row.scope};
  } catch(err){ await client.query('ROLLBACK'); throw err; }
  finally{ client.release(); }
}

export type Link2AIAuthInfo = AuthInfo & { extra: { userId:string } };

export async function authInfoFromBearer(authorization?: string): Promise<Link2AIAuthInfo | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice(7).trim();
  if (!token) return null;
  const r = await pool.query<{user_id:string;client_id:string;scope:string;expires_at:Date}>(
    `SELECT t.user_id,t.client_id,t.scope,t.expires_at
     FROM oauth_access_tokens t JOIN users u ON u.id=t.user_id
     WHERE t.token_hash=$1 AND t.resource=$2 AND t.revoked_at IS NULL AND t.expires_at > now()
       AND u.account_status <> 'disabled'`, [sha256(token),mcpResource()]
  );
  if (!r.rowCount) return null;
  const row=r.rows[0];
  const scopes=row.scope.split(/\s+/).filter(Boolean);
  if(!scopes.includes('link2ai:read'))return null;
  return {
    token,
    clientId:row.client_id,
    scopes,
    expiresAt:Math.floor(new Date(row.expires_at).getTime()/1000),
    resource:new URL(mcpResource()),
    extra:{userId:row.user_id}
  };
}
