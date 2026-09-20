import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [docs,main,billing,cert,workflow]=await Promise.all([
  readFile(new URL('../src/api/developerDocs.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/api/main.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/billing/routes.ts',import.meta.url),'utf8'),
  readFile(new URL('./production-authenticated-cert.mjs',import.meta.url),'utf8'),
  readFile(new URL('../.github/workflows/production-authenticated-certification.yml',import.meta.url),'utf8')
]);

for(const required of [
  'Authorization: Bearer','POST /v1/read','GET /v1/jobs/{id}','GET /v1/usage','GET /v1/sources',
  '202 processing','200 completed','401','402','422','retry_after_seconds','retryable',
  'canonical_url','source_completeness','truncation_reason','content_sections_truncated',
  'metadata','evidence','units_used','remaining_usage_units','refresh','JavaScript','Python'
])assert.ok(docs.includes(required),`developer docs must explain ${required}`);

assert.match(docs,/id[^]*job_id[^]*compatibility alias/,'job identifier contract must be explicit');
assert.match(docs,/Failed, unsupported, private, login-required, empty, or inaccessible reads consume/);
assert.match(docs,/one unit per started processed minute/);
assert.match(docs,/roughly one unit per 2,500 estimated source tokens/);
assert.match(docs,/cache hits[^]*must not double-charge/);
assert.match(main,/siteShell\(developerDocs\(base\)/);
assert.doesNotMatch(main,/sim-answer sim-fail show/,'homepage comparison must not preload the completed failure state');
assert.match(main,/id="sim-comparison-panels"[^>]*hidden/,'homepage comparison must stay closed before interaction');
assert.match(main,/resetDemo\(false,false\)/,'initial homepage state must wait for the user to run the comparison');
assert.doesNotMatch(main,/Simulated Claude conversation/,'general homepage comparison must not imply LTA only works with Claude');
assert.match(main,/Same AI assistant · LTA connected/);
assert.match(main,/specific claim and supports it with details from the caption and clip/,'homepage comparison should preserve the original With LTA Instagram answer');
assert.match(billing,/data-api-key-id/,'one-time API key page must expose its non-secret key id for lifecycle management');
assert.match(docs,/Give your app the source\./,'developer docs should lead with product value, not the raw contract');
assert.match(docs,/From zero to source text in three steps\./,'developer docs should expose a short first-run path');
assert.match(docs,/You do not need to learn the whole contract before making your first request\./,'advanced protocol details should not block first use');
assert.match(docs,/LTA generates the secret for you/,'docs must make server-generated API keys explicit');
assert.match(billing,/Key name/,'account API key form must label the user input as a key name');
assert.match(billing,/Generate API key/,'account should present API key creation as server generation');
assert.match(billing,/This is only a label so you know where the key is used/,'account must explain that the input is not the secret');
assert.match(billing,/Your API key is ready\./,'one-time key screen should read as a product handoff');
assert.match(billing,/copy-api-key/,'one-time key screen should offer a copy action');
assert.doesNotMatch(billing,/Claude and API reads share the same jobs/,'account API copy must not imply a Claude-only product');
assert.match(docs,/I just want LTA inside an AI/,'developer docs must tell non-developers they do not need the API');
assert.match(docs,/No API key needed/,'developer docs must clearly separate connected-AI use from Developer API use');
assert.match(docs,/Windows PowerShell/,'quickstart must include a runnable Windows path');
assert.match(docs,/Invoke-RestMethod/,'PowerShell quickstart must show the actual first request');
assert.match(billing,/Do you need an API key\?/,'account must explain whether the Developer API is relevant');
assert.match(billing,/I just want LTA in an AI/,'account must route ordinary AI users away from API key creation');
assert.match(billing,/What do I do with this\?/,'one-time key screen must explain the next action');
assert.match(billing,/PASTE_YOUR_KEY_HERE/,'one-time key screen must include a directly runnable terminal example');

for(const required of ['/auth/reviewer','/account/api-keys','/v1/usage','/v1/sources','/v1/read','/v1/jobs/','/account/api-keys/revoke']){
  assert.ok(cert.includes(required),`production cert must exercise ${required}`);
}
assert.ok(!cert.includes("web('/auth/password/login'")&&!cert.includes('web("/auth/password/login"'),'production certification must remain compatible with Google-enabled deployments');
assert.match(cert,/headers\.set\('origin',base\)/,'browser-form POSTs must satisfy production same-origin protection');
assert.match(cert,/revoked\.response\.status,401/);
assert.doesNotMatch(cert,/console\.log\([^)]*(apiKey|password|cookie)/i,'certification must never log credentials');
assert.match(workflow,/workflow_dispatch/);
assert.match(workflow,/secrets\.LINK2AI_CERT_EMAIL/);
assert.match(workflow,/secrets\.LINK2AI_CERT_PASSWORD/);
assert.match(workflow,/LINK2AI_EXPECTED_REVISION:\s*\$\{\{\s*github\.sha\s*\}\}/,'authenticated production workflow must certify the dispatched revision');
assert.match(cert,/data\?\.revision===expectedRevision/,'authenticated API lifecycle must wait for the exact production revision');

console.log('developer onboarding and authenticated certification contract tests PASS');
