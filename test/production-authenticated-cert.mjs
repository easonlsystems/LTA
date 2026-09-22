import assert from 'node:assert/strict';

const base=(process.env.LINK2AI_PRODUCTION_URL||'').replace(/\/$/,'');
const email=process.env.LINK2AI_CERT_EMAIL||'';
const password=process.env.LINK2AI_CERT_PASSWORD||'';
const sourceUrl=process.env.LINK2AI_CERT_SOURCE_URL||'https://news.ycombinator.com/item?id=8863';
const instagramCanaryUrl=process.env.LINK2AI_CERT_INSTAGRAM_URL||'https://www.instagram.com/reel/Ddx6Q_MJNyg/';
const githubCanaryUrl=process.env.LINK2AI_CERT_GITHUB_URL||'https://github.com/nodejs/node/pull/57343';
const instagramImageCanaryUrl=(process.env.LINK2AI_CERT_INSTAGRAM_IMAGE_URL||'').trim();
const pollLimit=Number(process.env.LINK2AI_CERT_POLL_LIMIT||60);
const pollDelayMs=Number(process.env.LINK2AI_CERT_POLL_DELAY_MS||2000);
const expectedRevision=(process.env.LINK2AI_EXPECTED_REVISION||'').trim();

if(!base||!email||!password){
  throw new Error('Authenticated production certification BLOCKED: configure LINK2AI_PRODUCTION_URL, LINK2AI_CERT_EMAIL, and LINK2AI_CERT_PASSWORD as CI secrets. LINK2AI_CERT_EMAIL/PASSWORD must match the production reviewer credentials.');
}
if(!expectedRevision)throw new Error('Authenticated production certification requires LINK2AI_EXPECTED_REVISION.');

const cookies=new Map();
let apiKey='';
let apiKeyId='';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hidden=(html,name)=>{
  const match=html.match(new RegExp(`name=["']${name}["'][^>]*value=["']([^"']+)["']`));
  assert.ok(match,`Expected hidden ${name} field`);
  return match[1].replaceAll('&amp;','&');
};
const cookieHeader=()=>[...cookies].map(([name,value])=>`${name}=${value}`).join('; ');
const rememberCookies=response=>{
  for(const raw of response.headers.getSetCookie?.()||[]){
    const first=raw.split(';',1)[0];
    const index=first.indexOf('=');
    if(index<=0)continue;
    const name=first.slice(0,index).trim();
    const value=first.slice(index+1);
    if(/(?:^|;)\s*max-age=0(?:;|$)/i.test(raw)||value==='')cookies.delete(name);
    else cookies.set(name,value);
  }
};

async function web(path,options={}){
  const headers=new Headers(options.headers||{});
  const cookie=cookieHeader();
  if(cookie)headers.set('cookie',cookie);
  const method=String(options.method||'GET').toUpperCase();
  if(method!=='GET'&&method!=='HEAD'&&!headers.has('origin'))headers.set('origin',base);
  const response=await fetch(base+path,{redirect:'manual',...options,headers});
  rememberCookies(response);
  return {response,text:await response.text()};
}

async function api(path,options={}){
  const headers=new Headers(options.headers||{});
  headers.set('authorization',`Bearer ${apiKey}`);
  const response=await fetch(base+path,{...options,headers});
  const text=await response.text();
  let data;
  try{data=JSON.parse(text);}catch{throw new Error(`${path} returned non-JSON (${response.status})`);}
  return {response,data};
}

async function readUntilDone(url,{refresh=false}={}){
  let read=await api('/v1/read',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,refresh})
  });
  assert.ok([200,202].includes(read.response.status),`read returned ${read.response.status}: ${read.data.error_code||read.data.message||'unknown'}`);
  assert.equal(read.data.id,read.data.job_id,'id and job_id aliases must agree');
  const jobId=read.data.id;
  for(let attempt=0;read.response.status===202&&attempt<pollLimit;attempt++){
    await sleep(pollDelayMs);
    read=await api(`/v1/jobs/${jobId}`);
  }
  assert.equal(read.response.status,200,`job did not complete: ${read.data.error_code||read.data.status}`);
  assert.equal(read.data.status,'completed');
  assert.equal(read.data.id,jobId);
  return read;
}

async function revoke(){
  if(!apiKeyId||!cookieHeader())return;
  const account=await web('/account');
  if(account.response.status!==200)return;
  const csrf=hidden(account.text,'csrf');
  await web('/account/api-keys/revoke',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({csrf,key_id:apiKeyId})
  });
}

