import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateApiKey } from './apiKeys.js';
import { getJobResult, startTranscriptJob, usageForTool, type ToolJobResult } from '../source/service.js';
import { supportedSourcesForProfile } from '../source/policy.js';
import { asLink2AIError } from '../util/errors.js';

function publicPayload(result:ToolJobResult){
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
    evidence:result.status==='completed'?(result.segments??[]):undefined,
    source_completeness:result.status==='completed'?(result.truncated?'partial':'complete'):undefined,
    truncation_reason:result.truncation_reason??undefined,
    content_sections_truncated:result.content_sections_truncated??undefined,
    units_used:result.status==='completed'?result.usage_units??0:0,
    remaining_usage_units:result.remaining_usage_units,
    required_usage_units:result.required_usage_units,
    error_code:result.error_code??undefined,
    message:result.message,
    retry_after_seconds:result.retry_after_seconds,
    retryable:result.retryable
  };
}

function sendResult(reply:FastifyReply,result:ToolJobResult){
  if(result.status==='processing')return reply.code(202).send(publicPayload(result));
  if(result.status==='payment_required')return reply.code(402).send(publicPayload(result));
  if(result.status==='failed')return reply.code(422).send(publicPayload(result));
  return reply.code(200).send(publicPayload(result));
}

async function requireApiKey(req:FastifyRequest,reply:FastifyReply){
  const auth=await authenticateApiKey(req.headers.authorization);
  if(auth)return auth;
  reply.header('WWW-Authenticate','Bearer');
  reply.code(401).send({error:'unauthorized',message:'Use a valid Link2AI API key.'});
  return null;
}

export async function registerPublicApiRoutes(app:FastifyInstance):Promise<void>{
  app.post('/v1/read',async(req,reply)=>{
    const auth=await requireApiKey(req,reply); if(!auth)return;
    const body=(req.body??{}) as {url?:unknown;refresh?:unknown};
    const url=String(body.url??'').trim();
    if(!url)return reply.code(400).send({error:'invalid_request',message:'url is required.'});
    try{
      const result=await startTranscriptJob(auth.userId,url,{refresh:body.refresh===true,profile:'default'});
      return sendResult(reply,result);
    }catch(error){
      const err=asLink2AIError(error);
      return reply.code(err.status).send({error:err.code,message:err.message,retryable:err.retryable});
    }
  });

  app.get('/v1/jobs/:jobId',async(req,reply)=>{
    const auth=await requireApiKey(req,reply); if(!auth)return;
    const jobId=String((req.params as {jobId?:unknown}).jobId??'');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)){
      return reply.code(400).send({error:'invalid_request',message:'jobId must be a UUID.'});
    }
    try{
      return sendResult(reply,await getJobResult(auth.userId,jobId,'default'));
    }catch(error){
      const err=asLink2AIError(error);
      return reply.code(err.status).send({error:err.code,message:err.message,retryable:err.retryable});
    }
  });

  app.get('/v1/usage',async(req,reply)=>{
    const auth=await requireApiKey(req,reply); if(!auth)return;
    return reply.send(await usageForTool(auth.userId,'default'));
  });

  app.get('/v1/sources',async(req,reply)=>{
    const auth=await requireApiKey(req,reply); if(!auth)return;
    return reply.send({sources:supportedSourcesForProfile('default')});
  });
}
