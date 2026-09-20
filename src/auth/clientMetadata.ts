import { Link2AIError } from '../util/errors.js';
import { safeGetBuffer } from '../util/safeHttp.js';

export interface ResolvedOAuthClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  source: 'dcr'|'cimd';
}

export function validateOAuthRedirectUris(redirectUris: string[]): string[] {
  if (!redirectUris.length || redirectUris.length > 10) {
    throw new Link2AIError('AUTH_REQUIRED','At least one redirect URI is required.',400);
  }
  const unique=[...new Set(redirectUris)];
  if(unique.length!==redirectUris.length)throw new Link2AIError('AUTH_REQUIRED','OAuth redirect URIs must be unique.',400);
  for (const raw of unique) {
    if(raw.length>2048)throw new Link2AIError('AUTH_REQUIRED','OAuth redirect URI is too long.',400);
    let url: URL;
    try { url = new URL(raw); } catch { throw new Link2AIError('AUTH_REQUIRED','Invalid OAuth redirect URI.',400); }
    const localhost = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(localhost && url.protocol === 'http:')) {
      throw new Link2AIError('AUTH_REQUIRED','OAuth redirect URIs must use HTTPS (localhost may use HTTP).',400);
    }
    if (url.username || url.password || url.hash) throw new Link2AIError('AUTH_REQUIRED','Invalid OAuth redirect URI.',400);
  }
  return unique;
}

export function normalizeCimdClientId(raw:string):string {
  if(raw.length>2048)throw new Link2AIError('AUTH_REQUIRED','Invalid Client ID Metadata Document URL.',400);
  let url:URL;
  try{url=new URL(raw);}catch{throw new Link2AIError('AUTH_REQUIRED','Invalid OAuth client ID.',400);}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search||url.pathname==='/'){
    throw new Link2AIError('AUTH_REQUIRED','Invalid Client ID Metadata Document URL.',400);
  }
  // Stable client identifiers should not rely on URL parser normalization.
  if(url.toString()!==raw)throw new Link2AIError('AUTH_REQUIRED','Client ID Metadata Document URL must be canonical HTTPS.',400);
  return raw;
}

export function parseCimdDocument(clientId:string,input:unknown):ResolvedOAuthClient {
  const id=normalizeCimdClientId(clientId);
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Link2AIError('AUTH_REQUIRED','Client metadata document is invalid.',400);
  const b=input as Record<string,unknown>;
  if(String(b.client_id??'')!==id)throw new Link2AIError('AUTH_REQUIRED','Client metadata client_id does not match its document URL.',400);
  const name=String(b.client_name??'').trim();
  if(!name||name.length>120)throw new Link2AIError('AUTH_REQUIRED','Client metadata must include a valid client_name.',400);
  if(!Array.isArray(b.redirect_uris)||b.redirect_uris.some(v=>typeof v!=='string'))throw new Link2AIError('AUTH_REQUIRED','Client metadata must include redirect_uris.',400);
  const redirectUris=validateOAuthRedirectUris((b.redirect_uris as string[]));
  if(b.response_types!==undefined&&(!Array.isArray(b.response_types)||!b.response_types.includes('code'))){
    throw new Link2AIError('AUTH_REQUIRED','Client metadata must support the code response type.',400);
  }
  if(b.grant_types!==undefined&&(!Array.isArray(b.grant_types)||!b.grant_types.includes('authorization_code'))){
    throw new Link2AIError('AUTH_REQUIRED','Client metadata must support the authorization_code grant.',400);
  }
  if(b.token_endpoint_auth_method!==undefined&&b.token_endpoint_auth_method!=='none'){
    throw new Link2AIError('AUTH_REQUIRED','LTA only supports public OAuth clients with token_endpoint_auth_method=none.',400);
  }
  if(b.application_type!==undefined&&!['web','native'].includes(String(b.application_type))){
    throw new Link2AIError('AUTH_REQUIRED','Unsupported OAuth application_type.',400);
  }
  return {client_id:id,client_name:name,redirect_uris:redirectUris,source:'cimd'};
}

export async function fetchCimdOAuthClient(clientId:string):Promise<ResolvedOAuthClient>{
  const id=normalizeCimdClientId(clientId);
  let response;
  try{
    response=await safeGetBuffer(id,{maxBytes:64*1024,timeoutMs:7_500,maxRedirects:3});
  }catch(error){
    throw new Link2AIError('AUTH_REQUIRED','Client ID Metadata Document could not be loaded safely.',400,false,{cause:error instanceof Error?error.name:'fetch_failed'});
  }
  const contentType=(response.contentType??'').split(';',1)[0].trim().toLowerCase();
  if(contentType&&contentType!=='application/json'&&!contentType.endsWith('+json')){
    throw new Link2AIError('AUTH_REQUIRED','Client ID Metadata Document must be JSON.',400);
  }
  let parsed:unknown;
  try{parsed=JSON.parse(response.bytes.toString('utf8'));}catch{throw new Link2AIError('AUTH_REQUIRED','Client ID Metadata Document is not valid JSON.',400);}
  return parseCimdDocument(id,parsed);
}
