import assert from 'node:assert/strict';

const base=(process.env.LINK2AI_PRODUCTION_URL||'https://api-production-0383e.up.railway.app').replace(/\/$/,'');
const attempts=Number(process.env.LINK2AI_PROD_CERT_ATTEMPTS||20);
const delayMs=Number(process.env.LINK2AI_PROD_CERT_DELAY_MS||15000);

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function request(path,options={}){
  const response=await fetch(base+path,{redirect:'manual',...options});
  const text=await response.text();
  return {response,text};
}

async function eventually(label,check){
  let last;
  for(let i=1;i<=attempts;i++){
    try{return await check();}
    catch(error){
      last=error;
      if(i<attempts)await sleep(delayMs);
    }
  }
  throw new Error(label+' failed after '+attempts+' attempts: '+(last instanceof Error?last.message:String(last)));
}

await eventually('production release availability',async()=>{
  const {response,text}=await request('/');
  assert.equal(response.status,200);
  assert.match(text,/Source infrastructure for AI/);
  assert.match(text,/Use the API/);
  return true;
});

{
  const {response,text}=await request('/healthz');
  assert.equal(response.status,200);
  const data=JSON.parse(text);
  assert.equal(data.ok,true);
}

{
  const {response,text}=await request('/readyz');
  assert.equal(response.status,200);
  const data=JSON.parse(text);
  assert.equal(data.ready,true);
}

for(const [path,pattern] of [
  ['/developers',/Public API beta/],
  ['/connect',/Connected = authorization finished/],
  ['/sources',/Supported sources/],
  ['/privacy',/API-key hashes and non-secret key prefixes/]
]){
  const {response,text}=await request(path);
  assert.equal(response.status,200,path+' must return 200');
  assert.match(text,pattern,path+' must expose current V3 product copy');
}

{
  const {response}=await request('/account');
  assert.equal(response.status,302);
  assert.match(response.headers.get('location')??'',/^\/(?:login|signup)\?/);
}

{
  const {response,text}=await request('/.well-known/oauth-authorization-server');
  assert.equal(response.status,200);
  const data=JSON.parse(text);
  assert.equal(typeof data.authorization_endpoint,'string');
  assert.equal(typeof data.token_endpoint,'string');
  assert.equal(typeof data.registration_endpoint,'string');
  assert.ok(Array.isArray(data.scopes_supported)&&data.scopes_supported.includes('link2ai:read'));
}

{
  const {response,text}=await request('/.well-known/oauth-protected-resource/mcp');
  assert.equal(response.status,200);
  const data=JSON.parse(text);
  assert.equal(data.resource,base+'/mcp');
}

for(const [method,path,body] of [
  ['GET','/v1/usage',undefined],
  ['GET','/v1/sources',undefined],
  ['POST','/v1/read',JSON.stringify({url:'https://news.ycombinator.com/item?id=1'})]
]){
  const {response,text}=await request(path,{
    method,
    headers:body?{'content-type':'application/json'}:undefined,
    body
  });
  assert.equal(response.status,401,method+' '+path+' must reject missing API key');
  const data=JSON.parse(text);
  assert.equal(data.error,'unauthorized');
  assert.doesNotMatch(text,/DATABASE_URL|APP_SECRET|REVIEWER_PASSWORD|Authorization: Bearer/i);
}

{
  const {response}=await request('/mcp',{
    method:'POST',
    headers:{'content-type':'application/json','accept':'application/json, text/event-stream'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'prod-cert',version:'1'}}})
  });
  assert.equal(response.status,401);
  assert.match(response.headers.get('www-authenticate')??'',/oauth-protected-resource\/mcp/);
}

console.log('production public certification PASS');
