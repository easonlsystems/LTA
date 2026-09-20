import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const config=JSON.parse(await readFile(new URL('../integrations/grok/mcp.json',import.meta.url),'utf8'));
const custom=await readFile(new URL('../integrations/grok/CUSTOM_CONNECTOR.md',import.meta.url),'utf8');
const catalog=await readFile(new URL('../integrations/grok/CATALOG_REQUEST.md',import.meta.url),'utf8');
const api=await readFile(new URL('../src/api/main.ts',import.meta.url),'utf8');

assert.equal(config.server_url,'https://api-production-0383e.up.railway.app/mcp');
assert.equal(config.server_label,'lta');
assert.deepEqual(config.allowed_tools,[
  'read_public_link',
  'read_public_links',
  'get_transcript_result',
  'get_video_time_range',
  'find_in_link',
  'get_video_map',
  'get_usage'
]);
assert.equal(config.allowed_tools.includes('get_video_transcript'),false,'Grok adapter should not advertise the legacy compatibility alias');

assert.match(custom,/same source engine, jobs, cache, quota, completeness and provenance/i);
assert.match(custom,/No LTA API key belongs in the Grok custom-connector form/i);
assert.match(custom,/Do not claim Catalog publication until xAI has actually approved/i);
assert.match(catalog,/source infrastructure for AI systems/i);
assert.match(catalog,/OAuth 2\.0 authorization-code flow with PKCE/i);
assert.match(catalog,/xAI distribution approval \/ onboarding/i);

assert.match(api,/app\.all\('\/mcp'/,'Grok adapter must reuse the production shared MCP endpoint');
assert.doesNotMatch(api,/app\.all\('\/mcp\/grok'/,'V3C must not create a separate Grok source backend');

console.log('Grok adapter tests PASS');
