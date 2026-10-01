import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [migration,visitors,product,main,authRoutes,authService,source,quota,jobs,processor,billing,lemon,publicApi,mcp]=await Promise.all([
  readFile(new URL('../sql/014_activation_funnel_v2.sql',import.meta.url),'utf8'),
  readFile(new URL('../src/analytics/visitors.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/analytics/product.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/api/main.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/auth/routes.base.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/auth/service.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/source/service.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/quota/service.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/worker/jobs.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/worker/processor.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/billing/routes.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/billing/lemon.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/api/publicApi.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/mcp/server.ts',import.meta.url),'utf8')
]);

for(const event of [
  'landing_view','add_lta_click','oauth_start','oauth_success','oauth_fail','connector_connected',
  'read_requested','first_read_success','second_read_success','quota_low','quota_exceeded',
  'topup_click','topup_success'
]){
  const all=[main,product,authRoutes,authService,source,billing,lemon].join('\n');
  assert.match(all,new RegExp(event),`missing activation event ${event}`);
}

assert.match(migration,/website_visitors[\s\S]*utm_content/);
assert.match(migration,/product_activation_events[\s\S]*visitor_id/);
assert.match(migration,/product_activation_events[\s\S]*utm_source/);
assert.match(migration,/source_access_events[\s\S]*source_domain/);
assert.match(migration,/source_access_events[\s\S]*source_key/);
assert.match(migration,/source_access_events[\s\S]*processing_time_ms/);
assert.match(migration,/source_access_events[\s\S]*cache_hit/);
assert.match(migration,/source_access_events[\s\S]*units_charged/);
assert.match(migration,/source_access_events[\s\S]*units_refunded/);

assert.match(visitors,/utmContent/);
assert.match(migration,/ALTER TABLE website_events[\s\S]*utm_source[\s\S]*utm_campaign[\s\S]*utm_content/);
assert.match(visitors,/INSERT INTO website_events\(visitor_id,user_id,event_name,path,metadata,utm_source,utm_campaign,utm_content\)/);
assert.match(visitors,/v\.utm_source,v\.utm_campaign,v\.utm_content/);
assert.match(visitors,/UPDATE website_events SET user_id=\$2 WHERE visitor_id=\$1 AND user_id IS NULL/);
assert.match(visitors,/utm_source=COALESCE\(EXCLUDED\.utm_source,website_visitors\.utm_source\)/);
assert.match(visitors,/utm_campaign=COALESCE\(EXCLUDED\.utm_campaign,website_visitors\.utm_campaign\)/);
assert.match(visitors,/utm_content=COALESCE\(EXCLUDED\.utm_content,website_visitors\.utm_content\)/);
assert.match(product,/ORDER BY last_seen_at DESC/);
assert.match(product,/visitor_id,utm_source,utm_campaign,utm_content/);

assert.match(authRoutes,/linkWebsiteVisitorToUser\(req\.headers\.cookie,user\.id,false\)/);
assert.match(authRoutes,/recordActivationEvent\(user\.id,'oauth_start'/);
assert.match(authRoutes,/trackWebsiteEvent\(req,'oauth_authorize_seen'/);
assert.match(authRoutes,/trackWebsiteEvent\(req,'oauth_login_required'/);
assert.match(authRoutes,/trackWebsiteEvent\(req,'google_signin_start'/);
assert.match(authService,/recordActivationEvent\(row\.user_id,'oauth_success'/);
assert.match(authService,/recordActivationEvent\(row\.user_id,'connector_connected'/);
assert.match(authService,/recordActivationEvent\(analyticsUserId,'oauth_fail'/);

assert.match(main,/trackWebsiteEvent\(req,'landing_view','\/'\)/);
assert.match(main,/trackWebsiteEvent\(req,'add_lta_click'/);
assert.match(main,/trackWebsiteEvent\(req,'connect_page_view'/);
assert.match(main,/trackWebsiteEvent\(req,'claude_handoff_click'/);
assert.match(main,/Claude did not prefill the connector/);
assert.match(main,/manual-mcp-url/);
assert.match(main,/window\.open\(a\.href,'_blank','noopener'\);location\.assign\('\/connect\?started=1&from='/);
assert.match(main,/\+ → Connectors → LTA/);
assert.match(main,/>Open Claude /);
assert.match(main,/event_name='second_read_success'/);
assert.match(main,/UTM campaign → activation/);
assert.match(main,/utm_source.*utm_campaign.*utm_content/s);

assert.match(source,/beginSourceAccessEvent/);
assert.match(source,/recordActivationEvent\(userId,'read_requested'/);
assert.match(source,/COUNT\(DISTINCT source_key\)/);
assert.match(source,/eventName:'second_read_success'|recordActivationEvent\(userId,'second_read_success'/);
assert.match(source,/outcome='completed'/);
assert.match(source,/finished_at IS NULL/);
assert.match(source,/units_charged=CASE WHEN reused THEN 0 ELSE \$8 END/);
assert.match(source,/units_refunded=CASE WHEN reused THEN 0 ELSE \$9 END/);
assert.match(source,/message:'Source ready\. Try another link\.'/);
assert.match(source,/topup_path:topupPath/);
assert.match(source,/This attempt used 0 units\. Open LTA → Account to add units or review your plan/);
assert.match(publicApi,/topup_path:result\.topup_path/);
assert.match(mcp,/topup_path:z\.string\(\)/);

assert.match(quota,/analytics_reserved_usage_units/);
assert.match(jobs,/analytics_cache_hit=\$4/);
assert.match(processor,/markCompleted\(job\.id,userExisting\.id,[^\n]*true\)/);
assert.match(processor,/markCompleted\(job\.id,existing\.id,[^\n]*true\)/);
assert.match(processor,/if\(reserved\)\{await releaseQuota\(job\.id\)/);
assert.match(source,/status:'failed'[\s\S]*usage_units:0/);

assert.match(billing,/trackWebsiteEvent\(req,'topup_click'/);
assert.match(billing,/recordActivationEvent\(user\.id,'topup_click'/);
assert.match(lemon,/await client\.query\('COMMIT'\);[\s\S]*recordActivationEvent\(userId,'topup_success'/);

console.log('activation funnel v2 contract tests PASS');
