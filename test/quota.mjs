import assert from 'node:assert/strict';

Object.assign(process.env,{DATABASE_URL:'postgres://127.0.0.1:1/link2ai',PUBLIC_BASE_URL:'https://launch.example',APP_SECRET:'01234567890123456789012345678901'});
const [{pool},{reserveQuota,finalizeQuota}]=await Promise.all([import('../dist/src/db/pool.js'),import('../dist/src/quota/service.js')]);
const originalConnect=pool.connect.bind(pool);

function clientFor({ledger=false,reservationSeconds=120}={}){
  const queries=[];
  return {queries,release(){},async query(sql,params){
    const text=String(sql);queries.push({sql:text,params});
    if(text.includes('SELECT plan,trial_eligible'))return {rowCount:1,rows:[{plan:'basic',trial_eligible:true,admin_bonus_seconds:0,admin_bonus_videos:0}]};
    if(text.includes('FROM subscriptions'))return {rowCount:1,rows:[{current_period_start:new Date('2026-09-01Z'),current_period_end:new Date('2026-10-01Z')}]};
    if(text.includes('SELECT 1 FROM usage_ledger'))return {rowCount:ledger?1:0,rows:ledger?[{}]:[]};
    if(text.includes('FROM usage_ledger u'))return {rowCount:1,rows:[{seconds:'0',videos:'0'}]};
    if(text.includes('FROM quota_reservations r'))return {rowCount:1,rows:[{seconds:'0',videos:'0'}]};
    if(text.includes('SELECT seconds FROM quota_reservations'))return {rowCount:1,rows:[{seconds:reservationSeconds}]};
    return {rowCount:1,rows:[]};
  }};
}

try{
  const reserveClient=clientFor();pool.connect=async()=>reserveClient;
  await reserveQuota('user-1','job-1',2);
  assert.match(reserveClient.queries.find(q=>q.sql.includes('SELECT plan,trial_eligible')).sql,/FOR UPDATE/,'user row lock prevents concurrent overspend');
  const competing=reserveClient.queries.find(q=>q.sql.includes('FROM quota_reservations r'));
  assert.match(competing.sql,/job_id<>\$2/,'reconciliation must exclude the current reservation');
  const insert=reserveClient.queries.find(q=>q.sql.includes('INSERT INTO quota_reservations'));
  assert.equal(insert.params[2],120,'2 units persist as 120 compatibility seconds');

  const retryClient=clientFor({ledger:true});pool.connect=async()=>retryClient;
  await reserveQuota('user-1','job-1',2);
  assert.equal(retryClient.queries.some(q=>q.sql.includes('INSERT INTO quota_reservations')),false,'finalized retry must not reserve twice');

  const finalizeClient=clientFor({reservationSeconds:180});pool.connect=async()=>finalizeClient;
  await finalizeQuota('user-1','job-1');
  const ledgerInsert=finalizeClient.queries.find(q=>q.sql.includes('INSERT INTO usage_ledger'));
  assert.equal(ledgerInsert.params[2],180);
  assert.match(ledgerInsert.sql,/ON CONFLICT\(job_id\) DO NOTHING/,'finalization must remain idempotent');
  console.log('quota tests PASS');
}finally{pool.connect=originalConnect;await pool.end();}