try{
  // Never certify an older healthy deployment. The complete authenticated
  // lifecycle below must run against the exact revision that triggered this job.
  let revisionReady=false;
  for(let attempt=0;attempt<pollLimit;attempt++){
    const health=await fetch(base+'/healthz');
    if(health.status===200){
      const data=await health.json().catch(()=>null);
      if(data?.revision===expectedRevision){revisionReady=true;break;}
    }
    await sleep(pollDelayMs);
  }
  assert.equal(revisionReady,true,'production did not reach the expected revision before authenticated certification');

  // Production normally has Google sign-in enabled, which intentionally disables
  // /auth/password/login. Reviewer access remains available specifically for
  // integration/release verification and is therefore the stable automation path.
  const login=await web('/auth/reviewer',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({email,password,return_to:'/account'})
  });
  assert.equal(login.response.status,302,'production reviewer certification account must sign in');

  const account=await web('/account');
  assert.equal(account.response.status,200);
  assert.match(account.text,/API keys/,'account must expose API key management');
  assert.match(account.text,/Key name/,'account must only ask for a key name');
  assert.match(account.text,/Generate API key/,'account must generate the secret server-side');
  assert.match(account.text,/full key is shown once and cannot be viewed again/i,'account must explain one-time key visibility');
  assert.doesNotMatch(account.text,/Do you need an API key\?|Invoke-RestMethod|View API quickstart/,'account key management must not be an API tutorial');
  const csrf=hidden(account.text,'csrf');
  const created=await web('/account/api-keys',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({csrf,name:`Production certification ${new Date().toISOString()}`})
  });
  assert.equal(created.response.status,200);
  assert.match(created.text,/API key generated\./,'one-time key screen must identify key creation');
  assert.match(created.text,/Copy once/,'one-time key screen must expose a one-time copy action');
  assert.match(created.text,/never be shown again/i,'one-time key screen must warn that the secret cannot be recovered');
  assert.doesNotMatch(created.text,/What do I do with this\?|Invoke-RestMethod|Open step-by-step quickstart/,'one-time key screen must stay focused on the secret');
  apiKey=created.text.match(/l2ai_live_[A-Za-z0-9_-]+/)?.[0]||'';
  apiKeyId=created.text.match(/data-api-key-id="([0-9a-f-]+)"/i)?.[1]||'';
  assert.ok(apiKey&&apiKeyId,'created key and non-secret key id must be present');
  const keyPrefix=apiKey.slice(0,'l2ai_live_'.length+8);
  const accountAfterCreate=await web('/account');
  assert.equal(accountAfterCreate.response.status,200);
  assert.ok(accountAfterCreate.text.includes(keyPrefix),'account should show only the non-secret key prefix');
  assert.ok(!accountAfterCreate.text.includes(apiKey),'full API key must never be shown again after the creation response');

  const before=await api('/v1/usage');
  assert.equal(before.response.status,200);
  assert.equal(typeof before.data.remaining_usage_units,'number');
  const sources=await api('/v1/sources');
  assert.equal(sources.response.status,200);
  assert.ok(Array.isArray(sources.data.sources)&&sources.data.sources.length>0);

  const read=await readUntilDone(sourceUrl);
  const jobId=read.data.id;
  assert.equal(typeof read.data.canonical_url,'string');
  assert.ok(typeof read.data.content==='string'&&read.data.content.trim().length>80,'completed result must contain useful source text');
  assert.ok(['complete','partial'].includes(read.data.source_completeness));
  assert.equal(typeof read.data.units_used,'number');
  assert.equal(typeof read.data.remaining_usage_units,'number');

  const after=await api('/v1/usage');
  assert.equal(after.response.status,200);
  assert.ok(after.data.remaining_usage_units<=before.data.remaining_usage_units,'usage balance must not increase after a read');
  const recent=await web('/account');
  assert.equal(recent.response.status,200);
  assert.match(recent.text,new RegExp(jobId.slice(0,8)),'recent jobs must expose the API job');

  await revoke();
  const accountAfterDelete=await web('/account');
  assert.equal(accountAfterDelete.response.status,200);
  assert.ok(!accountAfterDelete.text.includes(keyPrefix),'deleted API key must disappear from the active key list');
  const revoked=await api('/v1/usage');
  assert.equal(revoked.response.status,401);
  assert.equal(revoked.data.error,'unauthorized');
  assert.equal(revoked.data.error_code,'unauthorized');
  apiKeyId='';
  console.log('production authenticated API lifecycle certification PASS');
}finally{
  await revoke().catch(()=>{});
  apiKey='';
  password.length; // Keep secret values out of output and assertions.
}
