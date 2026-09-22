import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

Object.assign(process.env,{DATABASE_URL:'postgres://127.0.0.1:1/link2ai',PUBLIC_BASE_URL:'https://launch.example',APP_SECRET:'01234567890123456789012345678901'});
const [{pool},{saveCache,findCache}]=await Promise.all([
  import('../dist/src/db/pool.js'),import('../dist/src/worker/cache.js')
]);
const migration=await readFile(new URL('../sql/012_immutable_transcript_cache.sql',import.meta.url),'utf8');
assert.match(migration,/DROP CONSTRAINT IF EXISTS transcript_cache_platform_canonical_media_id_language_key/);
const originalQuery=pool.query.bind(pool);
const rows=[];
let nextId=0;
pool.query=async(sql,params)=>{
  const statement=String(sql);
  if(statement.includes('INSERT INTO transcript_cache')){
    // Model the old PostgreSQL uniqueness conflict, including its destructive
    // update, so the test fails if the upsert is reintroduced.
    const existing=rows.find(row=>row.platform===params[0]&&row.canonical_media_id===params[1]&&row.language===params[2]);
    const row={id:`cache-${++nextId}`,platform:params[0],canonical_media_id:params[1],language:params[2],transcript:params[7],duration_seconds:params[6],source:params[9],usage_units:params[14],visual_assets:JSON.parse(params[20]),expires_at:new Date(Date.now()+3600000)};
    if(statement.includes('ON CONFLICT')&&existing){Object.assign(existing,row,{id:existing.id});return {rowCount:1,rows:[existing]};}
    rows.push(row);return {rowCount:1,rows:[row]};
  }
  if(statement.includes('SELECT * FROM transcript_cache'))return {rowCount:rows.length?1:0,rows:rows.length?[rows.at(-1)]:[]};
  throw new Error(`Unexpected SQL: ${statement}`);
};
const payload=text=>({platform:'web',canonicalMediaId:'web_same',sourceUrl:'https://example.org/article',durationSeconds:0,language:'und',transcript:text,segments:[],source:'page',completeness:{truncated:false,extractedTokenEstimate:10,usageUnits:1}});
try{
  const first=await saveCache(payload('Original article text'));
  const second=await saveCache(payload('Changed article text'));
  assert.notEqual(second.id,first.id,'refresh must create a new cache version');
  assert.equal(rows.find(row=>row.id===first.id)?.transcript,'Original article text','a completed job pinned to the first cache id must keep its result');
  assert.equal((await findCache('web','web_same','und'))?.id,second.id,'new reads should use the latest cache version');
  console.log('cache versioning tests PASS');
}finally{pool.query=originalQuery;await pool.end();}
