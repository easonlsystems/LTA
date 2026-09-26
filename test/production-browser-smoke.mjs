import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base=process.env.LTA_BASE_URL ?? 'https://api-production-0383e.up.railway.app';
const expected=process.env.LTA_EXPECTED_REVISION;
assert.ok(expected,'LTA_EXPECTED_REVISION is required');

const health=await fetch(base+'/healthz');
assert.equal(health.status,200,'/healthz must return 200');
const healthJson=await health.json();
assert.equal(healthJson.revision,expected,'live revision must match expected production SHA');

const routes=[
  ['/', 'Your AI got the link.'],
  ['/signup?return_to=%2Faccount', 'Create your LTA account.'],
  ['/sources', 'What LTA can read.']
];
const viewports=[
  ['desktop',{width:1440,height:900}],
  ['mobile',{width:390,height:844}]
];

await fs.mkdir('browser-smoke-artifacts',{recursive:true});
const results=[];
const browser=await chromium.launch({headless:true});
try{
  for(const [label,viewport] of viewports){
    const context=await browser.newContext({viewport,deviceScaleFactor:1});
    for(const [route,marker] of routes){
      const page=await context.newPage();
      const consoleErrors=[];
      const pageErrors=[];
      page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text());});
      page.on('pageerror',err=>pageErrors.push(String(err)));
      const response=await page.goto(base+route,{waitUntil:'domcontentloaded',timeout:45000});
      assert.ok(response,label+' '+route+': navigation response missing');
      assert.equal(response.status(),200,label+' '+route+': expected 200');
      await page.waitForLoadState('networkidle',{timeout:12000}).catch(()=>{});
      await page.locator('body').waitFor({state:'visible'});
      const bodyText=await page.locator('body').innerText();
      assert.ok(bodyText.includes(marker),label+' '+route+': missing marker '+marker);
      const metrics=await page.evaluate(()=>({
        innerWidth:window.innerWidth,
        scrollWidth:document.documentElement.scrollWidth,
        bodyScrollWidth:document.body.scrollWidth
      }));
      assert.ok(metrics.scrollWidth<=metrics.innerWidth+2,label+' '+route+': document overflows horizontally');
      assert.ok(metrics.bodyScrollWidth<=metrics.innerWidth+2,label+' '+route+': body overflows horizontally');
      assert.equal(pageErrors.length,0,label+' '+route+': page errors: '+pageErrors.join(' | '));
      assert.equal(consoleErrors.length,0,label+' '+route+': console errors: '+consoleErrors.join(' | '));

      if(route.startsWith('/signup')){
        assert.equal(await page.locator('main[data-auth-v2]').count(),1,label+': signup must use V2 auth surface');
        const bg=await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor);
        assert.ok(bg==='rgb(23, 20, 28)'||bg==='rgba(23, 20, 28, 1)',label+': signup body must use V2 dark background, got '+bg);
        assert.match(response.headers()['cache-control']??'',/no-store/,label+': signup must be no-store');
      }
      if(route==='/sources'){
        assert.ok(bodyText.includes('VIDEO + SOCIAL'),label+': sources must use current V2 copy');
        assert.ok(!bodyText.includes('Popular sources'),label+': stale sources copy must not render');
        assert.ok(!bodyText.includes('Other supported'),label+': stale sources copy must not render');
        assert.match(response.headers()['cache-control']??'',/no-cache|no-store/,label+': sources HTML must revalidate');
      }

      const safe=route.startsWith('/signup')?'signup':route==='/'?'home':'sources';
      const screenshot=path.join('browser-smoke-artifacts',label+'-'+safe+'.png');
      await page.screenshot({path:screenshot,fullPage:true});
      results.push({label,route,status:response.status(),metrics});
      await page.close();
    }
    await context.close();
  }
}finally{
  await browser.close();
}
await fs.writeFile('browser-smoke-artifacts/results.json',JSON.stringify({expected,health:healthJson,results},null,2));
console.log('PRODUCTION_BROWSER_SMOKE_PASS');
console.log(JSON.stringify({expected,routeChecks:results.length}));
