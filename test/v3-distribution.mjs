import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const openaiPlugin=JSON.parse(await readFile(new URL('../integrations/openai/plugin.json',import.meta.url),'utf8'));
const openaiMcp=JSON.parse(await readFile(new URL('../integrations/openai/mcp.json',import.meta.url),'utf8'));
const openaiSkill=await readFile(new URL('../integrations/openai/skills/lta-account-planning/SKILL.md',import.meta.url),'utf8');
const openaiSubmission=await readFile(new URL('../integrations/openai/SUBMISSION.md',import.meta.url),'utf8');
const grokCatalog=await readFile(new URL('../integrations/grok/CATALOG_REQUEST.md',import.meta.url),'utf8');
const grokEmail=await readFile(new URL('../integrations/grok/REQUEST_EMAIL.md',import.meta.url),'utf8');

assert.equal(openaiPlugin.name,'lta');
assert.equal(openaiPlugin.version,'3.0.0');
assert.equal(openaiPlugin.author.name,'Eason Systems');
const allowedManifestKeys=new Set(['$schema','name','version','description','author','homepage','repository','license','keywords','extensions']);
for(const key of Object.keys(openaiPlugin))assert.ok(allowedManifestKeys.has(key),'unsupported portable plugin manifest key: '+key);
assert.equal('skills' in openaiPlugin,false,'portable plugins discover skills from the fixed skills/ directory');
assert.equal(openaiMcp.mcpServers.link2ai.type,'streamable-http');
assert.equal(openaiMcp.mcpServers.link2ai.url,'https://api-production-0383e.up.railway.app/mcp/openai');

assert.match(openaiSkill,/check_link_support/);
assert.match(openaiSkill,/get_supported_sources/);
assert.match(openaiSkill,/estimate_processing_units/);
assert.match(openaiSkill,/get_usage/);
assert.match(openaiSkill,/does not fetch, scrape, proxy, relay, summarize, transcribe, or return content from third-party websites or APIs/i);
assert.doesNotMatch(openaiSkill,/read_public_link|read_public_links|get_transcript_result|get_visual_assets|find_in_link/);

assert.match(openaiSubmission,/Contains MCP/);
assert.match(openaiSubmission,/Universal/);
assert.match(openaiSubmission,/\.well-known\/openai-apps-challenge/);
assert.match(openaiSubmission,/\/mcp\/openai/);
assert.match(openaiSubmission,/exactly four tools/i);
assert.match(openaiSubmission,/first-party account and planning companion/i);
assert.match(openaiSubmission,/reviewer email\/password/i);
assert.match(openaiSubmission,/must not require MFA/i);
for(const tool of ['check_link_support','get_supported_sources','estimate_processing_units','get_usage'])assert.match(openaiSubmission,new RegExp('### '+tool));
assert.match(openaiSubmission,/Only after every gate above passes should Scan Tools be run/i);

assert.match(grokCatalog,/Connector Catalog/);
assert.match(grokCatalog,/search LTA → Connect → LTA OAuth/);
assert.match(grokCatalog,/must not need to copy an MCP URL/i);
assert.match(grokCatalog,/distribution approval/i);
assert.match(grokCatalog,/https:\/\/docs\.x\.ai\/grok\/connectors/);
assert.match(grokEmail,/Grok Connector Catalog distribution request/);
assert.match(grokEmail,/without manually entering an MCP URL/);

for(const body of [openaiSubmission,grokCatalog,grokEmail]){
  assert.doesNotMatch(body,/REVIEWER_PASSWORD\s*=|REVIEWER_EMAIL\s*=.*@/,'distribution docs must not embed reviewer secrets');
}

console.log('V3 distribution package tests PASS');
