import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [docs,main,billing,apiKeys,cert,workflow]=await Promise.all([
  readFile(new URL('../src/api/developerDocs.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/api/main.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/billing/routes.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/api/apiKeys.ts',import.meta.url),'utf8'),
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
assert.match(docs,/Remote MCP/,'developer surface must expose MCP as a first-class integration path');
assert.match(docs,/Use LTA inside an AI client\./,'developer surface must explain what MCP is for');
assert.match(docs,/\/mcp/,'developer surface must publish the production MCP endpoint');
assert.match(docs,/Claude[^]*Custom Connector/,'MCP surface must name Claude as a place to use Remote MCP');
assert.match(docs,/Grok[^]*Custom MCP/,'MCP surface must name Grok custom MCP without claiming catalog publication');
assert.match(docs,/do not paste an <code>l2ai_live_…<\/code> API key into an MCP connector/,'MCP surface must separate OAuth from REST API keys');
assert.match(main,/href="\/developers#mcp">Use MCP<\/a>/,'homepage must expose a visible MCP entry point');
assert.match(main,/Using Grok or another Remote MCP client\?/,'connect page must explain where the MCP endpoint can be used');
assert.match(billing,/Key name/,'account API key form must only ask for a key name');
assert.match(billing,/Generate API key/,'account must generate the secret server-side');
assert.match(billing,/The full key is shown once and cannot be viewed again\./,'account must explain one-time visibility');
assert.match(billing,/API key generated\./,'one-time key page must be explicit');
assert.match(billing,/Copy once/,'one-time key page must expose a single-use copy action');
assert.match(billing,/Cache-Control/,'one-time secret response must disable caching');
assert.match(billing,/no-store, max-age=0/,'one-time secret response must be non-cacheable');
assert.match(billing,/Referrer-Policy/,'one-time secret page must not leak through referrers');
assert.match(billing,/history\.replaceState\(null,'','\/account'\)/,'refreshing the generated-key page must not resubmit key creation');
assert.match(billing,/button\.disabled=true/,'copy control must disable after a successful copy');
assert.match(billing,/key\.textContent=prefix\+'••••••••'/,'full key must be removed from the visible DOM after a successful copy');
assert.match(billing,/>Delete<\/button>/,'existing keys must only offer deletion');
assert.doesNotMatch(billing,/>Revoke<\/button>/,'user-facing key management must not expose a separate revoke workflow');
assert.doesNotMatch(billing,/Do you need an API key\?/,'account must not teach developers basic API concepts');
assert.doesNotMatch(billing,/What do I do with this\?/,'one-time key page must not turn into an API tutorial');
assert.doesNotMatch(billing,/Invoke-RestMethod/,'one-time key page must not include terminal tutorials');
assert.doesNotMatch(billing,/View API quickstart/,'account key management must stay focused on keys');
assert.doesNotMatch(billing,/account\/api-keys\/update/,'API keys must not be editable');
assert.match(apiKeys,/sha256\(key\)/,'server must persist only a one-way hash of the full API key');
assert.match(apiKeys,/SELECT id,name,key_prefix,created_at,last_used_at,revoked_at/,'key listing must expose metadata only');
assert.doesNotMatch(apiKeys,/SELECT[^;]*key_hash[^;]*FROM api_keys WHERE user_id=\$1 AND revoked_at IS NULL/s,'account key listing must never retrieve key hashes');
assert.match(apiKeys,/WHERE user_id=\$1 AND revoked_at IS NULL/,'deleted keys must disappear from the active key list');

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
