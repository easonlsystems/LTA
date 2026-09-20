import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [api,keys,sql,main,source]=await Promise.all([
  readFile(new URL('../src/api/publicApi.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/api/apiKeys.ts',import.meta.url),'utf8'),
  readFile(new URL('../sql/008_public_api.sql',import.meta.url),'utf8'),
  readFile(new URL('../src/api/main.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/source/service.ts',import.meta.url),'utf8')
]);

assert.match(sql,/CREATE TABLE IF NOT EXISTS api_keys/);
assert.match(sql,/key_hash text NOT NULL UNIQUE/);
assert.match(sql,/revoked_at timestamptz/);
assert.doesNotMatch(sql,/plaintext|raw_key|key_secret text/i);

assert.match(keys,/l2ai_live_/);
assert.match(keys,/sha256\(key\)/);
assert.match(keys,/revoked_at IS NULL/);
assert.match(keys,/last_used_at=now\(\)/);

assert.match(api,/app\.post\('\/v1\/read'/);
assert.match(api,/app\.get\('\/v1\/jobs\/:jobId'/);
assert.match(api,/app\.get\('\/v1\/usage'/);
assert.match(api,/app\.get\('\/v1\/sources'/);
assert.match(api,/startTranscriptJob\(auth\.userId,url,\{refresh:body\.refresh===true,profile:'default'\}\)/);
assert.match(api,/getJobResult\(auth\.userId,jobId,'default'\)/);
assert.match(api,/source_completeness/);
assert.match(api,/canonical_url/);
assert.doesNotMatch(api,/mode\s*:/,'public API beta must not introduce a fast/partial mode by default');

assert.match(main,/registerPublicApiRoutes\(app\)/);
assert.match(source,/canonical_url\?: string/);
assert.match(source,/canonical_url:row\.normalized_url/);

console.log('public API beta schema tests PASS');
