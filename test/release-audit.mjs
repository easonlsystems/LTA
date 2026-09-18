import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const [linkSource,mcpSource,apiSource,authWrapperSource,authBaseSource,authServiceSource,audioSource,safeHttpSource,publicUrlSource,workerSource]=await Promise.all([
  readFile(new URL('../src/content/linkText.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/mcp/server.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/api/main.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/auth/routes.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/auth/routes.base.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/auth/service.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/media/audio.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/util/safeHttp.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/config/publicUrl.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/worker/main.ts',import.meta.url),'utf8')
]);
const authSource=authWrapperSource+'\n'+authBaseSource;
const v3ConnectSource=await readFile(new URL('../src/api/v3AiConnect.ts',import.meta.url),'utf8');
const v3ConnectSource=await readFile(new URL('../src/api/v3AiConnect.ts',import.meta.url),'utf8');
assert.match(linkSource,/safeJsonArrayPages/,'GitHub discussions must use bounded pagination');
assert.match(linkSource,/GitHub comments/);
assert.match(linkSource,/GitHub reviews/);
assert.doesNotMatch(linkSource,/comments\?per_page=100|reviews\?per_page=100/,'GitHub must not silently stop after one page');
assert.match(mcpSource,/preferred Link2AI reader/,'MCP tool description should make Link2AI discoverable for source-dependent link questions');
assert.doesNotMatch(mcpSource,/Claude(?:'s)? built-in/,'MCP server instructions must stay host-neutral for V3 AI clients');
assert.match(apiSource,/\/connect\/grok/,'V3 branch must expose the Grok acceptance route');
assert.match(apiSource,/\/connect\/perplexity/,'V3 branch must expose the Perplexity acceptance route');
assert.match(v3ConnectSource,/grok\.com\/connectors/,'Grok acceptance page must use the official connectors entry point');
assert.match(v3ConnectSource,/Perplexity · V3 compatibility target/,'Perplexity must remain labeled as a compatibility target before live acceptance');
assert.match(v3ConnectSource,/noindex,nofollow/,'Unverified V3 host setup pages must not be indexed as public support claims');
assert.doesNotMatch(mcpSource,/Claude(?:'s)? built-in/,'MCP server instructions must stay host-neutral for V3 AI clients');
assert.match(apiSource,/\/connect\/grok/,'V3 branch must expose the Grok acceptance route');
assert.match(apiSource,/\/connect\/perplexity/,'V3 branch must expose the Perplexity acceptance route');
assert.match(v3ConnectSource,/https:\/\/grok\.com\/connectors/,'Grok acceptance page must use the official connectors entry point');
assert.match(v3ConnectSource,/Perplexity · V3 compatibility target/,'Perplexity must remain labeled as a compatibility target before live acceptance');
assert.match(v3ConnectSource,/noindex,nofollow/,'Unverified V3 host setup pages must not be indexed as public support claims');
assert.match(apiSource,/https:\/\/claude\.ai\/directory/,'Published onboarding must use the Claude directory');
assert.match(apiSource,/Always available/,'Onboarding must document current Claude Tool access mode');
assert.doesNotMatch(apiSource,/Add custom connector|Tools already loaded|Register automatically/,'Published onboarding must not use stale custom-connector instructions');
assert.match(apiSource,/browserSameOriginOk/,'Founder browser POSTs must use the serving-host same-origin helper');
assert.match(authSource,/browserSameOriginOk/,'Auth browser POSTs must use the serving-host same-origin helper');
assert.match(authWrapperSource,/registerAdminRoutes/,'Auth route registration must include the private admin app routes');
assert.match(publicUrlSource,/expectedOrigins/,'Browser same-origin checks must accept the canonical public origin behind a reverse proxy');
assert.match(safeHttpSource,/orderPublicAddresses/,'External HTTP must order validated public addresses instead of betting on the first DNS answer');
assert.match(safeHttpSource,/requestDeadline/,'External HTTP address fallback must stay inside the configured timeout budget');
assert.match(safeHttpSource,/DNS lookup timed out/,'DNS resolution must share the external request timeout budget');
assert.match(safeHttpSource,/Remote content response was truncated/,'prematurely closed HTTP responses must not become successful partial content');
assert.match(authServiceSource,/pg_advisory_xact_lock\(hashtext\('link2ai:password-auth:global'\)\)/,'password admission count+insert must be serialized');
assert.match(workerSource,/event:'job_claim_error'/,'a transient database claim error must not terminate the worker');
assert.doesNotMatch(audioSource,/V1 transcription limit/,'User-facing errors must not expose internal V1 naming');
console.log('release audit tests PASS');
