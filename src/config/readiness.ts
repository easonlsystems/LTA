import { env } from './env.js';

export type RuntimeRole='api'|'worker';

export function readinessIssues(role:RuntimeRole):string[]{
  const e=env();
  const issues:string[]=[];
  if(e.NODE_ENV==='production'){
    let base:URL|undefined;
    try{base=new URL(e.PUBLIC_BASE_URL);}catch{}
    if(!base||base.protocol!=='https:'||['localhost','127.0.0.1','::1'].includes(base.hostname)){
      issues.push('PUBLIC_BASE_URL must be a public HTTPS URL in production');
    }
    if(e.APP_SECRET.toLowerCase().includes('replace-with'))issues.push('APP_SECRET is still using the example value');
    if(e.MEDIA_PROVIDER_URL){
      try{if(new URL(e.MEDIA_PROVIDER_URL).protocol!=='https:')issues.push('MEDIA_PROVIDER_URL must use HTTPS in production');}
      catch{issues.push('MEDIA_PROVIDER_URL is invalid');}
    }
  }
  if(role==='api'){
    if(!e.RESEND_API_KEY)issues.push('RESEND_API_KEY is missing');
    if(!e.LEMONSQUEEZY_API_KEY)issues.push('LEMONSQUEEZY_API_KEY is missing');
    if(!e.LEMONSQUEEZY_WEBHOOK_SECRET)issues.push('LEMONSQUEEZY_WEBHOOK_SECRET is missing');
    if(!e.LEMONSQUEEZY_STORE_ID)issues.push('LEMONSQUEEZY_STORE_ID is missing');
    if(!e.LEMONSQUEEZY_BASIC_VARIANT_ID)issues.push('LEMONSQUEEZY_BASIC_VARIANT_ID is missing');
    if(!e.LEMONSQUEEZY_PRO_VARIANT_ID)issues.push('LEMONSQUEEZY_PRO_VARIANT_ID is missing');
    if(e.NODE_ENV==='production'&&e.AUTH_FROM_EMAIL.includes('example.com'))issues.push('AUTH_FROM_EMAIL is still using the example domain');
    if(e.NODE_ENV==='production'&&!e.SUPPORT_EMAIL)issues.push('SUPPORT_EMAIL is missing');
    if(Boolean(e.REVIEWER_EMAIL)!==Boolean(e.REVIEWER_PASSWORD))issues.push('REVIEWER_EMAIL and REVIEWER_PASSWORD must be configured together');
  }
  if(role==='worker'){
    if(!e.GROQ_API_KEY&&!e.OPENAI_API_KEY)issues.push('At least one speech-to-text provider key is required');
  }
  return issues;
}
