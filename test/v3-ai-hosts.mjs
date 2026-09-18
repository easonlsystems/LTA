import assert from 'node:assert/strict';

const {v3AiConnectPage}=await import('../dist/src/api/v3AiConnect.js');

const grok=v3AiConnectPage('grok','LaunchBrand','https://link2ai.example');
assert.match(grok,/LaunchBrand/);
assert.match(grok,/Grok · V3 production acceptance/);
assert.match(grok,/https:\/\/grok\.com\/connectors/);
assert.match(grok,/https:\/\/link2ai\.example\/mcp/);
assert.match(grok,/Do not advertise Grok as production-verified/);
assert.match(grok,/noindex,nofollow/);

const perplexity=v3AiConnectPage('perplexity','LaunchBrand','https://link2ai.example');
assert.match(perplexity,/Perplexity · V3 compatibility target/);
assert.match(perplexity,/Account settings, then Connectors/);
assert.match(perplexity,/https:\/\/link2ai\.example\/mcp/);
assert.match(perplexity,/public-client OAuth without requiring a client secret/);
assert.match(perplexity,/not a production-support claim yet/);
assert.match(perplexity,/noindex,nofollow/);

for(const body of [grok,perplexity]){
  assert.doesNotMatch(body,/client secret\s*[:=]/i,'setup pages must never ask users to paste a Link2AI client secret');
  assert.match(body,/Link2AI MCP server URL/);
}

console.log('V3 AI host tests PASS');
