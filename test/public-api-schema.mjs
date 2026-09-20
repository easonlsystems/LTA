import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const api=await readFile(new URL('../src/api/publicApi.ts',import.meta.url),'utf8');
const sql=await readFile(new URL('../sql/010_public_api.sql',import.meta.url),'utf8');
const billing=await readFile(new URL('../src/billing/routes.ts',import.meta.url),'utf8');
const main=await readFile(new URL('../src/api/main.ts',import.meta.url),'utf8');

assert.match(sql,/CREATE TABLE IF NOT EXISTS api_keys/);
assert.match(sql,/key_hash text NOT NULL UNIQUE/);
assert.match(sql,/revoked_at timestamptz/);
assert.match(api,/l2ai_live_/);
assert.match(api,/sha256\(key\)/);
assert.match(api,/app\.post\('\/v1\/read'/);
assert.match(api,/app\.get\('\/v1\/jobs\/:jobId'/);
assert.match(api,/app\.get\('\/v1\/usage'/);
assert.match(api,/app\.get\('\/v1\/sources'/);
assert.match(api,/startTranscriptJob\(auth\.userId,url/);
assert.match(api,/getJobResult\(auth\.userId,jobId/);
assert.match(billing,/Create API key/);
assert.match(billing,/full key is shown only once/i);
assert.match(main,/registerPublicApiRoutes\(app\)/);
assert.match(main,/href="\/developers"/);
assert.match(main,/Public URL in/);
assert.match(main,/AI-ready source context out/);
assert.doesNotMatch(sql,/key_plain|secret_plain|raw_key/i);

console.log('Public API beta schema tests PASS');
