import assert from 'node:assert/strict';

const base=(process.env.LINK2AI_PRODUCTION_URL||'https://api-production-0383e.up.railway.app').replace(/\/$/,'');
const attempts=Number(process.env.LINK2AI_PROD_CERT_ATTEMPTS||20);
const delayMs=Number(process.env.LINK2AI_PROD_CERT_DELAY_MS||15000);
const expectedRevision=(process.env.LINK2AI_EXPECTED_REVISION||'').trim();

if(!expectedRevision)throw new Error('Production certification requires LINK2AI_EXPECTED_REVISION.');

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

// Bind certification to the exact revision that triggered this workflow.
// Stable page copy is not a release gate: an older healthy deployment can expose
// the same homepage/developer markers and would otherwise create a false PASS.
await eventually('production revision availability',async()=>{
  const health=await request('/healthz');
  assert.equal(health.response.status,200);
  const healthData=JSON.parse(health.text);
  assert.equal(healthData.ok,true);
  assert.equal(healthData.revision,expectedRevision,'production is not running the triggering commit yet');

  const home=await request('/');
  assert.equal(home.response.status,200);
  assert.match(home.text,/data-activation-home/,'homepage must expose the activation surface');
  assert.match(home.text,/data-install-handoff[^>]+href="\/start\?from=hero"/,'homepage must expose the primary Claude install handoff');
  assert.match(home.text,/href="\/developers">Developers<\/a>/,'homepage must expose the developer entry point to MCP');
  assert.match(home.text,/href="\/developers">Developers<\/a>/,'homepage must route REST and MCP users to the dedicated developer surface');
  assert.match(home.text,/Your AI answered\.<\/span><em>Did it read the source\?<\/em>/,'production homepage must lead with the source-reliability reframe');
  assert.match(home.text,/id="sim-run"[^>]*aria-expanded="true"[^>]*aria-controls="sim-comparison-panels"/,'homepage proof must start expanded');
  assert.match(home.text,/id="sim-comparison-panels" aria-live="polite">/,'homepage proof panels must be visible on first paint');
  assert.match(home.text,/sim-answer sim-fail show/,'homepage must preload the recorded native access failure');
  assert.match(home.text,/Summarize this Instagram Reel\./,'production homepage must lead with the recorded Instagram proof');
  const reelLinks=home.text.match(/https:\/\/www\.instagram\.com\/reel\/Ddx6Q_MJNyg\//g)??[];
  assert.equal(reelLinks.length,3,'production homepage must link the real Reel in the source reference and both comparison chat messages');
  assert.match(home.text,/RECORDED PUBLIC TEST/,'production homepage must label the default Instagram proof as a recorded public test');
  assert.match(home.text,/instagram\.com\/reel\/Ddx6Q_MJNyg\//,'production homepage must expose the recorded Reel identity');
  assert.match(home.text,/Same AI assistant · source delivered/,'production comparison must stay AI-client neutral while making source delivery explicit');
  assert.match(home.text,/You already have a workaround/,'production homepage must surface the existing workaround cost');
  assert.match(home.text,/That’s the problem/,'production homepage must connect the workaround to the problem');
  assert.doesNotMatch(home.text,/Simulated Claude conversation/,'production comparison must not be Claude-specific');
  const start=await request('/start?from=hero',{redirect:'manual'});
  assert.equal(start.response.status,302,'production primary CTA must redirect');
  const startLocation=start.response.headers.get('location')??'';
  assert.match(startLocation,/^https:\/\/claude\.ai\/customize\/connectors\?/,'production primary CTA must open Claude connector setup before LTA signup');
  assert.match(startLocation,/connectorUrl=/,'production Claude connector redirect must prefill the MCP URL');

  const connect=await request('/connect');
  assert.equal(connect.response.status,200);
  assert.match(connect.text,/Finish with one real read/,'production connect page must lead toward first source success');
  assert.match(connect.text,/Connected, but Claude does not use LTA\?/,'production setup details should be collapsed behind help');
  assert.doesNotMatch(connect.text,/Set up LTA in three steps/,'production connect page must not restore the long tutorial');

  const developers=await request('/developers');
  assert.equal(developers.response.status,200);
  assert.match(developers.text,/Use LTA through MCP or REST\./,'production Developers page must expose the two integration paths');
  assert.match(developers.text,/REST API/);
  assert.match(developers.text,/Generate API key/,'production Developers page must link directly to key generation');
  assert.match(developers.text,/POST \/v1\/read/,'production Developers page must expose the read endpoint');
  assert.doesNotMatch(developers.text,/From zero to source text in three steps\.|Windows PowerShell|Complete examples|Read lifecycle|Usage & cache/,'production Developers page must not expose tutorial/reference sections');
  assert.match(developers.text,/Remote MCP/,'production developer surface must expose MCP');
  assert.ok(developers.text.includes(base+'/mcp'),'production developer surface must display the exact MCP endpoint');
  assert.match(developers.text,/Claude/,'production MCP surface must identify Claude usage');
  assert.match(developers.text,/Other compatible clients/,'production MCP surface must preserve a generic compatible-client MCP path');
  return true;
});

{
  const {response,text}=await request('/healthz');
  assert.equal(response.status,200);
  const data=JSON.parse(text);
  assert.equal(data.ok,true);
  assert.equal(data.revision,expectedRevision);
}

{
  const {response,text}=await request('/home.js?v=click-to-reveal-cert');
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type')??'',/javascript/);
  assert.match(text,/resetDemo\(false,true\)/,'production homepage JS must initialize with the recorded proof visible');
  assert.match(text,/const state=\{source:'instagram',[^}]*opened:true\}/,'production homepage JS must keep the proof-first state open');
  assert.match(text,/trackMarketing\('proof_replay'\)/,'production homepage JS must distinguish optional proof replay from first proof view');
  assert.match(text,/rapid-fire interview with entrepreneur Marcus Lemonis/,'production homepage JS must preserve the recorded With-LTA Instagram result');
  assert.match(text,/can’t directly access the Instagram Reel/,'production without-LTA copy must explain the Reel access limitation');
  assert.match(text,/paste the caption or describe the clip/,'production failure copy must offer a realistic fallback');
  assert.match(text,/AI assistant/,'production homepage JS must use neutral AI labels');
}

{
  const {response,text}=await request('/readyz');
  assert.equal(response.status,200);
  const data=JSON.parse(text);
  assert.equal(data.ready,true);
}

for(const [path,pattern] of [
  ['/developers',/Use LTA through MCP or REST\./],
  ['/connect',/Using Grok or another Remote MCP client\?/],
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
  assert.equal(data.error_code,'unauthorized');
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
