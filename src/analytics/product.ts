import { pool } from '../db/pool.js';

export type ActivationEventName=
  | 'connect_cta_click'
  | 'connection_started'
  | 'connection_success'
  | 'connector_enabled'
  | 'first_link_attempt'
  | 'first_successful_read';

function cleanText(value:unknown,max=160):string|null{
  const text=String(value??'').trim();
  return text?text.slice(0,max):null;
}

export async function recordActivationEvent(
  userId:string,
  eventName:ActivationEventName,
  input:{platform?:string|null;distributionProfile?:string|null;metadata?:Record<string,unknown>}={}
):Promise<void>{
  if(!userId)return;
  const metadata:Record<string,string|number|boolean|null>={};
  for(const [key,value] of Object.entries(input.metadata??{}).slice(0,12)){
    if(!/^[a-z0-9_]{1,48}$/i.test(key))continue;
    if(typeof value==='string')metadata[key]=value.slice(0,160);
    else if(typeof value==='number'&&Number.isFinite(value))metadata[key]=value;
    else if(typeof value==='boolean'||value===null)metadata[key]=value;
  }
  try{
    await pool.query(
      `INSERT INTO product_activation_events(user_id,event_name,platform,distribution_profile,metadata)
       VALUES($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        userId,
        eventName,
        cleanText(input.platform,48),
        cleanText(input.distributionProfile,48),
        JSON.stringify(metadata)
      ]
    );
  }catch{
    // Product analytics must never block auth, MCP, or source processing.
  }
}
