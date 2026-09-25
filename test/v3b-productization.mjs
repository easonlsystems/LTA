import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [billing,main,source,keys,docs]=await Promise.all([
  readFile(new URL('../src/billing/routes.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/api/main.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/source/service.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/api/apiKeys.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/api/developerDocs.ts',import.meta.url),'utf8')
]);

assert.match(billing,/Developer API/);
assert.match(billing,/Generate API key/);
assert.match(billing,/full key is shown once and cannot be viewed again/i);
assert.match(billing,/\/account\/api-keys\/revoke/);
assert.match(billing,/>Delete<\/button>/);
assert.doesNotMatch(billing,/>Revoke<\/button>/);
assert.match(billing,/Recent reads/);
assert.match(billing,/\/account\/jobs\/:jobId/);
assert.match(billing,/j\.id=\$1 AND j\.user_id=\$2/,'job detail must stay scoped to the authenticated user');
assert.match(billing,/usage\.remaining_usage_units/,'dashboard must use authoritative processing-unit accounting');
assert.match(billing,/Units required/,'job detail must show the processing units required for quota-blocked reads');
assert.match(source,/required_usage_units/,'quota-blocked source results must expose the units required');
assert.match(source,/needs \$\{required\} processing units/,'quota guidance must tell users how many units the source needs when known');

assert.match(main,/app\.get\('\/developers'/);
assert.match(docs,/POST \/v1\/read/);
assert.match(docs,/Remote MCP/);
assert.match(docs,/Authorization: Bearer &lt;API_KEY&gt;/);
assert.doesNotMatch(docs,/GET \/v1\/jobs\/\{id\}|Windows PowerShell|JavaScript and Python/);
assert.match(main,/href="\/developers"/);
assert.match(main,/API-key hashes and non-secret key prefixes/);

assert.match(source,/Open LTA → Account/,'quota guidance must give a branded account next action');
assert.doesNotMatch(source,/PUBLIC_BASE_URL[^\n]*\/account|\/account in your browser/,'quota guidance must not expose the raw production host');

assert.match(keys,/key_hash/);
assert.doesNotMatch(keys,/INSERT INTO api_keys\([^)]*key[^_h]/i,'API key persistence must not store plaintext secrets');

console.log('V3B productization tests PASS');
