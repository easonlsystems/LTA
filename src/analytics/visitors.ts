import { randomUUID } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { userFromSessionCookie } from '../auth/service.js';

const COOKIE_NAME='link2ai_visitor';
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOT_RE=/(bot|crawler|spider|slurp|preview|facebookexternalhit|discordbot|whatsapp|telegrambot|curl|wget|uptimerobot|railway)/i;

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

function visitorCookie(token:string):string{
  const secure=env().NODE_ENV==='production'?'; Secure':'';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`;
}

function tokenFromCookie(header:string|undefined):string|null{
  const token=cookies(header)[COOKIE_NAME];
  return token&&UUID_RE.test(token)?token:null;
}

export async function trackWebsiteVisit(req:{headers:{cookie?:string;'user-agent'?:string|string[]}},reply:FastifyReply,path:string):Promise<void>{
  const ua=Array.isArray(req.headers['user-agent'])?req.headers['user-agent'][0]:req.headers['user-agent'];
  if(BOT_RE.test(String(ua??'')))return;
  const existing=tokenFromCookie(req.headers.cookie);
  const token=existing??randomUUID();
  if(!existing)reply.header('Set-Cookie',visitorCookie(token));
  const page=cleanPath(path);
  try{
    const user=await userFromSessionCookie(req.headers.cookie).catch(()=>null);
    await pool.query(
      `INSERT INTO website_visitors(visitor_id,user_id,first_path,last_path,page_views)
       VALUES($1,$2,$3,$3,1)
       ON CONFLICT(visitor_id) DO UPDATE SET
         user_id=COALESCE(EXCLUDED.user_id,website_visitors.user_id),
         last_path=EXCLUDED.last_path,last_seen_at=now(),page_views=website_visitors.page_views+1`,
      [token,user?.id??null,page]
    );
    await pool.query(`INSERT INTO website_pageviews(visitor_id,path) VALUES($1,$2)`,[token,page]);
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
  }catch{
    // Account/login flow must remain usable even if analytics storage fails.
  }
}
