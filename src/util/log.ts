import { asLink2AIError } from './errors.js';

const SENSITIVE_LOG_KEY=/(?:^|_)(?:user_?id|client_?id|job_?id|email|authorization|token|secret|password|cookie|source_?url|normalized_?url|canonical_?media_?id|content_?text|transcript|caption|title|creator|prompt|query|body)(?:$|_)/i;

function sanitizeString(value:string):string{
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi,'Bearer [redacted]')
    .replace(/https?:\/\/\S+/gi,'[url]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]')
    .slice(0,160);
}

function sanitizeLogValue(value:unknown,depth=0):unknown{
  if(value===null||typeof value==='number'||typeof value==='boolean')return value;
  if(typeof value==='string')return sanitizeString(value);
  if(depth>=2)return '[omitted]';
  if(Array.isArray(value))return value.slice(0,12).map(item=>sanitizeLogValue(item,depth+1));
  if(typeof value==='object'){
    const out:Record<string,unknown>={};
    for(const [key,item] of Object.entries(value as Record<string,unknown>).slice(0,24)){
      if(SENSITIVE_LOG_KEY.test(key))continue;
      out[key]=sanitizeLogValue(item,depth+1);
    }
    return out;
  }
  return String(value).slice(0,80);
}

function sanitizeLogFields(fields:Record<string,unknown>):Record<string,unknown>{
  const out:Record<string,unknown>={};
  for(const [key,value] of Object.entries(fields).slice(0,40)){
    if(SENSITIVE_LOG_KEY.test(key))continue;
    out[key]=sanitizeLogValue(value);
  }
  return out;
}

export function logEvent(event:string,fields:Record<string,unknown>={}):void{
  console.log(JSON.stringify({ts:new Date().toISOString(),event,...sanitizeLogFields(fields)}));
}

export function logErrorEvent(event:string,error:unknown,fields:Record<string,unknown>={}):void{
  const err=error instanceof Error?error:null;
  const mapped=asLink2AIError(error);
  console.error(JSON.stringify({
    ts:new Date().toISOString(),
    event,
    ...sanitizeLogFields(fields),
    error_name:err?.name??'UnknownError',
    error_code:mapped.code,
    retryable:mapped.retryable
  }));
}
