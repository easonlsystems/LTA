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
