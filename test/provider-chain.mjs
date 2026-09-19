import assert from 'node:assert/strict';

process.env.NODE_ENV='test';
process.env.DATABASE_URL='postgres://link2ai:link2ai@127.0.0.1:9/link2ai';
process.env.PUBLIC_BASE_URL='https://link2ai.example';
process.env.APP_SECRET='test-secret-that-is-at-least-thirty-two-characters-long';

const {runProviderChain}=await import('../dist/src/resolvers/providerChain.js');
const {orderProviderAttempts,noteProviderFailure,resetProviderCircuitsForTests}=await import('../dist/src/resolvers/providerCircuit.js');
const {Link2AIError}=await import('../dist/src/util/errors.js');
const {pool}=await import('../dist/src/db/pool.js');

resetProviderCircuitsForTests();

{
  const calls=[];
  const telemetry=[];
  const result=await runProviderChain({
    platform:'youtube',operation:'metadata',
    attempts:[
      {name:'primary',family:'local:yt_dlp',run:async()=>{calls.push('primary');return 'ok';}},
      {name:'fallback',family:'external:media_default',run:async()=>{calls.push('fallback');return 'wrong';}}
    ],
    telemetry:async event=>{telemetry.push(event);}
  });
  assert.equal(result,'ok');
  assert.deepEqual(calls,['primary']);
  assert.deepEqual(telemetry.map(x=>[x.provider,x.family,x.outcome]),[['primary','local:yt_dlp','success']]);
}

{
  const calls=[];
  const telemetry=[];
  const result=await runProviderChain({
    platform:'instagram',operation:'audio',
    attempts:[
      {name:'primary',family:'local:yt_dlp',run:async()=>{calls.push('primary');throw new Link2AIError('PLATFORM_BLOCKED','blocked',502,true);}},
      {name:'fallback',family:'external:media_default',run:async()=>{calls.push('fallback');return 'audio.mp3';}}
    ],
    telemetry:async event=>{telemetry.push(event);}
  });
  assert.equal(result,'audio.mp3');
  assert.deepEqual(calls,['primary','fallback']);
  assert.deepEqual(telemetry.map(x=>[x.provider,x.family,x.outcome]),[
    ['primary','local:yt_dlp','failed'],
    ['fallback','external:media_default','success']
  ]);
}

{
  let fallbackCalled=false;
  await assert.rejects(
    runProviderChain({
      platform:'youtube',operation:'metadata',
      attempts:[
        {name:'primary',family:'local:yt_dlp',run:async()=>{throw new Link2AIError('LOGIN_REQUIRED','login',403,false);}},
        {name:'fallback',family:'external:media_default',run:async()=>{fallbackCalled=true;return 'should-not-run';}}
      ],
      telemetry:async()=>{}
    }),
    error=>error instanceof Link2AIError&&error.code==='LOGIN_REQUIRED'
  );
  assert.equal(fallbackCalled,false,'definitive access errors must not fan out to fallback providers');
}

{
  let fallbackCalled=false;
  const result=await runProviderChain({
    platform:'x',operation:'audio',
    attempts:[
      {
        name:'structured',family:'public:x_syndication',
        run:async()=>{throw new Link2AIError('DOWNLOAD_TOO_LARGE','full mp4 too large',413,false);},
        shouldFailover:error=>error instanceof Link2AIError&&error.code==='DOWNLOAD_TOO_LARGE'
      },
      {name:'audio_only',family:'local:yt_dlp',run:async()=>{fallbackCalled=true;return 'audio-only.mp3';}}
    ],
    telemetry:async()=>{}
  });
  assert.equal(result,'audio-only.mp3');
  assert.equal(fallbackCalled,true,'provider-specific failover rules must allow a cheaper/narrower fallback route');
}

{
  await assert.rejects(
    runProviderChain({
      platform:'x',operation:'audio',
      attempts:[
        {name:'primary',family:'public:x_syndication',run:async()=>{throw new Link2AIError('EXTRACTION_FAILED','first',502,true);}},
        {name:'fallback',family:'local:yt_dlp',run:async()=>{throw new Link2AIError('RATE_LIMITED','second',429,true);}}
      ],
      telemetry:async()=>{}
    }),
    error=>error instanceof Link2AIError&&error.code==='RATE_LIMITED',
    'when all eligible providers fail, surface the final provider error'
  );
}

{
  resetProviderCircuitsForTests();
  const attempts=[
    {name:'primary',family:'local:yt_dlp'},
    {name:'fallback',family:'external:media_default'}
  ];
  noteProviderFailure('youtube','metadata',attempts[0],true,1_000);
  noteProviderFailure('youtube','metadata',attempts[0],true,1_100);
  noteProviderFailure('youtube','metadata',attempts[0],true,1_200);
  assert.deepEqual(
    orderProviderAttempts('youtube','metadata',attempts,2_000).map(x=>x.name),
    ['fallback','primary'],
    'an open provider circuit must defer the unhealthy provider behind an independent route'
  );
  assert.deepEqual(
    orderProviderAttempts('youtube','metadata',attempts,122_000).map(x=>x.name),
    ['primary','fallback'],
    'after cooldown, the original provider must be allowed to probe again'
  );
}

await pool.end();
console.log('provider chain tests PASS');
