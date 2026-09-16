export function normalizePublicBaseUrl(raw:string):string{
  const url=new URL(raw);
  if(url.username||url.password||url.search||url.hash)throw new Error('PUBLIC_BASE_URL must be an origin URL without credentials, query or fragment.');
  if(url.pathname!=='/'&&url.pathname!=='')throw new Error('PUBLIC_BASE_URL must not contain a path.');
  return url.origin;
}

export function publicHostAllowlist(baseUrl:string,extraHosts:string[]=[]):string[]{
  const host=new URL(baseUrl).hostname;
  const normalized=extraHosts.flatMap(raw=>{
    const value=raw.trim().toLowerCase().replace(/\.$/,'');
    if(!value||value.includes('/')||value.includes(' '))return [];
    return [value];
  });
  return [...new Set([host,'healthcheck.railway.app',...normalized,'localhost','127.0.0.1','[::1]'])];
}


function firstHeader(value:string|string[]|undefined):string{
  return Array.isArray(value)?String(value[0]??''):String(value??'');
}

function originFromHostHeader(rawHost:string,protocol:'http:'|'https:'):string|null{
  const host=rawHost.trim();
  if(!host||host.includes('/')||host.includes('\\')||/[\s@]/.test(host))return null;
  try{return new URL(`${protocol}//${host}`).origin;}catch{return null;}
}

/**
 * Validate a browser POST against the origin that actually served the page.
 * PUBLIC_BASE_URL is only a fallback for tests/proxies that omit Host.
 * The Fastify MCP app independently validates Host against the deployment allowlist.
 */
export function browserSameOriginOk(
  headers:Record<string,string|string[]|undefined>,
  publicBaseUrl:string,
  production=false
):boolean{
  const originHeader=firstHeader(headers.origin).trim();
  const refererHeader=firstHeader(headers.referer).trim();
  const candidateRaw=originHeader||refererHeader;
  if(candidateRaw.toLowerCase()==='null'){
    // Some legitimate browser surfaces submit an opaque Origin while still exposing
    // Fetch Metadata. Accept it only when the browser itself classifies the request as
    // same-origin; cross-site opaque origins remain rejected. CSRF is checked separately.
    return firstHeader(headers['sec-fetch-site']).trim().toLowerCase()==='same-origin';
  }
  if(!candidateRaw){
    // Referrer-Policy may intentionally suppress Referer. Modern browsers still expose
    // Fetch Metadata; with the per-session CSRF token this is a safe same-origin fallback.
    return firstHeader(headers['sec-fetch-site']).trim().toLowerCase()==='same-origin';
  }

  let candidate:URL;
  try{candidate=new URL(candidateRaw);}catch{return false;}
  if(candidate.protocol!=='https:'&&candidate.protocol!=='http:')return false;
  if(production&&candidate.protocol!=='https:')return false;

  const expectedOrigins=new Set<string>();
  try{expectedOrigins.add(new URL(publicBaseUrl).origin);}catch{/* invalid configured base is handled elsewhere */}

  const hostHeader=firstHeader(headers.host).trim();
  if(hostHeader){
    const expected=originFromHostHeader(hostHeader,candidate.protocol as 'http:'|'https:');
    if(expected)expectedOrigins.add(expected);
  }

  // Behind a reverse proxy the backend Host can differ from the public host that
  // actually served the browser page. Accept the canonical PUBLIC_BASE_URL as an
  // equally valid same-origin target instead of requiring Host to match exactly.
  // This remains strict against cross-site origins: the candidate must equal one
  // of the explicitly known serving origins above.
  return expectedOrigins.has(candidate.origin);
}
