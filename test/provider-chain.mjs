import assert from 'node:assert/strict';

process.env.NODE_ENV='test';
process.env.DATABASE_URL='postgres://link2ai:link2ai@127.0.0.1:9/link2ai';
process.env.PUBLIC_BASE_URL='https://link2ai.example';
process.env.APP_SECRET='test-secret-that-is-at-least-thirty-two-characters-long';

const {runProviderChain}=await import('../dist/src/resolvers/providerChain.js');
const {Link2AIError}=await import('../dist/src/util/errors.js');
const {pool}=await import('../dist/src/db/pool.js');

{
  const calls=[];
  const telemetry=[];
  const result=await runProviderChain({
    platform:'youtube',operation:'metadata',
    attempts:[
      {name:'primary',run:async()=>{calls.push('primary');return 'ok';}},
      {name:'fallback',run:async()=>{calls.push('fallback');return 'wrong';}}
    ],
    telemetry:async event=>{telemetry.push(event);}
  });
  assert.equal(result,'ok');
  assert.deepEqual(calls,['primary']);
  assert.deepEqual(telemetry.map(x=>[x.provider,x.outcome]),[['primary','success']]);
}

{
  const calls=[];
  const telemetry=[];
  const result=await runProviderChain({
    platform:'instagram',operation:'audio',
    attempts:[
      {name:'primary',run:async()=>{calls.push('primary');throw new Link2AIError('PLATFORM_BLOCKED','blocked',502,true);}},
      {name:'fallback',run:async()=>{calls.push('fallback');return 'audio.mp3';}}
    ],
    telemetry:async event=>{telemetry.push(event);}
  });
  assert.equal(result,'audio.mp3');
  assert.deepEqual(calls,['primary','fallback']);
  assert.deepEqual(telemetry.map(x=>[x.provider,x.outcome]),[['primary','failed'],['fallback','success']]);
}

{
  let fallbackCalled=false;
  await assert.rejects(
    runProviderChain({
      platform:'youtube',operation:'metadata',
      attempts:[
        {name:'primary',run:async()=>{throw new Link2AIError('LOGIN_REQUIRED','login',403,false);}},
        {name:'fallback',run:async()=>{fallbackCalled=true;return 'should-not-run';}}
      ],
      telemetry:async()=>{}
    }),
    error=>error instanceof Link2AIError&&error.code==='LOGIN_REQUIRED'
  );
  assert.equal(fallbackCalled,false,'definitive access errors must not fan out to fallback providers');
}

{
  await assert.rejects(
    runProviderChain({
      platform:'x',operation:'audio',
      attempts:[
        {name:'primary',run:async()=>{throw new Link2AIError('EXTRACTION_FAILED','first',502,true);}},
        {name:'fallback',run:async()=>{throw new Link2AIError('RATE_LIMITED','second',429,true);}}
      ],
      telemetry:async()=>{}
    }),
    error=>error instanceof Link2AIError&&error.code==='RATE_LIMITED',
    'when all eligible providers fail, surface the final provider error'
  );
}

await pool.end();
console.log('provider chain tests PASS');
