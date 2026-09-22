import assert from 'node:assert/strict';

Object.assign(process.env,{
  DATABASE_URL:'postgres://127.0.0.1:1/link2ai',PUBLIC_BASE_URL:'https://launch.example',
  APP_SECRET:'01234567890123456789012345678901',MCP_INLINE_WAIT_MS:'0'
});
const [{pool},{startTranscriptJob}]=await Promise.all([
  import('../dist/src/db/pool.js'),import('../dist/src/source/service.js')
]);
const originalQuery=pool.query.bind(pool);
const calls=[];
pool.query=async(sql,params=[])=>{
  const q=String(sql);calls.push(q);
  if(q.includes('INSERT INTO product_activation_events')||q.includes('INSERT INTO source_access_events'))return {rowCount:1,rows:[]};
  if(q.includes('SELECT j.id FROM transcript_jobs j WHERE'))return {rowCount:0,rows:[]};
  if(q.includes('SELECT j.id FROM transcript_jobs j JOIN transcript_cache'))return {rowCount:0,rows:[]};
  if(q==='SELECT plan FROM users WHERE id=$1')return {rowCount:1,rows:[{plan:'trial'}]};
  if(q.includes('INSERT INTO transcript_jobs')){
    // A worker claims the newly inserted row before the API returns. The API
    // must not independently finish a shared-cache result for this same job.
    return {rowCount:1,rows:[{id:'job-claimed-by-worker'}]};
  }
  throw Error(`API attempted an unowned job operation: ${q}`);
};
try{
  const result=await startTranscriptJob('user-1','https://news.ycombinator.com/item?id=8863');
  assert.equal(result.status,'processing');
  assert.equal(result.job_id,'job-claimed-by-worker');
  assert.ok(calls.some(q=>q.includes('INSERT INTO transcript_jobs')));
  assert.equal(calls.some(q=>q.includes('UPDATE transcript_jobs')||q.includes('usage_ledger')||q.includes('quota_reservations')),false);
  console.log('cache queue ownership test PASS');
}finally{pool.query=originalQuery;await pool.end();}
