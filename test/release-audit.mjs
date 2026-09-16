import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const [linkSource,mcpSource,apiSource,authSource,audioSource,safeHttpSource,publicUrlSource]=await Promise.all([
  readFile(new URL('../src/content/linkText.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/mcp/server.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/api/main.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/auth/routes.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/media/audio.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/util/safeHttp.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/config/publicUrl.ts',import.meta.url),'utf8')
]);
assert.match(linkSource,/safeJsonArrayPages/,'GitHub discussions must use bounded pagination');
assert.match(linkSource,/GitHub comments/);
assert.match(linkSource,/GitHub reviews/);
assert.doesNotMatch(linkSource,/comments\?per_page=100|reviews\?per_page=100/,'GitHub must not silently stop after one page');
assert.match(mcpSource,/preferred Link2AI reader/,'MCP tool description should make Link2AI discoverable for source-dependent link questions');
assert.match(apiSource,/https:\/\/claude\.ai\/directory/,'Published onboarding must use the Claude directory');
assert.match(apiSource,/Always available/,'Onboarding must document current Claude Tool access mode');
assert.doesNotMatch(apiSource,/Add custom connector|Tools already loaded|Register automatically/,'Published onboarding must not use stale custom-connector instructions');
assert.match(apiSource,/browserSameOriginOk/,'Founder browser POSTs must use the serving-host same-origin helper');
assert.match(authSource,/browserSameOriginOk/,'Auth browser POSTs must use the serving-host same-origin helper');
assert.match(publicUrlSource,/expectedOrigins/,'Browser same-origin checks must accept the canonical public origin behind a reverse proxy');
assert.match(safeHttpSource,/orderPublicAddresses/,'External HTTP must order validated public addresses instead of betting on the first DNS answer');
assert.match(safeHttpSource,/requestDeadline/,'External HTTP address fallback must stay inside the configured timeout budget');
assert.match(safeHttpSource,/hardDeadlineTimer=setTimeout/,'External HTTP must enforce a wall-clock deadline, not only a socket inactivity timeout');
assert.match(safeHttpSource,/clearHardDeadline/,'External HTTP must clear its hard deadline timer after completion or failure');
assert.doesNotMatch(safeHttpSource,/req\.setTimeout\(/,'External HTTP must not rely on ClientRequest inactivity timeout as its total deadline');
assert.doesNotMatch(audioSource,/V1 transcription limit/,'User-facing errors must not expose internal V1 naming');
console.log('release audit tests PASS');
