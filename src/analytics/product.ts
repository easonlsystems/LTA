import { pool } from '../db/pool.js';

export type ActivationEventName=
  | 'connect_cta_click'
  | 'connection_started'
  | 'connection_success'
  | 'connector_enabled'
  | 'first_link_attempt'
  | 'first_successful_read'
  | 'add_lta_click'
  | 'oauth_start'
  | 'oauth_success'
  | 'oauth_fail'
  | 'connector_connected'
  | 'read_requested'
  | 'first_read_success'
  | 'second_read_success'
  | 'quota_low'
  | 'quota_exceeded'
  | 'topup_click'
  | 'topup_success';

function cleanText(value:unknown,max=160):string|null{
  const text=String(value??'').trim();
  return text?text.slice(0,max):null;
}

async function latestAttribution(userId:string):Promise<{
  visitor_id:string|null;
  utm_source:string|null;
  utm_campaign:string|null;
  utm_content:string|null;
}>{
  const r=await pool.query<{
    visitor_id:string;
    utm_source:string|null;
    utm_campaign:string|null;
    utm_content:string|null;
  }>(
    `SELECT visitor_id,utm_source,utm_campaign,utm_content
     FROM website_visitors
     WHERE user_id=$1
     ORDER BY last_seen_at DESC
     LIMIT 1`,
    [userId]
  );
  return {
    visitor_id:r.rows[0]?.visitor_id??null,
    utm_source:cleanText(r.rows[0]?.utm_source,100),
    utm_campaign:cleanText(r.rows[0]?.utm_campaign,160),
    utm_content:cleanText(r.rows[0]?.utm_content,160)
  };
}

export async function recordActivationEvent(
  userId:string,
  eventName:ActivationEventName,
  input:{platform?:string|null;distributionProfile?:string|null;metadata?:Record<string,unknown>}={}
):Promise<void>{
  if(!userId)return;
  const metadata:Record<string,string|number|boolean|null>={};
  for(const [key,value] of Object.entries(input.metadata??{}).slice(0,16)){
    if(!/^[a-z0-9_]{1,48}$/i.test(key))continue;
    if(typeof value==='string')metadata[key]=value.slice(0,160);
    else if(typeof value==='number'&&Number.isFinite(value))metadata[key]=value;
    else if(typeof value==='boolean'||value===null)metadata[key]=value;
  }
  try{
    const attribution=await latestAttribution(userId);
    await pool.query(
      `INSERT INTO product_activation_events(
         user_id,event_name,platform,distribution_profile,metadata,
         visitor_id,utm_source,utm_campaign,utm_content
       )
       VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
       ON CONFLICT DO NOTHING`,
      [
        userId,
        eventName,
        cleanText(input.platform,48),
        cleanText(input.distributionProfile,48),
        JSON.stringify(metadata),
        attribution.visitor_id,
        attribution.utm_source,
        attribution.utm_campaign,
        attribution.utm_content
      ]
    );
  }catch{
    // Product analytics must never block auth, MCP, billing, or source processing.
  }
}
