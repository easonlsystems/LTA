import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [mcp,api,source,policy,grokConfig,readme]=await Promise.all([
  readFile(new URL('../src/mcp/server.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/api/publicApi.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/source/service.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/source/policy.ts',import.meta.url),'utf8'),
  readFile(new URL('../integrations/grok/mcp.json',import.meta.url),'utf8').then(JSON.parse),
  readFile(new URL('../README.md',import.meta.url),'utf8')
]);

assert.match(mcp,/from '\.\.\/source\/service\.js'/,'MCP clients must call the shared source service');
assert.match(api,/from '\.\.\/source\/service\.js'/,'REST API must call the shared source service');
assert.match(api,/startTranscriptJob\(auth\.userId,url/,'REST reads must use the same shared job entrypoint');
assert.match(mcp,/startTranscriptJob\(userIdFromContext\(ctx\),url/,'MCP reads must use the same shared job entrypoint');

assert.equal(grokConfig.server_url,'https://api-production-0383e.up.railway.app/mcp','Grok must use the production shared MCP endpoint');
assert.match(policy,/same\s+[\s\S]*source matrix/i,'distribution policy must preserve the same supported-source matrix');
assert.doesNotMatch(policy,/GROK_ALLOWED|CLAUDE_ALLOWED|API_ALLOWED/,'clients must not fork independent source allowlists');

for(const field of ['source_url','source_key','source_fetched_at','cache_expires_at','usage_units','remaining_usage_units','required_usage_units']){
  assert.ok(source.includes(field),`shared source result must retain ${field}`);
}
assert.match(api,/source_completeness/,'REST API must expose source completeness');
assert.match(mcp,/source_completeness/,'MCP must expose source completeness');

assert.match(readme,/Claude \/ Grok \/ compatible MCP clients/);
assert.match(readme,/Shared Source Engine/);
assert.match(readme,/Public REST API beta/);
assert.match(readme,/Catalog publication is a separate xAI approval step/);

console.log('cross-client V3C contract tests PASS');
