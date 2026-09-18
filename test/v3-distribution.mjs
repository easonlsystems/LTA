import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const openaiPlugin=JSON.parse(await readFile(new URL('../integrations/openai/plugin.json',import.meta.url),'utf8'));
const openaiMcp=JSON.parse(await readFile(new URL('../integrations/openai/mcp.json',import.meta.url),'utf8'));
const openaiSkill=await readFile(new URL('../integrations/openai/skills/read-public-links/SKILL.md',import.meta.url),'utf8');
const openaiSubmission=await readFile(new URL('../integrations/openai/SUBMISSION.md',import.meta.url),'utf8');
const grokCatalog=await readFile(new URL('../integrations/grok/CATALOG_REQUEST.md',import.meta.url),'utf8');
const grokEmail=await readFile(new URL('../integrations/grok/REQUEST_EMAIL.md',import.meta.url),'utf8');

assert.equal(openaiPlugin.name,'link2ai');
assert.equal(openaiPlugin.version,'3.0.0');
assert.equal(openaiPlugin.author.name,'Eason Systems');
const allowedManifestKeys=new Set(['$schema','name','version','description','author','homepage','repository','license','keywords','extensions']);
for(const key of Object.keys(openaiPlugin))assert.ok(allowedManifestKeys.has(key),'unsupported portable plugin manifest key: '+key);
assert.equal('skills' in openaiPlugin,false,'portable plugins discover skills from the fixed skills/ directory');
assert.equal(openaiMcp.mcpServers.link2ai.type,'streamable-http');
assert.equal(openaiMcp.mcpServers.link2ai.url,'https://api-production-0383e.up.railway.app/mcp');

assert.match(openaiSkill,/read_public_link/);
assert.match(openaiSkill,/continuation_required/);
assert.match(openaiSkill,/source_completeness/);
assert.match(openaiSkill,/payment_required/);
assert.match(openaiSkill,/untrusted external content/);
assert.match(openaiSkill,/Do not invoke Link2AI just because a URL appears/);

assert.match(openaiSubmission,/Contains MCP/);
assert.match(openaiSubmission,/Universal/);
assert.match(openaiSubmission,/OPENAI_APPS_CHALLENGE/);
assert.match(openaiSubmission,/reviewer email\/password/i);
assert.match(openaiSubmission,/must not require MFA/i);
assert.match(openaiSubmission,/security schemes, output schemas, and accurate annotations/i);

assert.match(grokCatalog,/Connector Catalog/);
assert.match(grokCatalog,/search Link2AI → Connect → Link2AI OAuth/);
assert.match(grokCatalog,/must not need to copy an MCP URL/i);
assert.match(grokCatalog,/distribution approval/i);
assert.match(grokCatalog,/https:\/\/docs\.x\.ai\/grok\/connectors/);
assert.match(grokEmail,/Grok Connector Catalog distribution request/);
assert.match(grokEmail,/without manually entering an MCP URL/);

for(const content of [openaiSubmission,grokCatalog,grokEmail]){
  assert.doesNotMatch(content,/REVIEWER_PASSWORD\s*=|REVIEWER_EMAIL\s*=.*@/,'distribution docs must not embed reviewer secrets');
}

console.log('V3 distribution package tests PASS');
