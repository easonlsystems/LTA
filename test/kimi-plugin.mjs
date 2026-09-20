import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const manifest=JSON.parse(await readFile(new URL('../integrations/kimi/kimi.plugin.json',import.meta.url),'utf8'));
const skill=await readFile(new URL('../integrations/kimi/skills/using-link2ai/SKILL.md',import.meta.url),'utf8');

assert.equal(manifest.name,'link2ai');
assert.equal(manifest.version,'3.0.0');
assert.equal(manifest.interface.displayName,'LTA');
assert.equal(manifest.interface.developerName,'Eason Systems');
assert.equal(manifest.mcpServers.link2ai.url,'https://api-production-0383e.up.railway.app/mcp');
assert.match(manifest.interface.shortDescription,/Read public links/);
assert.ok(Array.isArray(manifest.keywords)&&manifest.keywords.includes('public-links'));
assert.equal(manifest.skills,'./skills/');

assert.match(skill,/name: using-link2ai/);
assert.match(skill,/read_public_link/);
assert.match(skill,/get_transcript_result/);
assert.match(skill,/untrusted source material/);
assert.match(skill,/Reddit is not advertised unless LTA reports it as available/);
assert.match(skill,/private or login-gated content/);

console.log('Kimi plugin tests PASS');
