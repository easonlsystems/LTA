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
  ['/connect', 'Finish with one real read'],
  ['/sources', 'What LTA can read.'],
  ['/pricing', 'Try the link your AI just failed to read.'],
  ['/developers', 'Use LTA through MCP or REST.']
];
const viewports=[
  ['desktop',{width:1440,height:900}],
  ['mobile',{width:390,height:844}]
];

await fs.mkdir('browser-smoke-artifacts',{recursive:true});
const results=[];
const browser=await chromium.launch({headless:true});
try{
  for(const pair of viewports){
    const label=pair[0];
    const viewport=pair[1];
    const context=await browser.newContext({viewport,deviceScaleFactor:1});
    for(const routePair of routes){
      const route=routePair[0];
      const marker=routePair[1];
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
        bodyScrollWidth:document.body.scrollWidth,
        bodyHeight:document.body.scrollHeight
      }));
      assert.ok(metrics.scrollWidth<=metrics.innerWidth+2,label+' '+route+': document overflows horizontally');
      assert.ok(metrics.bodyScrollWidth<=metrics.innerWidth+2,label+' '+route+': body overflows horizontally');
      assert.equal(pageErrors.length,0,label+' '+route+': page errors: '+pageErrors.join(' | '));
      assert.equal(consoleErrors.length,0,label+' '+route+': console errors: '+consoleErrors.join(' | '));

      let comparison=null;
      if(route==='/'){
        const button=page.locator('#sim-run');
        const panels=page.locator('#sim-comparison-panels');
        assert.equal(await button.getAttribute('aria-expanded'),'false',label+': comparison starts collapsed');
        assert.equal(await panels.getAttribute('hidden'),'',label+': comparison panels start hidden');
        const heroTopBefore=await page.locator('.signal-intro h1').evaluate(el=>el.getBoundingClientRect().top);
        await button.click();
        await page.waitForFunction(()=>document.querySelector('#sim-run')?.getAttribute('aria-expanded')==='true');
        await page.waitForTimeout(2400);
        assert.equal(await panels.getAttribute('hidden'),null,label+': comparison panels must open');
        assert.equal(await button.getAttribute('aria-expanded'),'true',label+': comparison button must expose expanded state');
        assert.ok(await page.locator('#sim-right-answer.show').isVisible(),label+': LTA answer must render');
        assert.ok(await page.locator('#sim-left-answer.show').isVisible(),label+': without-LTA answer must render');
        assert.ok(await page.locator('#sim-conclusion.show').isVisible(),label+': comparison conclusion must render');
        const rightAnswer=await page.locator('#sim-right-answer').innerText();
        assert.ok(rightAnswer.includes('Marcus Lemonis'),label+': recorded Instagram result must render');
        const heroTopAfter=await page.locator('.signal-intro h1').evaluate(el=>el.getBoundingClientRect().top);
        assert.ok(Math.abs(heroTopAfter-heroTopBefore)<=2,label+': hero shifted vertically during comparison');
        const afterMetrics=await page.evaluate(()=>({innerWidth:window.innerWidth,scrollWidth:document.documentElement.scrollWidth}));
        assert.ok(afterMetrics.scrollWidth<=afterMetrics.innerWidth+2,label+': comparison introduces horizontal overflow');
        comparison={heroTopBefore,heroTopAfter,rightAnswer:rightAnswer.slice(0,240)};
      }

      const safe=route==='/'?'home':route.slice(1);
      const screenshot=path.join('browser-smoke-artifacts',label+'-'+safe+'.png');
      await page.screenshot({path:screenshot,fullPage:true});
      results.push({label,route,status:response.status(),metrics,comparison});
      await page.close();
    }
    await context.close();
  }
}finally{
  await browser.close();
}
await fs.writeFile('browser-smoke-artifacts/results.json',JSON.stringify({expected,health:healthJson,results},null,2));
console.log('PRODUCTION_BROWSER_SMOKE_PASS');
console.log(JSON.stringify({expected,routeChecks:results.length,viewports:viewports.map(pair=>({label:pair[0],width:pair[1].width,height:pair[1].height}))}));
