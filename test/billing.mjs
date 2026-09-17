import assert from 'node:assert/strict';
import crypto from 'node:crypto';

Object.assign(process.env,{
  DATABASE_URL:'postgres://127.0.0.1:1/link2ai',
  PUBLIC_BASE_URL:'https://launch.example',
  APP_SECRET:'01234567890123456789012345678901',
  LEMONSQUEEZY_API_KEY:'test-api-key',
  LEMONSQUEEZY_WEBHOOK_SECRET:'webhook-secret',
  LEMONSQUEEZY_STORE_ID:'123',
  LEMONSQUEEZY_BASIC_VARIANT_ID:'456',
  LEMONSQUEEZY_PRO_VARIANT_ID:'789',
  LEMONSQUEEZY_TEST_MODE:'true'
});

const [{pool},{createCheckoutSession,processLemonEvent,verifyLemonSignature}]=await Promise.all([
  import('../dist/src/db/pool.js'),
  import('../dist/src/billing/lemon.js')
]);

const originalQuery=pool.query.bind(pool);
const originalConnect=pool.connect.bind(pool);
const originalFetch=globalThis.fetch;

try{
  const poolQueries=[];
  pool.query=async(sql,params)=>{
    poolQueries.push({sql:String(sql),params});
    if(String(sql).includes('SELECT email FROM users'))return {rowCount:1,rows:[{email:'person@example.com'}]};
    if(String(sql).includes('SELECT provider_subscription_id,plan'))return {rowCount:0,rows:[]};
    return {rowCount:1,rows:[]};
  };
  let checkoutRequest;
  globalThis.fetch=async(url,init)=>{
    checkoutRequest={url:String(url),init,body:JSON.parse(String(init.body))};
    return new Response(JSON.stringify({data:{attributes:{url:'https://store.example/checkout/signed'}}}),{status:201});
  };
  const checkout=await createCheckoutSession('user-1','pro','job-1');
  assert.equal(checkout,'https://store.example/checkout/signed');
  assert.equal(checkoutRequest.url,'https://api.lemonsqueezy.com/v1/checkouts');
  assert.deepEqual(checkoutRequest.body.data.relationships,{
    store:{data:{type:'stores',id:'123'}},variant:{data:{type:'variants',id:'789'}}
  });
  assert.deepEqual(checkoutRequest.body.data.attributes.checkout_data.custom,{user_id:'user-1',plan:'pro',resume_job_id:'job-1'});
  assert.equal(checkoutRequest.body.data.attributes.product_options.redirect_url,'https://launch.example/billing/success?resume_job_id=job-1');
  assert.equal(checkoutRequest.body.data.attributes.test_mode,true);
  assert.ok(poolQueries.some(q=>q.sql.includes('INSERT INTO billing_resume_intents')));

  const raw='{"data":{"id":"sub-1"}}';
  const signature=crypto.createHmac('sha256','webhook-secret').update(raw).digest('hex');
  assert.equal(verifyLemonSignature(raw,signature),true);
  assert.equal(verifyLemonSignature(`${raw} `,signature),false);
  assert.equal(verifyLemonSignature(raw,'not-hex'),false);

  const queries=[];
  let existingOwner=null;
  const fakeClient={
    async query(sql,params){
      const text=String(sql);queries.push({sql:text,params});
      if(text.includes('SELECT user_id,plan,status,provider_event_at'))return existingOwner?{rowCount:1,rows:[{user_id:existingOwner,plan:'basic',status:'active',provider_event_at:new Date('2026-02-01T00:00:00Z')}]}:{rowCount:0,rows:[]};
      if(text.includes('SELECT plan,status FROM subscriptions'))return {rowCount:1,rows:[{plan:'basic',status:'past_due'}]};
      return {rowCount:1,rows:[]};
    },
    release(){}
  };
  pool.connect=async()=>fakeClient;
  const event={
    meta:{event_name:'subscription_updated',custom_data:{user_id:'user-1',plan:'basic',resume_job_id:'job-1'}},
    data:{type:'subscriptions',id:'sub-1',attributes:{variant_id:456,status:'past_due',renews_at:'2026-03-31T12:00:00Z',billing_anchor:31,updated_at:'2026-03-01T00:00:00Z',test_mode:true}}
  };
  await processLemonEvent(event);
  assert.equal(queries[0].sql,'BEGIN');
  assert.match(queries[1].sql,/pg_advisory_xact_lock/);
  const upsert=queries.find(q=>q.sql.includes('INSERT INTO subscriptions'));
  assert.ok(upsert);
  assert.equal(upsert.params[4].toISOString(),'2026-02-28T12:00:00.000Z');
  assert.ok(queries.some(q=>q.sql.includes("SET status='queued'")&&q.sql.includes("status='awaiting_payment'")),'past_due access must resume eligible waiting jobs');

  queries.length=0;existingOwner='original-user';
  await processLemonEvent({...event,meta:{...event.meta,custom_data:{...event.meta.custom_data,user_id:'attacker-user'}},data:{...event.data,attributes:{...event.data.attributes,updated_at:'2026-03-02T00:00:00Z'}}});
  const ownerUpsert=queries.find(q=>q.sql.includes('INSERT INTO subscriptions'));
  assert.equal(ownerUpsert.params[0],'original-user','signed webhook custom data must not rebind an existing subscription owner');

  queries.length=0;existingOwner=null;
  await processLemonEvent({...event,data:{...event.data,attributes:{...event.data.attributes,test_mode:false}}});
  assert.equal(queries.some(q=>q.sql.includes('INSERT INTO subscriptions')),false,'live/test webhook modes must not cross');
  console.log('billing tests PASS');
}finally{
  pool.query=originalQuery;
  pool.connect=originalConnect;
  globalThis.fetch=originalFetch;
  await pool.end();
}
