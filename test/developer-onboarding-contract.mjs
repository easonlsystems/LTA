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
assert.doesNotMatch(main,/Simulated Claude conversation/,'general homepage comparison must not imply Link2AI only works with Claude');
assert.match(main,/Same AI assistant · Link2AI connected/);
assert.match(main,/specific claim and supports it with details from the caption and clip/,'homepage comparison should preserve the original With Link2AI Instagram answer');
assert.match(billing,/data-api-key-id/,'one-time API key page must expose its non-secret key id for lifecycle management');

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
