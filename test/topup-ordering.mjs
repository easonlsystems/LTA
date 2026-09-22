import assert from 'node:assert/strict';

Object.assign(process.env,{
  DATABASE_URL:'postgres://127.0.0.1:1/link2ai',PUBLIC_BASE_URL:'https://launch.example',
  APP_SECRET:'01234567890123456789012345678901',LEMONSQUEEZY_TOPUP_500_VARIANT_ID:'900',
  LEMONSQUEEZY_TOPUP_1500_VARIANT_ID:'901',LEMONSQUEEZY_TEST_MODE:'true'
});
const [{pool},{processLemonEvent}]=await Promise.all([
  import('../dist/src/db/pool.js'),import('../dist/src/billing/lemon.js')
]);
const originalConnect=pool.connect.bind(pool);
const originalQuery=pool.query.bind(pool);
let balance=0;
const purchases=new Map();
const refunds=new Map();
const observations=new Map();
const client={
  async query(sql,p=[]){
    const q=String(sql);
    if(q==='BEGIN'||q==='COMMIT'||q==='ROLLBACK'||q.includes('pg_advisory_xact_lock'))return {rowCount:1,rows:[]};
    if(q.startsWith('SELECT 1 FROM users'))return {rowCount:1,rows:[{}]};
    if(q.startsWith('SELECT pack,user_id,refunded_cents FROM topup_refund_observations')){
      const row=observations.get(p[0]);return {rowCount:Number(Boolean(row)),rows:row?[row]:[]};
    }
    if(q.startsWith('INSERT INTO topup_refund_observations')){
      const old=observations.get(p[0]);
      if(old&&(old.pack!==p[1]||(old.user_id&&p[2]&&old.user_id!==p[2])))return {rowCount:0,rows:[]};
      observations.set(p[0],{pack:p[1],user_id:old?.user_id??p[2],refunded_cents:Math.max(old?.refunded_cents??0,p[3])});
      return {rowCount:1,rows:[]};
    }
    if(q.startsWith('SELECT id,user_id,units_delta')){
      const row=purchases.get(p[0]);return {rowCount:Number(Boolean(row)),rows:row?[row]:[]};
    }
    if(q.startsWith('INSERT INTO paid_unit_transactions')){
      const key=p[2];
      if(q.includes("'topup_purchase'")){
        if(purchases.has(key))return {rowCount:0,rows:[]};
        purchases.set(key,{id:key,user_id:p[0],units_delta:p[1],provider_total_cents:p[4],provider_refunded_cents:p[5]});
      }else if(q.includes("'topup_refund'")){
        if(refunds.has(key))return {rowCount:0,rows:[]};
        refunds.set(key,{user_id:p[0],units_delta:p[1]});
      }else throw Error(`Unexpected transaction: ${q}`);
      return {rowCount:1,rows:[{id:key}]};
    }
    if(q.startsWith('UPDATE paid_unit_transactions SET provider_refunded_cents')){
      purchases.get(p[0]).provider_refunded_cents=p[1];return {rowCount:1,rows:[]};
    }
    if(q.includes('SET paid_rollover_seconds=paid_rollover_seconds+$2')){
      balance+=p[1];return {rowCount:1,rows:[]};
    }
    if(q.includes('SET paid_rollover_seconds=GREATEST(0,paid_rollover_seconds-$2)')){
      balance=Math.max(0,balance-p[1]);return {rowCount:1,rows:[]};
    }
    if(q.startsWith('UPDATE transcript_jobs'))return {rowCount:0,rows:[]};
    throw Error(`Unexpected query: ${q}`);
  },release(){}
};
pool.connect=async()=>client;
pool.query=async()=>{throw Error('Top-up webhook must not release a founding slot.');};
function event(name,id,refundedAmount=0,custom={user_id:'user-1',purpose:'topup',topup_pack:'500'}){
  return {meta:{event_name:name,custom_data:custom},data:{type:'orders',id,attributes:{
    status:'paid',test_mode:true,total:500,refunded_amount:refundedAmount,first_order_item:{variant_id:900}
  }}};
}
try{
  await processLemonEvent(event('order_refunded','before',500));
  assert.equal(balance,0,'refund before purchase cannot change wallet');
  await processLemonEvent(event('order_created','before'));
  assert.equal(balance,0,'later paid event must not credit fully refunded order');
  assert.equal(purchases.get('lemonsqueezy:order:before').provider_refunded_cents,500);
  assert.equal(refunds.get('lemonsqueezy:order:before:refund:500').units_delta,-500);
  await processLemonEvent(event('order_created','before'));
  assert.equal(balance,0,'duplicate paid event must remain idempotent');

  await processLemonEvent(event('order_refunded','partial',200));
  await processLemonEvent(event('order_created','partial'));
  assert.equal(balance,300*60,'paid event must credit only the unrefunded units');
  await processLemonEvent(event('order_refunded','partial',350));
  assert.equal(balance,150*60,'later cumulative refund must subtract only its delta');
  await processLemonEvent(event('order_refunded','partial',350));
  await processLemonEvent(event('order_refunded','partial',200));
  assert.equal(balance,150*60,'replayed and stale refunds must not subtract again');

  const noVariantRefund=event('order_refunded','without-variant',500);
  delete noVariantRefund.data.attributes.first_order_item;
  await processLemonEvent(noVariantRefund);
  await processLemonEvent(event('order_created','without-variant'));
  assert.equal(balance,150*60,'refund custom data must persist before purchase even if the refund omits variant details');

  await processLemonEvent(event('order_created','no-purpose',0,{user_id:'user-1'}));
  await processLemonEvent(event('order_refunded','no-purpose',500,{user_id:'user-1'}));
  assert.equal(balance,150*60,'known top-up variant must route refunds even without custom purpose');
  console.log('top-up ordering tests PASS');
}finally{
  pool.connect=originalConnect;pool.query=originalQuery;await pool.end();
}
