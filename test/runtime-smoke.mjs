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
  env:{...process.env,NODE_ENV:'production',PORT:String(port),DATABASE_URL:'postgres://127.0.0.1:1/link2ai',PUBLIC_BASE_URL:'https://link2ai.example',PUBLIC_BRAND_NAME:'LaunchBrand',RAILWAY_PUBLIC_DOMAIN:'internal.railway.local',APP_SECRET:'01234567890123456789012345678901',LEMONSQUEEZY_API_KEY:'lemon-secret-must-not-render',RESEND_API_KEY:'resend-secret-must-not-render',OPENAI_APPS_CHALLENGE:'review-challenge-token',REVIEWER_EMAIL:'reviewer@example.com',REVIEWER_PASSWORD:'this-is-a-long-review-password',FOUNDER_EMAIL:'founder@example.com'},
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
  for(const route of ['/','/connect','/support','/privacy','/terms']){
    const page=await fetch(`http://127.0.0.1:${port}${route}`,{headers:{host:'link2ai.example'}});
    assert.equal(page.status,200,`${route} should return 200`);
    const body=await page.text();
    assert.match(body,/LaunchBrand/);
    if(route==='/'){assert.match(body,/AI is smart\./);assert.match(body,/Until you give it a link\./);assert.match(body,/Try Link2AI free/);assert.match(body,/10 processing units · No card required · Failed reads cost 0/);assert.match(body,/Without Link2AI/);assert.match(body,/With Link2AI/);assert.match(body,/More than video links\./);assert.match(body,/Paste the link normally/);assert.match(body,/Try the link your AI just failed to read\./);assert.match(body,/No fixed link-count limit/);assert.match(body,/A product by Eason Systems/);assert.doesNotMatch(body,/V2 · public links → readable source context/);}
    if(route==='/connect'){assert.match(body,/Open Claude Connectors Directory/);assert.match(body,/href="\/connect\/start"/);assert.match(body,/target="_blank"/);assert.match(body,/Always available/);assert.doesNotMatch(body,/Add custom connector|Tools already loaded|Register automatically/);}
    assert.doesNotMatch(body,/lemon-secret-must-not-render|resend-secret-must-not-render/);
  }

  const start=await fetch(`http://127.0.0.1:${port}/start?from=hero`,{headers:{host:'link2ai.example'},redirect:'manual'});
  assert.equal(start.status,302);
  assert.equal(start.headers.get('location'),'/signup?return_to=%2Fconnect');

  const connectStart=await fetch(`http://127.0.0.1:${port}/connect/start`,{headers:{host:'link2ai.example'},redirect:'manual'});
  assert.equal(connectStart.status,302);
  const connectLocation=connectStart.headers.get('location')??'';
  assert.equal(connectLocation,'https://claude.ai/directory');

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
  assert.equal(crossSiteLogin.status,403,'browser auth POSTs must reject cross-site origins before touching account state');

  // node:fetch intentionally overwrites the Host header, so use node:http here to
  // exercise the real serving-host check instead of accidentally testing 127.0.0.1.
  const sameHostLogin=await rawPost('/auth/password/login',{
    host:'link2ai.example',origin:'https://link2ai.example','content-type':'application/x-www-form-urlencoded'
  },'email=x%40example.com&password=not-a-real-password&return_to=%2Faccount');
  assert.notEqual(sameHostLogin.status,403,'same-host browser POSTs must not be rejected because PUBLIC_BASE_URL differs from the serving host');

  const reverseProxyLogin=await rawPost('/auth/password/login',{
    host:'internal.railway.local',origin:'https://link2ai.example','content-type':'application/x-www-form-urlencoded'
  },'email=x%40example.com&password=not-a-real-password&return_to=%2Faccount');
  assert.notEqual(reverseProxyLogin.status,403,'canonical public origin must not be rejected when a reverse proxy presents a different backend Host');


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
  assert.match(pricingText,/500 processing units \/ month/);
  assert.match(pricingText,/2,000 processing units \/ month/);
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
  assert.match(loginText,/auth\/password\/login/);
  assert.match(loginText,/Create an account/);
  assert.match(loginText,/OpenAI reviewer access/);
  assert.match(loginText,/10 processing units free/);
  assert.match(loginText,/Failed or unsupported reads use 0 units/);
  assert.doesNotMatch(loginText,/3 links or 10 minutes free/);
  assert.doesNotMatch(loginText,/Continue free/);
  assert.doesNotMatch(loginText,/Send sign-in code/);
  assert.doesNotMatch(loginText,/this-is-a-long-review-password/);

  const signup=await fetch(`http://127.0.0.1:${port}/signup?return_to=%2Faccount`,{headers:{host:'link2ai.example'}});
  assert.equal(signup.status,200);
  const signupText=await signup.text();
  assert.match(signupText,/Create your Link2AI account/);
  assert.match(signupText,/auth\/password\/register/);
  assert.match(signupText,/At least 10 characters/);
  assert.match(signupText,/10 processing units free/);
  assert.match(signupText,/Continue to Claude setup/);
  assert.match(signupText,/Failed \/ unsupported reads use 0 units/);
  assert.match(signupText,/product by Eason Systems/);

  const oauthMetadata=await fetch(`http://127.0.0.1:${port}/.well-known/oauth-authorization-server`,{headers:{host:'link2ai.example'}});
  assert.equal(oauthMetadata.status,200);
  const oauthMetadataJson=await oauthMetadata.json();
  assert.deepEqual(oauthMetadataJson.scopes_supported,['link2ai:read','offline_access']);
  assert.equal(oauthMetadataJson.registration_endpoint,'https://link2ai.example/oauth/register');
  assert.equal('client_id_metadata_document_supported' in oauthMetadataJson,false,'Claude-first beta should prefer DCR over CIMD to avoid server-side claude.ai metadata fetch failures');

  const ready=await fetch(`http://127.0.0.1:${port}/readyz`,{headers:{host:'link2ai.example'}});
  assert.equal(ready.status,503);
  assert.deepEqual((await ready.json()).issues,['database unavailable']);

  const mcpOpaqueOrigin=await rawPost('/mcp',{
    host:'link2ai.example',origin:'null','sec-fetch-site':'same-origin','content-type':'application/json'
  },'{}');
  assert.equal(mcpOpaqueOrigin.status,403,'MCP must keep rejecting opaque browser origins even when site metadata says same-origin');

  const unauthorized=await fetch(`http://127.0.0.1:${port}/mcp`,{
    method:'POST',headers:{host:'link2ai.example','content-type':'application/json'},body:'{}'
  });
  assert.equal(unauthorized.status,401);
  assert.match(unauthorized.headers.get('www-authenticate')??'',/oauth-protected-resource\/mcp/);
  console.log('runtime smoke tests PASS');
}finally{
  child.kill();
  await Promise.race([
    new Promise(resolve=>child.once('exit',resolve)),
    new Promise(resolve=>setTimeout(resolve,3000))
  ]);
}
