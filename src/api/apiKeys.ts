import { pool } from '../db/pool.js';
import { randomToken, sha256 } from '../util/crypto.js';

const PREFIX='l2ai_live_';

export interface ApiKeySummary {
  id:string;
  name:string;
  key_prefix:string;
  created_at:Date;
  last_used_at:Date|null;
  revoked_at:Date|null;
}

export async function createApiKey(userId:string,nameRaw:unknown):Promise<{id:string;name:string;key:string;key_prefix:string}>{
  const name=String(nameRaw??'Default').trim().replace(/\s+/g,' ').slice(0,60)||'Default';
  for(let attempt=0;attempt<3;attempt++){
    const secret=randomToken(32);
    const key=`${PREFIX}${secret}`;
    const keyPrefix=`${PREFIX}${secret.slice(0,8)}`;
    try{
      const r=await pool.query<{id:string}>(
        `INSERT INTO api_keys(user_id,name,key_prefix,key_hash) VALUES($1,$2,$3,$4) RETURNING id`,
        [userId,name,keyPrefix,sha256(key)]
      );
      return {id:r.rows[0].id,name,key,key_prefix:keyPrefix};
    }catch(error){
      if(attempt===2)throw error;
    }
  }
  throw new Error('Could not create API key');
}

export async function listApiKeys(userId:string):Promise<ApiKeySummary[]>{
  const r=await pool.query<ApiKeySummary>(
    `SELECT id,name,key_prefix,created_at,last_used_at,revoked_at
     FROM api_keys WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 50`,
    [userId]
  );
  return r.rows;
}

export async function revokeApiKey(userId:string,keyId:string):Promise<boolean>{
  const r=await pool.query(
    `UPDATE api_keys SET revoked_at=COALESCE(revoked_at,now())
     WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`,
    [keyId,userId]
  );
  return Boolean(r.rowCount);
}

export async function authenticateApiKey(rawAuthorization:unknown):Promise<{userId:string;apiKeyId:string}|null>{
  const authorization=String(rawAuthorization??'');
  const match=authorization.match(/^Bearer\s+(l2ai_live_[A-Za-z0-9_-]{20,})$/i);
  if(!match)return null;
  const r=await pool.query<{id:string;user_id:string;account_status:string}>(
    `SELECT k.id,k.user_id,u.account_status
     FROM api_keys k
     JOIN users u ON u.id=k.user_id
     WHERE k.key_hash=$1 AND k.revoked_at IS NULL
     LIMIT 1`,
    [sha256(match[1])]
  );
  if(!r.rowCount||r.rows[0].account_status==='disabled')return null;
  await pool.query('UPDATE api_keys SET last_used_at=now() WHERE id=$1',[r.rows[0].id]).catch(()=>{});
  return {userId:r.rows[0].user_id,apiKeyId:r.rows[0].id};
}
