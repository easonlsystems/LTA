import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { pool } from '../db/pool.js';
import { getJobResult, startTranscriptJob, usageForTool, type ToolJobResult } from '../mcp/service.js';
import { supportedSourcesForProfile } from '../mcp/policy.js';
import { asLink2AIError } from '../util/errors.js';

const API_KEY_PREFIX='l2ai_live_';

function sha256(value:string):string{
  return crypto.createHash('sha256').update(value).digest('hex');
}

function cleanName(value:unknown):string{
  const name=String(value??'').trim().replace(/\s+/g,' ');
  return (name||'Default').slice(0,60);
}

export interface PublicApiKeyRow{
  id:string;
  name:string;
  key_prefix:string;
  created_at:Date;
  last_used_at:Date|null;
  revoked_at:Date|null;
}

export async function createPublicApiKey(userId:string,nameRaw:unknown):Promise<{id:string;name:string;key:string;key_prefix:string}>{
  const name=cleanName(nameRaw);
  for(let attempt=0;attempt<3;attempt++){
    const secret=crypto.randomBytes(32).toString('base64url');
    const key=`${API_KEY_PREFIX}${secret}`;
    const keyPrefix=`${API_KEY_PREFIX}${secret.slice(0,8)}`;
    try{
      const r=await pool.query<{id:string}>(`INSERT INTO api_keys(user_id,name,key_prefix,key_hash) VALUES($1,$2,$3,$4) RETURNING id`,[userId,name,keyPrefix,sha256(key)]);
      return {id:r.rows[0].id,name,key,key_prefix:keyPrefix};
    }catch(error){
      if(attempt===2)throw error;
    }
  }
  throw new Error('Could not create API key');
}

export async function listPublicApiKeys(userId:string):Promise<PublicApiKeyRow[]>{
  const r=await pool.query<PublicApiKeyRow>(`SELECT id,name,key_prefix,created_at,last_used_at,revoked_at FROM api_keys WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,[userId]);
  return r.rows;
}

export async function revokePublicApiKey(userId:string,keyId:string):Promise<boolean>{
  const r=await pool.query(`UPDATE api_keys SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`,[keyId,userId]);
  return Boolean(r.rowCount);
}

async function userFromApiKey(authorization:unknown):Promise<{userId:string;keyId:string}|null>{
  const raw=String(authorization??'');
  const m=raw.match(/^Bearer\s+(l2ai_live_[A-Za-z0-9_-]{20,})$/i);
  if(!m)return null;
  const r=await pool.query<{id:string;user_id:string;account_status:string}>(`
    SELECT k.id,k.user_id,u.account_status
    FROM api_keys k JOIN users u ON u.id=k.user_id
    WHERE k.key_hash=$1 AND k.revoked_at IS NULL
    LIMIT 1`,[sha256(m[1])]);
  if(!r.rowCount||r.rows[0].account_status==='disabled')return null;
  await pool.query('UPDATE api_keys SET last_used_at=now() WHERE id=$1',[r.rows[0].id]).catch(()=>{});
  return {userId:r.rows[0].user_id,keyId:r.rows[0].id};
}

function apiPayload(result:ToolJobResult){
  const completeness=result.status==='completed'?(result.truncated?'partial':'complete'):undefined;
  return {
    id:result.job_id,
    status:result.status,
    source_type:result.platform,
    source_url:result.source_url,
    canonical_url:result.canonical_url,
    source_key:result.source_key,
    title:result.title??undefined,
    creator:result.creator??undefined,
    content:result.transcript,
    transcript:result.transcript,
    metadata:result.status==='completed'?{
      caption:result.caption??null,
      duration_seconds:result.duration_seconds??null,
      language:result.language??null,
      transcript_source:result.transcript_source??null,
      source_fetched_at:result.source_fetched_at??null,
      cache_expires_at:result.cache_expires_at??null,
      items_available:result.items_available??null,
      items_extracted:result.items_extracted??null,
      pages_available:result.pages_available??null,
      pages_extracted:result.pages_extracted??null
    }:undefined,
    evidence:result.status==='completed'?(result.segments??[]).slice(0,250):undefined,
    source_completeness:completeness,
    truncation_reason:result.truncation_reason??undefined,
    content_sections_truncated:result.content_sections_truncated??undefined,
    units_used:result.status==='completed'?result.usage_units??0:0,
    remaining_usage_units:result.remaining_usage_units,
    error_code:result.error_code??undefined,
    message:result.message,
    retry_after_seconds:result.retry_after_seconds,
    retryable:result.retryable
  };
}

function sendResult(reply:FastifyReply,result:ToolJobResult){
  if(result.status==='processing')return reply.code(202).send(apiPayload(result));
  if(result.status==='payment_required')return reply.code(402).send(apiPayload(result));
  if(result.status==='failed')return reply.code(422).send(apiPayload(result));
  return reply.code(200).send(apiPayload(result));
}

async function requireApiKey(req:FastifyRequest,reply:FastifyReply){
  const auth=await userFromApiKey(req.headers.authorization);
  if(auth)return auth;
  reply.header('WWW-Authenticate','Bearer');
  reply.code(401).send({error:'unauthorized',message:'Use a valid Link2AI API key.'});
  return null;
}

async function recordApiRequest(userId:string,keyId:string,route:string,jobId?:string){
  await pool.query(`INSERT INTO api_request_events(user_id,api_key_id,job_id,route) VALUES($1,$2,$3,$4)`,[userId,keyId,jobId??null,route]).catch(()=>{});
}

export async function registerPublicApiRoutes(app:FastifyInstance):Promise<void>{
  app.post('/v1/read',async(req,reply)=>{
    const auth=await requireApiKey(req,reply); if(!auth)return;
    const body=(req.body??{}) as {url?:unknown;refresh?:unknown};
    const url=String(body.url??'').trim();
    if(!url)return reply.code(400).send({error:'invalid_request',message:'url is required.'});
    try{
      const result=await startTranscriptJob(auth.userId,url,{refresh:body.refresh===true,profile:'default'});
      await recordApiRequest(auth.userId,auth.keyId,'POST /v1/read',result.job_id);
      return sendResult(reply,result);
    }catch(error){
      const err=asLink2AIError(error);
      return reply.code(err.status??400).send({error:err.code,message:err.message,retryable:Boolean(err.retryable)});
    }
  });

  app.get('/v1/jobs/:jobId',async(req,reply)=>{
    const auth=await requireApiKey(req,reply); if(!auth)return;
    const jobId=String((req.params as {jobId?:unknown}).jobId??'');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId))return reply.code(400).send({error:'invalid_request',message:'jobId must be a UUID.'});
    try{
      const result=await getJobResult(auth.userId,jobId,'default');
      await recordApiRequest(auth.userId,auth.keyId,'GET /v1/jobs/:jobId',result.job_id);
      return sendResult(reply,result);
    }catch(error){
      const err=asLink2AIError(error);
      return reply.code(err.status??404).send({error:err.code,message:err.message,retryable:Boolean(err.retryable)});
    }
  });

  app.get('/v1/usage',async(req,reply)=>{
    const auth=await requireApiKey(req,reply); if(!auth)return;
    await recordApiRequest(auth.userId,auth.keyId,'GET /v1/usage');
    return reply.send(await usageForTool(auth.userId,'default'));
  });

  app.get('/v1/sources',async(req,reply)=>{
    const auth=await requireApiKey(req,reply); if(!auth)return;
    await recordApiRequest(auth.userId,auth.keyId,'GET /v1/sources');
    return reply.send({sources:supportedSourcesForProfile('default')});
  });
}
