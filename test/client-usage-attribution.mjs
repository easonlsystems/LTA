import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inferMcpClientSource,clientSourceLabel,normalizeClientSource} from '../dist/src/source/clientSource.js';

const [migration,funnelMigration,service,api,mcp,main]=await Promise.all([
  readFile(new URL('../sql/010_client_usage_attribution.sql',import.meta.url),'utf8'),
  readFile(new URL('../sql/014_activation_funnel_v2.sql',import.meta.url),'utf8'),
  readFile(new URL('../src/source/service.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/api/publicApi.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/mcp/server.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/api/main.ts',import.meta.url),'utf8')
]);

assert.match(migration,/transcript_jobs[\s\S]*client_source/);
assert.match(migration,/CREATE TABLE IF NOT EXISTS source_access_events/);
assert.match(migration,/reused boolean NOT NULL DEFAULT false/);

assert.equal(inferMcpClientSource('https://claude.ai/oauth/client','Mozilla/5.0','default'),'claude');
assert.equal(inferMcpClientSource('opaque-client-id','custom-runtime','default','Grok'),'grok');
assert.equal(inferMcpClientSource('anything','openai-mcp/1.0','openai'),'chatgpt');
assert.equal(inferMcpClientSource('moonshot-kimi','custom','default'),'kimi');
assert.equal(inferMcpClientSource('custom-client','custom-runtime','default'),'mcp');
assert.equal(normalizeClientSource('rest_api'),'rest_api');
assert.equal(clientSourceLabel('rest_api'),'REST API');

assert.match(api,/clientSource:'rest_api'/);
assert.match(mcp,/clientSourceFromContext/);
assert.match(mcp,/startTranscriptJob[\s\S]*clientSource:clientSourceFromContext/);
assert.match(main,/inferMcpClientSource\(defaultAuth\.clientId,ua,'default',defaultAuth\.extra\.clientName\)/);
assert.match(main,/openaiAuth\.extra\.clientSource='chatgpt'/);
assert.match(main,/auth\.extra\.clientSource='chatgpt'/);

assert.match(service,/INSERT INTO source_access_events/);
assert.match(service,/beginSourceAccessEvent/);
assert.match(service,/attachSourceAccessEvent/);
assert.match(service,/reused:true/);
assert.match(service,/source_domain/);
assert.match(funnelMigration,/source_access_events[\s\S]*outcome/);
assert.match(funnelMigration,/source_access_events[\s\S]*cache_hit/);
assert.match(funnelMigration,/units_charged/);
assert.match(funnelMigration,/units_refunded/);

assert.match(main,/>從哪裡使用 LTA</);
assert.match(main,/>最近使用紀錄</);
assert.match(main,/沿用已處理內容/);
assert.match(main,/實際扣除單位/);
assert.match(main,/從哪裡使用/);

console.log('client usage attribution contract tests PASS');
