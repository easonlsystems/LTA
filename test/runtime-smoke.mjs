import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import http from 'node:http';

const probe=net.createServer();
await new Promise((resolve,reject)=>probe.once('error',reject).listen(0,'127.0.0.1',resolve));
const address=probe.address();
assert.ok(address&&typeof address==='object');
const port=address.port;
await new Promise(resolve=>probe.close(resolve));

async function rawPost(path,headers,body){
  return await new Promise((resolve,reject)=>{
    const request=http.request({host:'127.0.0.1',port,path,method:'POST',headers:{...headers,'content-length':Buffer.byteLength(body)}},response=>{
      response.resume();
      response.on('end',()=>resolve({status:response.statusCode??0,headers:response.headers}));
    });
    request.on('error',reject);
    request.end(body);
  });
}

const child=spawn(process.execPath,['dist/src/api/main.js'],{
  env:{...process.env,NODE_ENV:'production',PORT:String(port),DATABASE_URL:'postgres://127.0.0.1:1/link2ai',PUBLIC_BASE_URL:'https://link2ai.example',PUBLIC_BRAND_NAME:'LaunchBrand',RAILWAY_PUBLIC_DOMAIN:'internal.railway.local',APP_SECRET:'01234567890123456789012345678901',LEMONSQUEEZY_API_KEY:'lemon-secret-must-not-render',RESEND_API_KEY:'resend-secret-must-not-render',OPENAI_APPS_CHALLENGE:'review-challenge-token',REVIEWER_EMAIL:'reviewer@example.com',REVIEWER_PASSWORD:'this-is-a-long-review-password',FOUNDER_EMAIL:'founder@example.com',GOOGLE_CLIENT_ID:'google-client-id.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'google-client-secret-must-not-render'},
  stdio:['ignore','pipe','pipe']
});
let output='';
child.stdout.on('data',chunk=>{output+=chunk});
child.stderr.on('data',chunk=>{output+=chunk});

try{
  // Cold Windows/OneDrive dependency loading can exceed ten seconds even though the
  // server starts normally. Keep this bounded but avoid a false release failure.
  const deadline=Date.now()+45_000;
  let health;
  while(Date.now()<deadline){
    try{health=await fetch(`http://127.0.0.1:${port}/healthz`,{headers:{host:'link2ai.example'}});break;}
    catch{await new Promise(resolve=>setTimeout(resolve,100));}
  }
  assert.ok(health,`API did not start: ${output}`);
  assert.equal(health.status,200);
  assert.equal((await health.json()).ok,true);

  // Public routes should include /status (may return 503 if db unavailable)
  for(const route of ['/','/examples','/use-cases','/sources','/pricing','/connect','/support','/privacy','/terms']){
    const page=await fetch(`http://127.0.0.1:${port}${route}`,{headers:{host:'link2ai.example'}});
    assert.equal(page.status,200,`${route} should return 200`);
    const body=await page.text();
    assert.match(body,/LaunchBrand/);
    if(route==='/'){
      assert.match(body,/<nav class="home-nav" aria-label="Primary">/);
      assert.match(body,/class="experience-home home-only"/);
      assert.match(body,/Paste the link\./);
      assert.match(body,/Let your AI actually read it\./);
      assert.match(body,/Public links → AI-readable source/);
      assert.match(body,/Add LTA to Claude/);
      assert.match(body,/Real LTA test case/);
      assert.match(body,/Ddx6Q_MJNyg/);
      assert.match(body,/See the difference/);
      for(const source of ['youtube','tiktok','instagram','x','bluesky','hn','pdf','web'])assert.match(body,new RegExp(`data-sim-source=\"${source}\"`),`homepage should expose ${source} simulation`);
      assert.match(body,/href="\/examples"/);
      assert.match(body,/href="\/use-cases"/);
      assert.match(body,/href="\/sources"/);
      assert.match(body,/href="\/pricing"/);
      assert.match(body,/href="\/developers"/);
      assert.match(body,/Use MCP/);
      assert.match(body,/API key/);
      assert.match(body,/src="\/home\.js\?v=20260920-reel-proof3" defer/);
      assert.doesNotMatch(body,/One missing layer/i);
      assert.doesNotMatch(body,/What do you want Claude to read\?/);
      assert.doesNotMatch(body,/Try the link Claude just failed to read\./);
      assert.doesNotMatch(body,/Built by Eason Systems/);
    }
    if(route==='/examples'){assert.match(body,/YouTube \/ Shorts/);assert.match(body,/GitHub Issues \/ PRs/);assert.match(body,/Try the interactive comparison/);}
    if(route==='/use-cases'){assert.match(body,/Use the link normally/);assert.match(body,/Summaries grounded in the source/);}
    if(route==='/sources'){assert.match(body,/Supported sources/);assert.match(body,/Video & social/);assert.match(body,/Reddit/);assert.match(body,/Paused until approved Reddit OAuth Data API credentials are configured/);}
    if(route==='/pricing'){assert.match(body,/Founding offer/);assert.match(body,/First 50 paid users get 50% more usage/);assert.match(body,/500 paid units \+ 250 founding bonus/);assert.match(body,/2,000 paid units \+ 1,000 founding bonus/);assert.match(body,/Unused paid units roll over while subscribed/);assert.match(body,/founding bonus resets each billing cycle and does not roll over/);assert.match(body,/No plan-specific video length limit/);assert.match(body,/What does 1 processing unit mean/);assert.match(body,/Units depend on content size, not platform/);}
    if(route==='/connect'){assert.match(body,/Add LTA to Claude/);assert.match(body,/One click opens Claude/);assert.match(body,/prefilled/);assert.match(body,/href="\/connect\/start"/);assert.match(body,/target="_blank"/);assert.match(body,/Need help connecting\?/);assert.match(body,/Tools already loaded/);assert.match(body,/Using Grok or another Remote MCP client\?/);assert.doesNotMatch(body,/Set up LTA in three steps|available in Claude's Connectors Directory|Open Claude Connectors Directory|Use the published connector|Search “LTA”|Choose the published LTA connector/);}
    assert.doesNotMatch(body,/lemon-secret-must-not-render|resend-secret-must-not-render|google-client-secret-must-not-render/);
  }

  const homeJsResponse=await fetch(`http://127.0.0.1:${port}/home.js?v=20260920-reel-proof3`,{headers:{host:'link2ai.example'}});
  assert.equal(homeJsResponse.status,200,'homepage JS endpoint must return 200');
  assert.match(homeJsResponse.headers.get('content-type')??'',/javascript/);
  const homeJs=await homeJsResponse.text();
  assert.doesNotThrow(()=>new Function(homeJs),'homepage interaction JS must parse');

  class FakeClassList{
    constructor(owner){this.owner=owner;this.values=new Set();}
    add(...names){names.forEach(name=>this.values.add(name));}
    remove(...names){names.forEach(name=>this.values.delete(name));}
    toggle(name,force){const next=force===undefined?!this.values.has(name):Boolean(force);if(next)this.values.add(name);else this.values.delete(name);return next;}
    contains(name){return this.values.has(name);}
  }
  class FakeElement{
    constructor(id='',dataset={}){this.id=id;this.dataset={...dataset};this.textContent='';this.innerHTML='';this.className='';this.hidden=false;this.listeners={};this.attributes={};this.classList=new FakeClassList(this);}
    addEventListener(name,fn){this.listeners[name]=fn;}
    setAttribute(name,value){this.attributes[name]=String(value);}
    getAttribute(name){return this.attributes[name]??null;}
    scrollIntoView(){}
  }
  const ids={};
  for(const id of ['sim-source-name','sim-url','sim-left-state','sim-right-state','sim-left-answer','sim-right-answer','sim-tool','sim-conclusion','sim-run','sim-reset','sim-comparison-panels','source-preview-label','source-preview-title','source-preview-question','source-mini-result','source-open-sim','usecase-user','usecase-result','simulation'])ids[id]=new FakeElement(id);
  ids['sim-conclusion'].hidden=true;
  ids['sim-comparison-panels'].hidden=true;
  const simTabs=['reddit','youtube','tiktok','instagram','x','bluesky','hn','pdf','web'].map(value=>new FakeElement('',{simSource:value}));
  const simTab=(key)=>{const tab=simTabs.find(el=>el.dataset.simSource===key);assert.ok(tab,`missing simulation tab ${key}`);return tab;};
  const sourceButtons=['reddit','youtube','github','x','web','pdf','instagram','tiktok','hn','bluesky'].map(value=>new FakeElement('',{sourceKey:value}));
  const usecaseButtons=['reddit','youtube','github','research'].map(value=>new FakeElement('',{usecase:value}));
  const leftLines=[new FakeElement(),new FakeElement(),new FakeElement()];
  const rightLines=[new FakeElement(),new FakeElement(),new FakeElement()];
  const fakeDocument={
    querySelector(selector){if(selector.startsWith('#'))return ids[selector.slice(1)]??null;return null;},
    querySelectorAll(selector){
      if(selector==='.sim-tab')return simTabs;
      if(selector==='.sim-user-question')return [new FakeElement(),new FakeElement()];
      if(selector==='.source-button')return sourceButtons;
      if(selector==='.usecase-option')return usecaseButtons;
      if(selector==='.reveal')return [];
      if(selector==='#sim-left-thinking .sim-line')return leftLines;
      if(selector==='#sim-right-thinking .sim-line')return rightLines;
      if(selector==='#sim-left-thinking .sim-line,#sim-right-thinking .sim-line')return [...leftLines,...rightLines];
      return [];
    },
    getElementById(id){return ids[id]??null;}
  };
  const fakeWindow={matchMedia:()=>({matches:false})};
  let nextTimerId=1;
  const timers=new Map();
  const queuedTimer=(fn,ms)=>{const id=nextTimerId++;timers.set(id,{fn,ms});return id;};
  const queuedClear=(id)=>{timers.delete(id);};
  const runNextTimer=()=>{const entry=[...timers.entries()].sort((a,b)=>a[1].ms-b[1].ms||a[0]-b[0])[0];if(!entry)return false;timers.delete(entry[0]);entry[1].fn();return true;};
  const runAllTimers=()=>{let guard=0;while(runNextTimer()){if(++guard>100)throw new Error('timer loop');}};
  assert.doesNotThrow(()=>new Function('document','window','setTimeout','clearTimeout',homeJs)(fakeDocument,fakeWindow,queuedTimer,queuedClear),'homepage interaction JS must execute');
  // The comparison must stay closed until the visitor explicitly asks to see it.
  assert.equal(ids['sim-left-state'].textContent,'Ready','simulation should initialize idle');
  assert.equal(ids['sim-right-state'].textContent,'Ready','simulation should initialize idle');
  assert.equal(ids['sim-comparison-panels'].hidden,true,'comparison panels must be hidden before interaction');
  assert.equal(timers.size,0,'simulation must not autoplay');
  runAllTimers();
  assert.equal(ids['sim-left-state'].textContent,'Ready','idle comparison must remain closed');
  assert.equal(ids['sim-right-state'].textContent,'Ready','idle comparison must remain closed');
  // Tabs may change the example before reveal, but must not open the comparison themselves.
  simTab('reddit').listeners.click();
  assert.equal(ids['sim-comparison-panels'].hidden,true,'selecting a source must not reveal the comparison before the CTA');
  assert.equal(ids['sim-right-state'].textContent,'Ready','Reddit availability should wait for the explicit comparison run');
  // Reddit is intentionally unavailable without OAuth credentials. Pressing Run must reveal the paused state, never fake success.
  ids['sim-run'].listeners.click();
  assert.equal(ids['sim-comparison-panels'].hidden,false,'comparison CTA must reveal the panels');
  assert.equal(ids['sim-run'].getAttribute('aria-expanded'),'true','comparison CTA must expose its expanded state');
  runAllTimers();
  assert.equal(ids['sim-right-state'].textContent,'Temporarily paused','Run must not bypass the Reddit availability gate');
  assert.doesNotMatch(ids['sim-tool'].innerHTML,/Source loaded/);
  assert.match(ids['sim-right-answer'].innerHTML,/paused on this deployment/);
  assert.equal(ids['sim-conclusion'].hidden,true,'paused Reddit must not show the success conclusion');
  simTab('youtube').listeners.click();
  assert.equal(ids['sim-left-state'].textContent,'Link only','selecting a supported source must show its static limitation preview');
  assert.equal(ids['sim-right-state'].textContent,'Source ready','selecting a supported source must show its static loaded preview');
  assert.equal(timers.size,0,'source tabs must not enqueue an automatic run');
  // A real Run starts only after the visitor explicitly presses the comparison button.
  ids['sim-run'].listeners.click();
  assert.equal(ids['sim-left-state'].textContent,'Trying source');
  assert.equal(ids['sim-right-state'].textContent,'Starting');
  assert.ok(runNextTimer(),'first staged timer should exist');
  assert.equal(ids['sim-right-state'].textContent,'Reading');
  // Reset in the middle of a run must invalidate every stale callback.
  ids['sim-reset'].listeners.click();
  runAllTimers();
  assert.equal(ids['sim-left-state'].textContent,'Link only','mid-run Reset must defeat stale left callbacks');
  assert.equal(ids['sim-right-state'].textContent,'Source ready','mid-run Reset must defeat stale right callbacks');
  assert.equal(ids['sim-conclusion'].hidden,true,'mid-run Reset must keep conclusion hidden');
  // Run again after Reset and complete the whole comparison.
  ids['sim-run'].listeners.click();
  runAllTimers();
  assert.equal(ids['sim-left-state'].textContent,'Blocked','rerun after Reset must reach blocked state');
  assert.equal(ids['sim-right-state'].textContent,'Source loaded','rerun after Reset must reach loaded state');
  assert.equal(ids['sim-conclusion'].hidden,false,'rerun after Reset must reveal conclusion');
  assert.ok(ids['sim-right-answer'].classList.contains('show'),'rerun after Reset must reveal the answer');
  assert.equal(ids['sim-run'].textContent,'Run again ↻','completed comparison should offer a rerun');
  assert.doesNotMatch(ids['sim-tool'].innerHTML,/\bready\b/i,'loaded tool state should not repeat ready');
  assert.match(ids['sim-right-answer'].innerHTML,/AI agents are becoming capable faster/,'YouTube proof should read as source-specific');
  simTab('instagram').listeners.click();
  ids['sim-run'].listeners.click();
  runAllTimers();
  assert.match(ids['sim-right-answer'].innerHTML,/rapid-fire interview with entrepreneur Marcus Lemonis/,'Instagram With-LTA answer should reproduce the recorded real result');
  assert.match(ids['sim-left-answer'].innerHTML,/can’t directly access the Instagram Reel/,'Instagram without-LTA side should explain the source-access limitation');
  assert.match(ids['sim-left-answer'].innerHTML,/paste the caption or describe the clip/,'Instagram failure should give a realistic fallback');
  assert.match(ids['sim-right-answer'].innerHTML,/millionaire at 27/,'Instagram With-LTA answer should preserve a concrete point from the recorded result');
  assert.doesNotMatch(ids['sim-right-answer'].innerHTML,/Claude/,'comparison answer labels must remain AI-client neutral');
  // Switching source during a run must invalidate old-source callbacks.
  ids['sim-run'].listeners.click();
  assert.ok(runNextTimer());
  simTab('hn').listeners.click();
  runAllTimers();
  assert.match(ids['sim-url'].textContent,/news\.ycombinator\.com/,'source tabs must switch simulation content');
  assert.equal(ids['sim-left-state'].textContent,'Link only','switching source must cancel the old run and show the new preview');
  assert.equal(ids['sim-right-state'].textContent,'Source ready','switching source must not autoplay the new source');
  assert.equal(timers.size,0,'switching source must leave no stale or automatic timers');
  ids['sim-run'].listeners.click();
  runAllTimers();
  assert.equal(ids['sim-right-state'].textContent,'Source loaded','explicit Run must complete the newly selected source');
  ids['sim-reset'].listeners.click();
  assert.equal(ids['sim-left-state'].textContent,'Link only','final Reset must restore left preview');
  assert.equal(ids['sim-right-state'].textContent,'Source ready','final Reset must restore right preview');
  assert.match(ids['sim-tool'].innerHTML,/Source loaded/,'Reset must restore the meaningful tool preview');
  assert.equal(ids['sim-run'].textContent,'See the difference →','Reset should restore the initial comparison CTA');
  // Every advertised supported source must have a runnable comparison, not a dead tab.
  for(const source of ['tiktok','instagram','x','bluesky','hn','pdf','web']){
    simTab(source).listeners.click();
    assert.equal(ids['sim-left-state'].textContent,'Link only',source+' should initialize its left-side preview');
    assert.equal(ids['sim-right-state'].textContent,'Source ready',source+' should initialize its right-side preview');
    ids['sim-run'].listeners.click();
    runAllTimers();
    assert.equal(ids['sim-right-state'].textContent,'Source loaded',source+' comparison should load the LTA side');
    assert.ok(ids['sim-right-answer'].classList.contains('show'),source+' comparison should reveal an answer');
    ids['sim-reset'].listeners.click();
  }

  const start=await fetch(`http://127.0.0.1:${port}/start?from=hero`,{headers:{host:'link2ai.example'},redirect:'manual'});
  assert.equal(start.status,302);
  const startLocation=start.headers.get('location')??'';
  assert.match(startLocation,/^https:\/\/claude\.ai\/customize\/connectors\?/,'homepage CTA should go directly to Claude connector setup');
  assert.match(startLocation,/connectorName=LaunchBrand/);
  assert.match(startLocation,/connectorUrl=https%3A%2F%2Flink2ai\.example%2Fmcp/);

  const connectPage=await fetch(`http://127.0.0.1:${port}/connect`,{headers:{host:'link2ai.example'}});
  assert.equal(connectPage.status,200);
  const connectPageText=await connectPage.text();
  assert.match(connectPageText,/One click opens Claude/,'connect page must lead with the one-click setup');
  assert.match(connectPageText,/Need help connecting\?/,'detailed setup instructions should be collapsed behind help');
  assert.match(connectPageText,/\+ → Connectors/,'help must still show where to confirm LTA availability');
  assert.match(connectPageText,/paste a supported public link/,'connect page must say what to do after authorization');
  assert.doesNotMatch(connectPageText,/Connected = authorization finished/,'first-run surface should not front-load internal connector-state explanation');
  assert.match(connectPageText,/Connected ✓ Return to Claude/,'Connected state must give one concise next action');

  const connectStart=await fetch(`http://127.0.0.1:${port}/connect/start`,{headers:{host:'link2ai.example'},redirect:'manual'});
  assert.equal(connectStart.status,302);
  const connectLocation=connectStart.headers.get('location')??'';
  const claudeInstall=new URL(connectLocation);
  assert.equal(claudeInstall.origin,'https://claude.ai');
  assert.equal(claudeInstall.pathname,'/customize/connectors');
  assert.equal(claudeInstall.searchParams.get('modal'),'add-custom-connector');
  assert.equal(claudeInstall.searchParams.get('connectorName'),'LaunchBrand');
  assert.equal(claudeInstall.searchParams.get('connectorUrl'),'https://link2ai.example/mcp');

  const analyticsWrite=await fetch(`http://127.0.0.1:${port}/api/analytics/event`,{
    method:'POST',headers:{host:'link2ai.example','content-type':'application/json'},body:'{"event":"connect_install_click"}'
  });
  assert.equal(analyticsWrite.status,404,'there should be no public analytics write endpoint');

  const crossSiteLogin=await fetch(`http://127.0.0.1:${port}/auth/password/login`,{
    method:'POST',
    headers:{host:'link2ai.example',origin:'https://evil.example','content-type':'application/x-www-form-urlencoded'},
    body:'email=x%40example.com&password=not-a-real-password&return_to=%2Faccount',
    redirect:'manual'
  });
  assert.equal(crossSiteLogin.status,404,'legacy password login must be closed once Google sign-in is configured');

  const sameHostLogin=await rawPost('/auth/password/login',{
    host:'link2ai.example',origin:'https://link2ai.example','content-type':'application/x-www-form-urlencoded'
  },'email=x%40example.com&password=not-a-real-password&return_to=%2Faccount');
  assert.equal(sameHostLogin.status,404,'legacy password login must stay closed for same-origin requests too');

  const reverseProxyLogin=await rawPost('/auth/password/login',{
    host:'internal.railway.local',origin:'https://link2ai.example','content-type':'application/x-www-form-urlencoded'
  },'email=x%40example.com&password=not-a-real-password&return_to=%2Faccount');
  assert.equal(reverseProxyLogin.status,404,'legacy password login must stay closed behind the reverse proxy');


  const founder=await fetch(`http://127.0.0.1:${port}/founder`,{headers:{host:'link2ai.example'},redirect:'manual'});
  assert.equal(founder.status,404,'signed-out /founder must not disclose the private admin surface');
  assert.equal(founder.headers.get('location'),null);
  assert.match(founder.headers.get('cache-control')??'',/no-store/);
  assert.equal(founder.headers.get('x-frame-options'),'DENY');
  assert.match(founder.headers.get('content-security-policy')??'',/frame-ancestors 'none'/);
  assert.match(founder.headers.get('x-robots-tag')??'',/noindex/);
  assert.equal(founder.headers.get('cross-origin-resource-policy'),'same-origin');

  for(const privatePath of ['/founder/unlock','/founder/user/00000000-0000-4000-8000-000000000000']){
    const privateResponse=await fetch(`http://127.0.0.1:${port}${privatePath}`,{headers:{host:'link2ai.example'},redirect:'manual'});
    assert.equal(privateResponse.status,404,`${privatePath} must not disclose the private admin surface when signed out`);
    assert.match(privateResponse.headers.get('cache-control')??'',/no-store/);
  }

  const founderOtpSendSignedOut=await fetch(`http://127.0.0.1:${port}/founder/unlock/send`,{
    method:'POST',headers:{host:'link2ai.example','content-type':'application/x-www-form-urlencoded'},body:'return_to=%2Ffounder&csrf=fake',redirect:'manual'
  });
  assert.equal(founderOtpSendSignedOut.status,404,'signed-out Founder OTP send must not disclose the private admin surface');

  // /status should respond (200 or 503 depending on db availability)
  const status=await fetch(`http://127.0.0.1:${port}/status`,{headers:{host:'link2ai.example'}});
  assert.ok(status.status===200||status.status===503,`/status should return 200 or 503, got ${status.status}`);

  // /pricing is public in Website V2.
  const pricing=await fetch(`http://127.0.0.1:${port}/pricing`,{headers:{host:'link2ai.example'},redirect:'manual'});
  assert.equal(pricing.status,200);
  const pricingText=await pricing.text();
  assert.match(pricingText,/Try the link your AI just failed to read\./);
  assert.match(pricingText,/10 processing units/);
  assert.match(pricingText,/500 paid units \+ 250 founding bonus/);
  assert.match(pricingText,/2,000 paid units \+ 1,000 founding bonus/);
  assert.match(pricingText,/Unused paid units roll over while subscribed/);
  assert.match(pricingText,/No plan-specific video length limit/);
  assert.match(pricingText,/No fixed link-count limit/);
  assert.doesNotMatch(pricingText,/3 successful links|10 total minutes|content minutes \/ month/);

  // robots.txt
  const robots=await fetch(`http://127.0.0.1:${port}/robots.txt`,{headers:{host:'link2ai.example'}});
  assert.equal(robots.status,200);
  const robotsText=await robots.text();
  assert.match(robotsText,/Allow: \/\nDisallow: \/account/);
  assert.doesNotMatch(robotsText,/Disallow: \/founder/,'robots.txt must not advertise the private admin path');
  assert.match(robotsText,/Sitemap: https:\/\/link2ai\.example\/sitemap\.xml/);

  // sitemap.xml
  const sitemap=await fetch(`http://127.0.0.1:${port}/sitemap.xml`,{headers:{host:'link2ai.example'}});
  assert.equal(sitemap.status,200);
  const sitemapText=await sitemap.text();
  assert.match(sitemapText,/<url><loc>https:\/\/link2ai\.example\/<\/loc>/);
  assert.match(sitemapText,/<url><loc>https:\/\/link2ai\.example\/connect<\/loc>/);
  assert.match(sitemapText,/<url><loc>https:\/\/link2ai\.example\/pricing<\/loc>/);
  assert.match(sitemapText,/<url><loc>https:\/\/link2ai\.example\/status<\/loc>/);
  assert.match(sitemapText,/<url><loc>https:\/\/link2ai\.example\/support<\/loc>/);
  assert.match(sitemapText,/<url><loc>https:\/\/link2ai\.example\/privacy<\/loc>/);
  assert.match(sitemapText,/<url><loc>https:\/\/link2ai\.example\/terms<\/loc>/);
  assert.doesNotMatch(sitemapText,/\/founder/,'private admin routes must never appear in sitemap');

  const logo=await fetch(`http://127.0.0.1:${port}/logo.svg`,{headers:{host:'link2ai.example'}});
  assert.equal(logo.status,200);
  assert.match(logo.headers.get('content-type')??'',/image\/svg\+xml/);
  assert.match(await logo.text(),/<svg/);

  const challenge=await fetch(`http://127.0.0.1:${port}/.well-known/openai-apps-challenge`,{headers:{host:'link2ai.example'}});
  assert.equal(challenge.status,200);
  assert.equal(await challenge.text(),'review-challenge-token');

  const login=await fetch(`http://127.0.0.1:${port}/login?return_to=%2Faccount`,{headers:{host:'link2ai.example'}});
  assert.equal(login.status,200);
  const loginText=await login.text();
  assert.match(loginText,/Sign in to continue/);
  assert.match(loginText,/Continue with Google/);
  assert.match(loginText,/never sees or stores your Google password/);
  assert.match(loginText,/auth\/google\/start/);
  assert.match(loginText,/Integration reviewer access/);
  assert.match(loginText,/10 processing units free/);
  assert.match(loginText,/Failed or unsupported reads use 0 units/);
  assert.doesNotMatch(loginText,/auth\/password\/login/);
  assert.doesNotMatch(loginText,/Send sign-in code/);
  assert.doesNotMatch(loginText,/google-client-secret-must-not-render|this-is-a-long-review-password/);

  const signup=await fetch(`http://127.0.0.1:${port}/signup?return_to=%2Faccount`,{headers:{host:'link2ai.example'}});
  assert.equal(signup.status,200);
  const signupText=await signup.text();
  assert.match(signupText,/Create your LTA account/);
  assert.match(signupText,/Continue with Google/);
  assert.match(signupText,/auth\/google\/start/);
  assert.match(signupText,/verified email reconnects any existing LTA usage, plan and paid balance/);
  assert.match(signupText,/10 processing units free/);
  assert.match(signupText,/Failed \/ unsupported reads use 0 units/);
  assert.match(signupText,/product by Eason Systems/);
  assert.doesNotMatch(signupText,/auth\/password\/register|At least 10 characters/);

  const oauthMetadata=await fetch(`http://127.0.0.1:${port}/.well-known/oauth-authorization-server`,{headers:{host:'link2ai.example'}});
  assert.equal(oauthMetadata.status,200);
  const oauthMetadataJson=await oauthMetadata.json();
  assert.deepEqual(oauthMetadataJson.scopes_supported,['link2ai:read','offline_access']);
  assert.equal(oauthMetadataJson.registration_endpoint,'https://link2ai.example/oauth/register');
  assert.equal('client_id_metadata_document_supported' in oauthMetadataJson,false,'Claude-first beta should prefer DCR over CIMD to avoid server-side claude.ai metadata fetch failures');

  const ready=await fetch(`http://127.0.0.1:${port}/readyz`,{headers:{host:'link2ai.example'}});
  assert.equal(ready.status,503);
  assert.deepEqual(await ready.json(),{ready:false},'public readiness response must not disclose internal dependency details');

  const mcpOpaqueOrigin=await rawPost('/mcp',{
    host:'link2ai.example',origin:'null','sec-fetch-site':'same-origin','content-type':'application/json'
  },'{}');
  assert.equal(mcpOpaqueOrigin.status,403,'MCP must keep rejecting opaque browser origins even when site metadata says same-origin');

  const unauthorized=await fetch(`http://127.0.0.1:${port}/mcp`,{
    method:'POST',headers:{host:'link2ai.example','content-type':'application/json'},body:'{}'
  });
  assert.equal(unauthorized.status,401);
  assert.match(unauthorized.headers.get('www-authenticate')??'',/oauth-protected-resource\/mcp/);

  const legacyOpenaiRuntime=await fetch(`http://127.0.0.1:${port}/mcp`,{
    method:'POST',headers:{host:'link2ai.example','content-type':'application/json','user-agent':'openai-mcp/1.0.0'},body:'{}'
  });
  assert.equal(legacyOpenaiRuntime.status,401);
  assert.match(legacyOpenaiRuntime.headers.get('www-authenticate')??'',/oauth-protected-resource\/mcp\/openai/,'legacy ChatGPT runtime must reauthorize against the restricted OpenAI MCP audience');

  const openaiResourceMetadata=await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource/mcp/openai`,{headers:{host:'link2ai.example'}});
  assert.equal(openaiResourceMetadata.status,200);
  assert.equal((await openaiResourceMetadata.json()).resource,'https://link2ai.example/mcp/openai');

  const unauthorizedOpenai=await fetch(`http://127.0.0.1:${port}/mcp/openai`,{
    method:'POST',headers:{host:'link2ai.example','content-type':'application/json'},body:'{}'
  });
  assert.equal(unauthorizedOpenai.status,401);
  assert.match(unauthorizedOpenai.headers.get('www-authenticate')??'',/oauth-protected-resource\/mcp\/openai/);
  assert.doesNotMatch(unauthorizedOpenai.headers.get('www-authenticate')??'',/invalid_token/,'missing bearer token should use the normal OAuth challenge');

  const rejectedOpenaiBearer=await fetch(`http://127.0.0.1:${port}/mcp/openai`,{
    method:'POST',headers:{host:'link2ai.example','content-type':'application/json',authorization:'Basic definitely-not-a-real-token'},body:'{}'
  });
  assert.equal(rejectedOpenaiBearer.status,401);
  assert.match(rejectedOpenaiBearer.headers.get('www-authenticate')??'',/error="invalid_token"/,'invalid bearer token should force the client to reauthorize');
  assert.match(rejectedOpenaiBearer.headers.get('www-authenticate')??'',/oauth-protected-resource\/mcp\/openai/);

  console.log('runtime smoke tests PASS');
}finally{
  child.kill();
  await Promise.race([
    new Promise(resolve=>child.once('exit',resolve)),
    new Promise(resolve=>setTimeout(resolve,3000))
  ]);
}
