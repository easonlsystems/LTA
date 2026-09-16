import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const [linkSource,mcpSource,apiSource,authSource,audioSource,safeHttpSource,publicUrlSource,jobsSource,capabilitySource]=await Promise.all([
  readFile(new URL('../src/content/linkText.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/mcp/server.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/api/main.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/auth/routes.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/media/audio.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/util/safeHttp.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/config/publicUrl.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/worker/jobs.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/config/sourceCapabilities.ts',import.meta.url),'utf8')
]);
assert.match(linkSource,/safeJsonArrayPages/,'GitHub discussions must use bounded pagination');
assert.match(linkSource,/GitHub comments/);
assert.match(linkSource,/GitHub reviews/);
assert.doesNotMatch(linkSource,/comments\?per_page=100|reviews\?per_page=100/,'GitHub must not silently stop after one page');
assert.match(capabilitySource,/REDDIT_CLIENT_ID/,'Reddit availability must require an OAuth client id');
assert.match(capabilitySource,/REDDIT_CLIENT_SECRET/,'Reddit availability must require an OAuth client secret');
assert.match(capabilitySource,/supportedSourceDescription/,'Public source claims should be generated from the shared capability layer');
assert.match(mcpSource,/sourceCapabilities/,'MCP metadata must use the shared source capability layer');
assert.match(mcpSource,/supportedSourceDescription/,'MCP supported-source copy must come from the shared capability layer');
assert.match(apiSource,/sourceCapabilities/,'Website source claims must use the shared source capability layer');
assert.match(apiSource,/publicSourceCapabilities\.reddit/,'Website Reddit controls must be capability-gated');
assert.doesNotMatch(apiSource,/Reddit · paused|Reddit · temporarily paused/,'Website copy must not keep a hardcoded Reddit availability state');
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
assert.match(safeHttpSource,/res\.on\('aborted'/,'External HTTP must keep the deadline/error path active through response-body completion');
assert.match(safeHttpSource,/clearHardDeadline/,'External HTTP must clear its hard deadline timer after completion or failure');
assert.doesNotMatch(safeHttpSource,/req\.setTimeout\(/,'External HTTP must not rely on ClientRequest inactivity timeout as its total deadline');
assert.doesNotMatch(safeHttpSource,/req\.on\('close',clearHardDeadline\)/,'Request close must not disarm the response-body deadline early');
assert.match(jobsSource,/r\.job_id=j\.id/,'Disabled-account reservation cleanup must be tied to the owning job');
assert.match(jobsSource,/j\.status<>'processing'/,'Disabled-account cleanup must preserve live reservations until in-flight jobs finish');
assert.doesNotMatch(audioSource,/V1 transcription limit/,'User-facing errors must not expose internal V1 naming');
console.log('release audit tests PASS');
