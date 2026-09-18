import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const [linkSource,limitsSource,mcpSource,mcpServiceSource,apiSource,authWrapperSource,authBaseSource,authServiceSource,audioSource,safeHttpSource,publicUrlSource,workerSource,processorSource,plansSource,billingSource,cacheSource]=await Promise.all([
  readFile(new URL('../src/content/linkText.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/content/limits.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/mcp/server.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/mcp/service.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/api/main.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/auth/routes.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/auth/routes.base.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/auth/service.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/media/audio.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/util/safeHttp.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/config/publicUrl.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/worker/main.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/worker/processor.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/quota/plans.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/billing/lemon.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/worker/cache.ts',import.meta.url),'utf8')
]);
const authSource=authWrapperSource+'\n'+authBaseSource;
const policySource=await readFile(new URL('../src/mcp/policy.ts',import.meta.url),'utf8');
assert.match(linkSource,/hacker-news\.firebaseio\.com\/v0\/item/,'Hacker News must use the official Firebase API path');
assert.doesNotMatch(linkSource,/hn\.algolia\.com/,'OpenAI-ready core must not depend on the community Algolia HN adapter');
assert.match(cacheSource,/HACKERNEWS_OFFICIAL_API_CACHE_EPOCH/,'HN cache must have a provenance epoch for the official API migration');
assert.match(cacheSource,/platform==='hackernews'[\s\S]*created_at >=/,'HN shared cache lookup must reject cache entries created before the official API migration');
assert.match(cacheSource,/findUserCompletedCache[\s\S]*platform==='hackernews'[\s\S]*c\.created_at >=/,'HN same-user cache reuse must reject pre-official cache entries');
assert.match(policySource,/OPENAI_ALLOWED_PLATFORMS[^\n]*\['bluesky','github','hackernews'\]/,'ChatGPT distribution must default-deny every source outside the reviewed allowlist');
assert.match(apiSource,/app\.all\('\/mcp\/openai'/,'API must expose a distinct ChatGPT MCP endpoint');
assert.match(authServiceSource,/mcpResource\('openai'\)/,'OAuth must define a distinct ChatGPT MCP audience');
assert.match(authServiceSource,/authInfoFromBearer\(authorization\?: string,expectedResource=mcpResource\(\)\)/,'Bearer validation must accept an explicit expected MCP resource');
assert.match(authServiceSource,/\[sha256\(token\),expectedResource\]/,'Bearer validation must query the token by the endpoint-specific OAuth resource');
assert.match(linkSource,/safeJsonArrayPages/,'GitHub discussions must paginate through public discussion pages');
assert.match(linkSource,/GitHub comments/);
assert.match(linkSource,/GitHub reviews/);
assert.doesNotMatch(linkSource,/comments\?per_page=100|reviews\?per_page=100/,'GitHub must not silently stop after one page');
assert.match(mcpSource,/preferred Link2AI reader/,'MCP tool description should make Link2AI discoverable for source-dependent link questions');
assert.doesNotMatch(mcpSource,/Claude(?:'s)? built-in/,'MCP server instructions must stay host-neutral for V3 AI clients');
assert.match(apiSource,/https:\/\/claude\.ai\/customize\/connectors/,'Claude onboarding must open the custom-connector flow directly');
assert.match(apiSource,/connectorName/,'Claude install URL must prefill the connector name');
assert.match(apiSource,/connectorUrl/,'Claude install URL must prefill the MCP endpoint');
assert.doesNotMatch(apiSource,/function claudeInstallUrl\(\)\{return 'https:\/\/claude\.ai\/directory'/,'Claude onboarding must not regress to the generic directory homepage');
assert.match(apiSource,/Always available/,'Onboarding must document current Claude Tool access mode');
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
assert.doesNotMatch(limitsSource,/EXTRACTION_LIMITS/,'V3 must not impose product-defined text/source caps');
assert.doesNotMatch(plansSource,/MAX_PROCESSABLE_VIDEO_SECONDS|30\s*\*\s*60|120\s*\*\s*60/,'Plans must not impose product-defined per-video duration caps');
assert.match(processorSource,/availableUsageUnits/,'Text extraction must derive its source budget from the user unit wallet');
assert.match(processorSource,/caption_incomplete_fallback_asr/,'Known incomplete video captions must fall back to ASR instead of becoming a successful partial result');
assert.match(billingSource,/j\.error_code='QUOTA_EXCEEDED'/,'A successful top-up must resume quota-blocked jobs');
assert.doesNotMatch(apiSource,/supports videos up to 30 minutes|supports videos up to 120 minutes|very large sources may return partial context/i,'Published copy must match the unit-bounded full-source policy');
assert.match(mcpServiceSource,/if\(!options\.refresh\)[\s\S]*j\.status='completed'[\s\S]*c\.expires_at>now\(\)/,'Normal same-source reads must reuse a still-valid completed user result');
assert.match(mcpServiceSource,/options\.refresh\?null:await findCache/,'Explicit refresh must be the only path that bypasses the shared successful cache');
assert.match(mcpSource,/read_public_links/,'V3 must expose a first-class multi-link reader');
assert.match(mcpSource,/turn count alone is never a reason to refresh/i,'Host instructions must not use conversation length as a refresh policy');
assert.match(mcpSource,/get_video_time_range/,'V3 must expose timed lookup for processed video jobs');
assert.match(mcpSource,/find_in_link/,'V3 must expose read-only search over processed source context');
assert.match(mcpSource,/get_video_map/,'V3 must expose a whole-video timeline map for broad questions');
assert.match(mcpSource,/video matches include timestamps|start_seconds/,'Video source search must preserve time ranges for follow-up context');
assert.match(mcpSource,/search miss is not proof|zero matches as proof/i,'Source search must not turn lexical misses into false absence claims');
assert.doesNotMatch(mcpSource,/checkout_url/,'Public MCP schemas must not expose checkout URLs for digital subscriptions or credits');
assert.doesNotMatch(mcpServiceSource,/createCheckoutSession|createTopupCheckoutSession|checkout_url:row\.checkout_url/,'MCP service must not create or return purchase flows');
assert.doesNotMatch(processorSource,/createCheckoutSession|createTopupCheckoutSession|paymentUrl\(/,'Worker must not create purchase sessions when quota is exceeded');

console.log('release audit tests PASS');
