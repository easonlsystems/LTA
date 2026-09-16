import https from 'node:https';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';
import { Link2AIError } from './errors.js';

function publicIpv4(address:string):boolean{
  const p=address.split('.').map(Number); if(p.length!==4||p.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
  const [a,b,c]=p;
  if(a===0||a===10||a===127||a>=224)return false;
  if(a===100&&b>=64&&b<=127)return false;
  if(a===169&&b===254)return false;
  if(a===172&&b>=16&&b<=31)return false;
  if(a===192&&b===168)return false;
  if(a===198&&(b===18||b===19))return false;
  if(a===192&&b===0&&(c===0||c===2))return false;
  if(a===198&&b===51&&c===100)return false;
  if(a===203&&b===0&&c===113)return false;
  return true;
}

function publicIpv6(address:string):boolean{
  const a=address.toLowerCase().split('%')[0];
  if(a==='::'||a==='::1')return false;
  // Reject IPv4-mapped/compatible and transition forms rather than trying to infer
  // whether their embedded destination is safe. Caption/CDN hosts do not need them.
  if(a.startsWith('::ffff:')||/^::[0-9a-f:.]+$/.test(a)||a.startsWith('64:ff9b:')||a.startsWith('2002:'))return false;
  if(a.startsWith('fc')||a.startsWith('fd'))return false;
  if(/^fe[89ab]/.test(a))return false;
  if(a.startsWith('ff'))return false;
  if(a.startsWith('2001:db8:')||a==='2001:db8::')return false;
  // Be conservative: currently routable global unicast space is 2000::/3.
  const first=parseInt(a.split(':',1)[0]||'0',16);
  return Number.isFinite(first)&&first>=0x2000&&first<=0x3fff;
}

export function isPublicAddress(address:string):boolean{
  const kind=net.isIP(address); return kind===4?publicIpv4(address):kind===6?publicIpv6(address):false;
}

export function orderPublicAddresses(addresses:Array<{address:string;family:number}>):Array<{address:string;family:4|6}>{
  return [...addresses]
    .map(entry=>({address:entry.address,family:entry.family as 4|6}))
    // Railway production currently has IPv6 egress disabled. Prefer IPv4 when both
    // families are public, but retain IPv6 as a fallback for IPv6-only hosts.
    .sort((a,b)=>a.family===b.family?0:(a.family===4?-1:1));
}

export function pinnedLookup(address:string,family:4|6){
  return (_hostname:string,options:any,callback:any)=>{
    if(options&&typeof options==='object'&&options.all){callback(null,[{address,family}]);return;}
    callback(null,address,family);
  };
}

async function resolvePublic(hostname:string):Promise<Array<{address:string;family:4|6}>>{
  let addresses:Array<{address:string;family:number}>;
  try { addresses=await lookup(hostname,{all:true,verbatim:true}) as Array<{address:string;family:number}>; }
  catch { throw new Link2AIError('EXTRACTION_FAILED','Remote content host could not be resolved.',502,true); }
  if(!addresses.length||addresses.some((a:{address:string;family:number})=>!isPublicAddress(a.address)))throw new Link2AIError('EXTRACTION_FAILED','Remote content URL resolved to a non-public network.',502);
  return orderPublicAddresses(addresses).slice(0,8);
}

export async function safeGetBuffer(rawUrl:string,opts:{maxBytes:number;timeoutMs:number;maxRedirects?:number;userAgent?:string;accept?:string}):Promise<{bytes:Buffer;contentType:string|null;finalUrl:string}>{
  let current=rawUrl; const redirects=opts.maxRedirects??5;
  for(let i=0;i<=redirects;i++){
    let url:URL; try{url=new URL(current);}catch{throw new Link2AIError('EXTRACTION_FAILED','Remote content URL is invalid.',502);}
    if(url.protocol!=='https:'||url.username||url.password)throw new Link2AIError('EXTRACTION_FAILED','Remote content URL must use public HTTPS.',502);
    const resolvedAddresses=await resolvePublic(url.hostname);
    let result:{status:number;headers:IncomingHttpHeaders;bytes:Buffer}|undefined;
    let lastNetworkError:unknown;
    const requestDeadline=Date.now()+opts.timeoutMs;
    for(const resolved of resolvedAddresses){
      const remainingMs=requestDeadline-Date.now();
      if(remainingMs<=0)break;
      try {
        result=await new Promise<{status:number;headers:IncomingHttpHeaders;bytes:Buffer}>((resolve,reject)=>{
          const chunks:Buffer[]=[]; let total=0;
          const req=https.request({
            protocol:'https:',hostname:url.hostname,port:url.port?Number(url.port):443,path:`${url.pathname}${url.search}`,method:'GET',
            servername:url.hostname,headers:{'user-agent':opts.userAgent??'Link2AI/1.0','accept':opts.accept??'*/*','accept-encoding':'identity'},
            lookup:pinnedLookup(resolved.address,resolved.family)
          },(res:any)=>{
            res.on('data',(chunk:Buffer|string)=>{
              const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk); total+=b.length;
              if(total>opts.maxBytes){req.destroy(new Link2AIError('EXTRACTION_FAILED','Remote content response exceeded safety limit.',502));return;}
              chunks.push(b);
            });
            res.on('end',()=>resolve({status:res.statusCode??0,headers:res.headers,bytes:Buffer.concat(chunks)}));
          });
          req.setTimeout(remainingMs,()=>req.destroy(new Link2AIError('EXTRACTION_FAILED','Remote content request timed out.',504,true)));
          req.on('error',reject); req.end();
        });
        break;
      } catch (error) {
        if(error instanceof Link2AIError&&!error.retryable)throw error;
        lastNetworkError=error;
      }
    }
    if(!result){
      if(lastNetworkError instanceof Link2AIError)throw lastNetworkError;
      const code=lastNetworkError&&typeof lastNetworkError==='object'&&'code' in lastNetworkError?String((lastNetworkError as {code?:unknown}).code??''):'';
      throw new Link2AIError('EXTRACTION_FAILED','Remote content request failed before a response was received.',502,true,{
        cause:lastNetworkError instanceof Error?lastNetworkError.name:'network_error',
        ...(code?{cause_code:code}:{})
      });
    }
    if([301,302,303,307,308].includes(result.status)){
      const loc=result.headers.location;if(!loc)throw new Link2AIError('EXTRACTION_FAILED','Remote content redirect was incomplete.',502);
      current=new URL(loc,url).toString();continue;
    }
    if(result.status<200||result.status>=300)throw new Link2AIError('EXTRACTION_FAILED',`Remote content request returned HTTP ${result.status}.`,502,true);
    const ct=Array.isArray(result.headers['content-type'])?result.headers['content-type'][0]??null:result.headers['content-type']??null;
    return {bytes:result.bytes,contentType:ct,finalUrl:current};
  }
  throw new Link2AIError('EXTRACTION_FAILED','Remote content redirected too many times.',502);
}
