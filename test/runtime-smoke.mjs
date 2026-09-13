import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';

const probe=net.createServer();
await new Promise((resolve,reject)=>probe.once('error',reject).listen(0,'127.0.0.1',resolve));
const address=probe.address();
assert.ok(address&&typeof address==='object');
const port=address.port;
await new Promise(resolve=>probe.close(resolve));

const child=spawn(process.execPath,['dist/src/api/main.js'],{
  env:{...process.env,NODE_ENV:'production',PORT:String(port),DATABASE_URL:'postgres://127.0.0.1:1/link2ai',PUBLIC_BASE_URL:'https://link2ai.example',PUBLIC_BRAND_NAME:'LaunchBrand',APP_SECRET:'01234567890123456789012345678901',LEMONSQUEEZY_API_KEY:'lemon-secret-must-not-render',RESEND_API_KEY:'resend-secret-must-not-render'},
  stdio:['ignore','pipe','pipe']
});
let output='';
child.stdout.on('data',chunk=>{output+=chunk});
child.stderr.on('data',chunk=>{output+=chunk});

try{
  const deadline=Date.now()+10_000;
  let health;
  while(Date.now()<deadline){
    try{health=await fetch(`http://127.0.0.1:${port}/healthz`,{headers:{host:'link2ai.example'}});break;}
    catch{await new Promise(resolve=>setTimeout(resolve,100));}
  }
  assert.ok(health,`API did not start: ${output}`);
  assert.equal(health.status,200);
  assert.equal((await health.json()).ok,true);

  for(const route of ['/','/pricing','/connect','/privacy','/terms']){
    const page=await fetch(`http://127.0.0.1:${port}${route}`,{headers:{host:'link2ai.example'}});
    assert.equal(page.status,200);
    const body=await page.text();
    assert.match(body,/LaunchBrand/);
    assert.doesNotMatch(body,/lemon-secret-must-not-render|resend-secret-must-not-render/);
  }

  const oauthMetadata=await fetch(`http://127.0.0.1:${port}/.well-known/oauth-authorization-server`,{headers:{host:'link2ai.example'}});
  assert.equal(oauthMetadata.status,200);
  assert.deepEqual((await oauthMetadata.json()).scopes_supported,['link2ai:read','offline_access']);

  const ready=await fetch(`http://127.0.0.1:${port}/readyz`,{headers:{host:'link2ai.example'}});
  assert.equal(ready.status,503);
  assert.deepEqual((await ready.json()).issues,['database unavailable']);

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
