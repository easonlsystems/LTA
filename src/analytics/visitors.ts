import { randomUUID } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { userFromSessionCookie } from '../auth/service.js';

const COOKIE_NAME='link2ai_visitor';
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOT_RE=/(bot|crawler|spider|slurp|preview|facebookexternalhit|discordbot|whatsapp|telegrambot|curl|wget|uptimerobot|railway)/i;
const EVENT_RE=/^[a-z0-9_]{2,64}$/;

function cookies(header:string|undefined):Record<string,string>{
  const out:Record<string,string>={};
  for(const part of String(header??'').split(';')){
    const i=part.indexOf('=');
    if(i<1)continue;
    const key=part.slice(0,i).trim();
    if(!key)continue;
    try{out[key]=decodeURIComponent(part.slice(i+1).trim());}catch{out[key]=part.slice(i+1).trim();}
  }
  return out;
}

function cleanPath(path:string):string{
  const raw=String(path||'/').split('?')[0].slice(0,160);
  return raw.startsWith('/')?raw:`/${raw}`;
}

function cleanText(value:unknown,max=240):string|null{
  const text=String(value??'').trim();
  return text?text.slice(0,max):null;
}

function visitorCookie(token:string):string{
  const secure=env().NODE_ENV==='production'?'; Secure':'';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`;
}

function tokenFromCookie(header:string|undefined):string|null{
  const token=cookies(header)[COOKIE_NAME];
  return token&&UUID_RE.test(token)?token:null;
}

function sourceFromRequest(req:{url?:string;headers:{referer?:string|string[]}}):{referrer:string|null;utmSource:string|null;utmMedium:string|null;utmCampaign:string|null;utmContent:string|null}{
  const refererRaw=Array.isArray(req.headers.referer)?req.headers.referer[0]:req.headers.referer;
  let referrer:string|null=null;
  try{
    const refHost=refererRaw?new URL(refererRaw).hostname.toLowerCase():'';
    const ownHost=new URL(env().PUBLIC_BASE_URL).hostname.toLowerCase();
    referrer=refHost&&refHost!==ownHost?refHost.slice(0,255):null;
  }catch{referrer=null;}
  let utmSource:string|null=null,utmMedium:string|null=null,utmCampaign:string|null=null,utmContent:string|null=null;
  try{
    const url=new URL(String(req.url??'/'),'https://link2ai.local');
    utmSource=cleanText(url.searchParams.get('utm_source'),100);
    utmMedium=cleanText(url.searchParams.get('utm_medium'),100);
    utmCampaign=cleanText(url.searchParams.get('utm_campaign'),160);
    utmContent=cleanText(url.searchParams.get('utm_content'),160);
  }catch{/* ignore malformed request URL */}
  return {referrer,utmSource,utmMedium,utmCampaign,utmContent};
}

export async function trackWebsiteVisit(req:{url?:string;headers:{cookie?:string;'user-agent'?:string|string[];referer?:string|string[]}},reply:FastifyReply,path:string):Promise<void>{
  const ua=Array.isArray(req.headers['user-agent'])?req.headers['user-agent'][0]:req.headers['user-agent'];
  if(BOT_RE.test(String(ua??'')))return;
  const existing=tokenFromCookie(req.headers.cookie);
  const token=existing??randomUUID();
  if(!existing)reply.header('Set-Cookie',visitorCookie(token));
  const page=cleanPath(path);
  const source=sourceFromRequest(req);
  try{
    const user=await userFromSessionCookie(req.headers.cookie).catch(()=>null);
    await pool.query(
      `INSERT INTO website_visitors(visitor_id,user_id,first_path,last_path,page_views,first_referrer,utm_source,utm_medium,utm_campaign,utm_content)
       VALUES($1,$2,$3,$3,1,$4,$5,$6,$7,$8)
       ON CONFLICT(visitor_id) DO UPDATE SET
         user_id=COALESCE(EXCLUDED.user_id,website_visitors.user_id),
         last_path=EXCLUDED.last_path,last_seen_at=now(),page_views=website_visitors.page_views+1,
         first_referrer=COALESCE(website_visitors.first_referrer,EXCLUDED.first_referrer),
         utm_source=COALESCE(EXCLUDED.utm_source,website_visitors.utm_source),
         utm_medium=COALESCE(EXCLUDED.utm_medium,website_visitors.utm_medium),
         utm_campaign=COALESCE(EXCLUDED.utm_campaign,website_visitors.utm_campaign),
         utm_content=COALESCE(EXCLUDED.utm_content,website_visitors.utm_content)`,
      [token,user?.id??null,page,source.referrer,source.utmSource,source.utmMedium,source.utmCampaign,source.utmContent]
    );
    await pool.query(`INSERT INTO website_pageviews(visitor_id,path) VALUES($1,$2)`,[token,page]);
  }catch{
    // Analytics must never block the product or public website.
  }
}

export async function trackWebsiteEvent(req:{headers:{cookie?:string;'user-agent'?:string|string[]}},eventName:string,path:string,metadata:Record<string,unknown>={}):Promise<void>{
  if(!EVENT_RE.test(eventName))return;
  const ua=Array.isArray(req.headers['user-agent'])?req.headers['user-agent'][0]:req.headers['user-agent'];
  if(BOT_RE.test(String(ua??'')))return;
  const token=tokenFromCookie(req.headers.cookie);
  if(!token)return;
  const safeMetadata:Record<string,string|number|boolean|null>={};
  for(const [key,value] of Object.entries(metadata).slice(0,12)){
    if(!/^[a-z0-9_]{1,48}$/i.test(key))continue;
    if(typeof value==='string')safeMetadata[key]=value.slice(0,160);
    else if(typeof value==='number'&&Number.isFinite(value))safeMetadata[key]=value;
    else if(typeof value==='boolean'||value===null)safeMetadata[key]=value;
  }
  try{
    const user=await userFromSessionCookie(req.headers.cookie).catch(()=>null);
    await pool.query(
      `INSERT INTO website_events(visitor_id,user_id,event_name,path,metadata) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING`,
      [token,user?.id??null,eventName,cleanPath(path),JSON.stringify(safeMetadata)]
    );
  }catch{
    // Analytics must never block the product or public website.
  }
}

export async function linkWebsiteVisitorToUser(cookieHeader:string|undefined,userId:string,signedUp:boolean):Promise<void>{
  const token=tokenFromCookie(cookieHeader);
  if(!token)return;
  try{
    await pool.query(
      `UPDATE website_visitors SET user_id=$2,last_seen_at=now(),signed_up_at=CASE WHEN $3::boolean THEN COALESCE(signed_up_at,now()) ELSE signed_up_at END WHERE visitor_id=$1`,
      [token,userId,signedUp]
    );
    await pool.query(
      `UPDATE website_events SET user_id=$2 WHERE visitor_id=$1 AND user_id IS NULL`,
      [token,userId]
    );
  }catch{
    // Account/login flow must remain usable even if analytics storage fails.
  }
}
