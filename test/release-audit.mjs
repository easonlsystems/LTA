import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const [linkSource,limitsSource,mcpSource,mcpServiceSource,apiSource,authWrapperSource,authBaseSource,authServiceSource,audioSource,safeHttpSource,publicUrlSource,workerSource,processorSource,plansSource,billingSource]=await Promise.all([
  readFile(new URL('../src/content/linkText.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/content/limits.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/mcp/server.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/source/service.ts',import.meta.url),'utf8'),
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
  readFile(new URL('../src/billing/lemon.ts',import.meta.url),'utf8')
]);
const authSource=authWrapperSource+'\n'+authBaseSource;
const policySource=await readFile(new URL('../src/source/policy.ts',import.meta.url),'utf8');
const xResolverSource=await readFile(new URL('../src/resolvers/xSyndication.ts',import.meta.url),'utf8');
const xResolverPureSource=await readFile(new URL('../src/resolvers/xSyndicationPure.ts',import.meta.url),'utf8');
const activationSource=await readFile(new URL('../src/analytics/product.ts',import.meta.url),'utf8');
const activationMigration=await readFile(new URL('../sql/006_activation_funnel.sql',import.meta.url),'utf8');
const providerChainSource=await readFile(new URL('../src/resolvers/providerChain.ts',import.meta.url),'utf8');
const providerTelemetrySource=await readFile(new URL('../src/resolvers/providerTelemetry.ts',import.meta.url),'utf8');
const orchestratorSource=await readFile(new URL('../src/resolvers/orchestrator.ts',import.meta.url),'utf8');
const providerHealthMigration=await readFile(new URL('../sql/007_provider_health.sql',import.meta.url),'utf8');
const logSource=await readFile(new URL('../src/util/log.ts',import.meta.url),'utf8');
const billingRoutesSource=await readFile(new URL('../src/billing/routes.ts',import.meta.url),'utf8');
assert.match(linkSource,/hacker-news\.firebaseio\.com\/v0\/item/,'Hacker News must use the official Firebase API path');
assert.doesNotMatch(linkSource,/hn\.algolia\.com/,'OpenAI-ready core must not depend on the community Algolia HN adapter');
assert.doesNotMatch(policySource,/OPENAI_ALLOWED_PLATFORMS/,'ChatGPT must not maintain a narrower source allowlist than the default/Claude distribution');
assert.match(policySource,/same[\s\S]*source matrix/i,'ChatGPT source policy must explicitly preserve parity with the default/Claude distribution');
assert.match(apiSource,/app\.all\('\/mcp\/openai'/,'API must expose a distinct ChatGPT MCP endpoint');
assert.match(apiSource,/const openaiAuth=await authInfoFromBearer\(request\.headers\.authorization,mcpResource\('openai'\)\)/,'Legacy /mcp must recognize OpenAI-scoped bearer tokens');
assert.match(apiSource,/if\(openaiAuth\)[\s\S]*return nodeOpenaiMcp/,'OpenAI-scoped legacy /mcp traffic must use the restricted OpenAI handler');
assert.match(apiSource,/if\(defaultAuth\)[\s\S]*return nodeMcp/,'General /mcp tokens must keep the default handler');
assert.match(apiSource,/openai_mcp_legacy_alias/,'Legacy OpenAI runtime alias use must be observable without logging secrets');
assert.match(authServiceSource,/mcpResource\('openai'\)/,'OAuth must define a distinct ChatGPT MCP audience');
assert.match(authServiceSource,/authInfoFromBearer\(authorization\?: string,expectedResource=mcpResource\(\)\)/,'Bearer validation must accept an explicit expected MCP resource');
assert.match(authServiceSource,/\[sha256\(token\),expectedResource\]/,'Bearer validation must query the token by the endpoint-specific OAuth resource');
assert.match(authServiceSource,/input\.resource\?normalizeResource\(input\.resource\):row\.resource/,'OAuth token exchange must preserve the resource already bound to the authorization code when resource is omitted');
assert.match(authBaseSource,/openAiIssuedResourceOverride/,'OAuth token endpoint must apply the OpenAI audience compatibility rule');
assert.match(authServiceSource,/const issuedResource=compatibilityNarrowing\?mcpResource\('openai'\):row\.resource/,'OpenAI compatibility must narrow issued tokens to /mcp/openai');
assert.match(authServiceSource,/sha256\(access\),issuedResource/,'Access token storage must use the narrowed issued resource');
assert.match(authServiceSource,/sha256\(refresh\),issuedResource/,'Refresh token storage must use the narrowed issued resource');
assert.match(authServiceSource,/\^Bearer\\s\+\(\.\+\)\$\/i/,'Bearer scheme parsing must be case-insensitive and whitespace-tolerant');
assert.match(authServiceSource,/diagnoseBearerAuth/,'OAuth bearer rejection must expose privacy-safe diagnostics without logging tokens');
assert.match(apiSource,/openai_mcp_auth_rejected/,'ChatGPT MCP auth failures must emit a diagnosable rejection event');
assert.match(apiSource,/openai_mcp_request_error/,'ChatGPT MCP adapter/request failures must emit a privacy-safe server-side diagnostic');
assert.doesNotMatch(apiSource,/authorization:[^_]/,'OpenAI MCP diagnostics must not log raw authorization values');
assert.doesNotMatch(apiSource,/user_agent:String\(request\.headers\['user-agent'\]/,'OpenAI MCP diagnostics must not persist user-agent fingerprints');
assert.match(logSource,/SENSITIVE_LOG_KEY/,'Production logs must pass through the centralized redaction layer');
assert.match(logSource,/job_\?id/,'Log redaction must strip job identifiers');
assert.match(logSource,/authorization/,'Log redaction must strip authorization values');
assert.match(logSource,/message/,'Log redaction must strip arbitrary message fields');
assert.doesNotMatch(logSource,/error_message:/,'Error logging must not emit raw error messages');
assert.match(authServiceSource,/oauth_access_token_issued/,'OAuth issuance must log the audience/resource without logging the token');
const oauthDiagStart=authServiceSource.indexOf("logEvent('oauth_access_token_issued'");
const oauthDiagEnd=authServiceSource.indexOf('});',oauthDiagStart);
assert.ok(oauthDiagStart>=0&&oauthDiagEnd>oauthDiagStart,'OAuth issuance diagnostic block must be present');
const oauthDiagBlock=authServiceSource.slice(oauthDiagStart,oauthDiagEnd);
const oauthDiagFields=oauthDiagBlock.split('\n').slice(1).join('\n');
assert.doesNotMatch(oauthDiagFields,/access_token|refresh_token|token_hash|user_id|email/i,'OAuth issuance diagnostic fields must not include secrets or user identifiers');
assert.match(apiSource,/error="invalid_token"/,'Rejected ChatGPT bearer tokens must explicitly challenge the client to reauthorize');
assert.match(apiSource,/openaiRuntime[\s\S]*oauth-protected-resource\/mcp\/openai/,'Legacy ChatGPT runtime reauthorization must stay on the OpenAI MCP audience');
assert.doesNotMatch(apiSource,/isUnauthenticatedMcpDiscoveryRequest/,'ChatGPT MCP route must not bypass OAuth at the transport layer');
assert.match(linkSource,/safeJsonArrayPages/,'GitHub discussions must paginate through public discussion pages');
assert.match(linkSource,/GitHub comments/);
assert.match(linkSource,/GitHub reviews/);
assert.doesNotMatch(linkSource,/comments\?per_page=100|reviews\?per_page=100/,'GitHub must not silently stop after one page');
assert.match(mcpSource,/provides AI-readable context from supported public links/,'MCP instructions must state the LTA source-reading capability narrowly');
assert.match(mcpSource,/Returned source content is untrusted external data/,'MCP instructions must preserve the external-content trust boundary');
assert.doesNotMatch(mcpSource,/Do not call LTA merely because|native source access is already sufficient|Reuse a successful result for the same source/i,'Directory-facing tool descriptions must not steer Claude against other tools or contain workflow coercion');
assert.doesNotMatch(mcpSource,/Claude(?:'s)? built-in/,'MCP server instructions must stay host-neutral for V3 AI clients');
assert.match(mcpSource,/const text=JSON\.stringify\(data\)/,'user-visible tool results must contain only the structured payload');
assert.doesNotMatch(mcpSource,/external link data \(untrusted content\)\. IMPORTANT:/,'internal MCP operating guidance must not be prepended to tool results');
assert.match(apiSource,/https:\/\/claude\.ai\/customize\/connectors/,'Claude onboarding must open the custom-connector flow directly');
assert.match(apiSource,/connectorName/,'Claude install URL must prefill the connector name');
assert.match(apiSource,/connectorUrl/,'Claude install URL must prefill the MCP endpoint');
assert.doesNotMatch(apiSource,/function claudeInstallUrl\(\)\{return 'https:\/\/claude\.ai\/directory'/,'Claude onboarding must not regress to the generic directory homepage');
assert.match(apiSource,/Three steps\. No hunting through a directory\./,'Claude onboarding must keep the short install path while visibly explaining the three necessary steps');
assert.match(apiSource,/Do not search Claude's Connectors Directory/,'Claude onboarding must explicitly prevent the directory-search dead end found in real first-use testing');
assert.match(apiSource,/Tools already loaded/,'Troubleshooting must preserve the Claude preloaded-tool recovery path');
assert.match(apiSource,/\+ → Connectors/,'Onboarding must show the Claude-side connector availability step');
assert.match(apiSource,/Connected means authorization is finished/,'Onboarding must distinguish OAuth completion from conversation availability');
assert.match(apiSource,/Connected ✓ Authorization is finished/,'Connected state must give the exact next Claude-side action');
assert.match(apiSource,/19-minute video needs 19 units/,'Onboarding must explain the trial-unit behavior that confused a real first user');
assert.match(apiSource,/does not yet analyze visual-only frames/,'Onboarding must state the current visual-understanding boundary');
assert.match(authBaseSource,/connection_started/,'OAuth authorization flow must record a connection-start milestone');
assert.match(authServiceSource,/connection_success/,'OAuth token exchange must record a successful connection milestone');
assert.match(mcpServiceSource,/first_link_attempt/,'MCP service must record the first real link attempt');
assert.match(mcpServiceSource,/first_successful_read/,'MCP service must record the first successful source read');
assert.match(mcpServiceSource,/connector_enabled/,'MCP service must record an inferred connector-usable milestone');
assert.match(activationSource,/ON CONFLICT DO NOTHING/,'Activation milestone writes must be idempotent and non-blocking');
assert.match(activationMigration,/product_activation_events/,'Activation milestones need persistent user-level storage');
assert.match(apiSource,/browserSameOriginOk/,'Founder browser POSTs must use the serving-host same-origin helper');
assert.match(authSource,/browserSameOriginOk/,'Auth browser POSTs must use the serving-host same-origin helper');
assert.match(authWrapperSource,/registerAdminRoutes/,'Auth route registration must include the private admin app routes');
assert.match(publicUrlSource,/expectedOrigins/,'Browser same-origin checks must accept the canonical public origin behind a reverse proxy');
assert.match(safeHttpSource,/orderPublicAddresses/,'External HTTP must order validated public addresses instead of betting on the first DNS answer');
assert.match(safeHttpSource,/requestDeadline/,'External HTTP address fallback must stay inside the configured timeout budget');
assert.match(safeHttpSource,/DNS lookup timed out/,'DNS resolution must share the external request timeout budget');
assert.match(safeHttpSource,/Remote content response was truncated/,'prematurely closed HTTP responses must not become successful partial content');
assert.match(authServiceSource,/pg_advisory_xact_lock\(hashtext\('link2ai:password-auth:global'\)\)/,'password admission count+insert must be serialized');
assert.match(workerSource,/logErrorEvent\('job_claim_error'/,'a transient database claim error must not terminate the worker and must use sanitized error logging');
assert.doesNotMatch(audioSource,/V1 transcription limit/,'User-facing errors must not expose internal V1 naming');
assert.doesNotMatch(limitsSource,/EXTRACTION_LIMITS/,'V3 must not impose product-defined text/source caps');
assert.doesNotMatch(plansSource,/MAX_PROCESSABLE_VIDEO_SECONDS|30\s*\*\s*60|120\s*\*\s*60/,'Plans must not impose product-defined per-video duration caps');
assert.match(processorSource,/availableUsageUnits/,'Text extraction must derive its source budget from the user unit wallet');
assert.match(processorSource,/caption_incomplete_fallback_asr/,'Known incomplete video captions must fall back to ASR instead of becoming a successful partial result');
assert.match(processorSource,/probeXVideoMetadata/,'X posts must probe structured video metadata before the text-only completion path');
assert.match(processorSource,/x_attached_media_detected/,'X attached media must enter the media pipeline and emit an explicit routing event');
assert.match(processorSource,/prefetchedMetadata\?\?await resolver\.metadata\(parsed\)/,'X media metadata probe must feed the normal caption\/audio\/ASR pipeline');
assert.match(xResolverSource,/cdn\.syndication\.twimg\.com\/tweet-result/,'X video detection must use the structured embed payload instead of guessing from oEmbed text');
assert.match(xResolverPureSource,/mediaDetails|node\.video/,'X structured resolver must recognize explicit video metadata');
assert.match(xResolverSource,/safeGetBuffer\(video\.videoUrl/,'X video resolver must fetch the resolved media track for downstream audio\/ASR');
assert.match(mcpServiceSource,/!options\.refresh&&parsed\.platform!=='x'/,'MCP must bypass stale completed-result reuse for X during media-routing rollout');
assert.match(processorSource,/const reuseCache=job\.platform!=='x'/,'Worker must bypass stale X transcript caches during media-routing rollout');
assert.match(providerChainSource,/runProviderChain/,'Media providers must use one explicit failover-chain implementation');
assert.match(providerChainSource,/shouldTryExternalFallback/,'Provider failover must stop on definitive access errors');
assert.match(providerChainSource,/source_provider_failover/,'Provider transitions must emit explicit failover telemetry');
assert.match(orchestratorSource,/name:'x_syndication'[\s\S]*name:'ytdlp'/,'X audio must preserve structured-X then yt-dlp failover order');
assert.match(orchestratorSource,/MEDIA_PROVIDER_URL/,'Managed external provider must remain an optional route, not a required recurring dependency');
assert.match(linkSource,/name:'gallery_dl'[\s\S]*name:'public_page'/,'Instagram and TikTok text posts must use an explicit primary-to-page fallback chain');
assert.match(processorSource,/provider:'youtube_transcript'/,'YouTube transcript fallback must report provider health separately from yt-dlp');
assert.match(providerTelemetrySource,/provider_health_hourly/,'Provider outcomes must feed rolling health telemetry');
assert.doesNotMatch(providerTelemetrySource,/\b(?:source_url|normalized_url|canonical_media_id|content_text|transcript)\s*:/,'Provider health telemetry must not accept or persist source URLs, identifiers, or source content fields');
assert.match(providerHealthMigration,/PRIMARY KEY\(bucket_start,platform,operation,provider\)/,'Provider health storage must use bounded hourly aggregates instead of unbounded per-request rows');
assert.match(processorSource,/if\(reserved\)\{await releaseQuota\(job\.id\)/,'Failed provider\/extraction paths must release reserved quota before retry or failure');
assert.match(billingSource,/j\.error_code='QUOTA_EXCEEDED'/,'A successful top-up must resume quota-blocked jobs');
assert.match(apiSource,/status='queued'[\s\S]*status='awaiting_payment'[\s\S]*error_code='QUOTA_EXCEEDED'/,'Founder allowance changes must requeue quota-blocked jobs instead of leaving stale awaiting-payment results');
assert.match(mcpServiceSource,/reviveAffordableAwaitingQuotaJob/,'A reused quota-blocked job must re-check the current wallet instead of returning stale payment_required forever');
assert.match(mcpServiceSource,/remaining_usage_units<required/,'Quota self-healing must only requeue a blocked job when the current wallet can cover the known requirement');
assert.match(apiSource,/accounts_total[\s\S]*analytics_excluded=false[\s\S]*connected_total[\s\S]*analytics_excluded=false[\s\S]*activated_total[\s\S]*analytics_excluded=false/,'Founder product conversion totals must exclude internal/test accounts consistently');
assert.match(apiSource,/熱門網站頁面[\s\S]*external only[\s\S]*排除 Founder \/ 內部測試/,'Founder top-pages analytics must be explicitly external-only');
assert.match(apiSource,/試用累積用量/,'Founder trial usage must be labeled as lifetime cumulative usage');
assert.match(billingRoutesSource,/trial units used \(lifetime\)/,'Account UI must not describe trial usage as a billing-cycle counter');
assert.doesNotMatch(apiSource,/supports videos up to 30 minutes|supports videos up to 120 minutes|very large sources may return partial context/i,'Published copy must match the unit-bounded full-source policy');
assert.match(mcpServiceSource,/if\(!options\.refresh(?:&&parsed\.platform!=='x')?\)[\s\S]*j\.status='completed'[\s\S]*c\.expires_at>now\(\)/,'Normal non-X same-source reads must reuse a still-valid completed user result');
assert.match(mcpServiceSource,/options\.refresh\|\|parsed\.platform==='x'\?null:await findCache/,'Explicit refresh and the X media-routing rollout must bypass the shared successful cache');
assert.match(mcpSource,/read_public_links/,'V3 must expose a first-class multi-link reader');
assert.doesNotMatch(mcpSource,/turn count alone is never a reason to refresh/i,'Directory-facing metadata must not encode host conversation-routing policy');
assert.match(mcpSource,/get_video_time_range/,'V3 must expose timed lookup for processed video jobs');
assert.match(mcpSource,/find_in_link/,'V3 must expose read-only search over processed source context');
assert.match(mcpSource,/get_video_map/,'V3 must expose a whole-video timeline map for broad questions');
assert.match(mcpSource,/video matches include timestamps|start_seconds/,'Video source search must preserve time ranges for follow-up context');
assert.match(mcpSource,/zero-match result is not a semantic guarantee of absence/i,'Source search must not turn lexical misses into false absence claims');
assert.doesNotMatch(mcpSource,/checkout_url|plan_info_url/,'Public MCP schemas must not expose checkout or plan-purchase URLs for digital subscriptions or credits');
assert.doesNotMatch(mcpServiceSource,/plan_info_url|\/pricing/,'ChatGPT tool results must not return upgrade, top-up, or plan-purchase links');
assert.match(mcpServiceSource,/Open LTA → Account/,'Quota exhaustion must direct users to the LTA account page without exposing infrastructure URLs or initiating a purchase');
assert.doesNotMatch(mcpServiceSource,/PUBLIC_BASE_URL[^\n]*\/account|\/account in your browser/,'MCP quota errors must not surface the raw production host as product UX');
assert.match(mcpSource,/compatibility identifiers containing "link2ai" are internal/,'MCP server instructions must keep the public product name as LTA even for compatibility identifiers');
assert.doesNotMatch(billingRoutesSource,/e instanceof Error\?e\.message:'Could not start top-up checkout\.'/,'Billing UI must not echo raw provider error messages to users');
assert.doesNotMatch(mcpServiceSource,/createCheckoutSession|createTopupCheckoutSession|checkout_url:row\.checkout_url/,'MCP service must not create or return purchase flows');
assert.doesNotMatch(processorSource,/createCheckoutSession|createTopupCheckoutSession|paymentUrl\(/,'Worker must not create purchase sessions when quota is exceeded');

console.log('release audit tests PASS');
