import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const cases=await readFile(new URL('../integrations/openai/REVIEW_CASES.md',import.meta.url),'utf8');
const demo=await readFile(new URL('../integrations/openai/DEMO_VIDEO.md',import.meta.url),'utf8');
const release=await readFile(new URL('../integrations/openai/RELEASE_NOTES.md',import.meta.url),'utf8');
const submission=await readFile(new URL('../integrations/openai/SUBMISSION.md',import.meta.url),'utf8');
const plugin=JSON.parse(await readFile(new URL('../integrations/openai/plugin.json',import.meta.url),'utf8'));
const mcp=JSON.parse(await readFile(new URL('../integrations/openai/mcp.json',import.meta.url),'utf8'));
const skill=await readFile(new URL('../integrations/openai/skills/lta-account-planning/SKILL.md',import.meta.url),'utf8');
const {OPENAI_FIRST_PARTY_SKILL_MD,OPENAI_FIRST_PARTY_SKILL_NAME,OPENAI_FIRST_PARTY_SKILL_URI,OPENAI_FIRST_PARTY_SKILL_DIGEST}=await import('../dist/src/mcp/openaiFirstPartySkill.js');

assert.equal((cases.match(/^### P\d+ /gm)||[]).length,5,'OpenAI remote MCP submission requires exactly five positive cases');
assert.equal((cases.match(/^### N\d+ /gm)||[]).length,3,'OpenAI remote MCP submission requires exactly three negative cases');
assert.doesNotMatch(cases,/<REVIEW_[A-Z0-9_]+>/,'Review cases must not contain placeholders');
for(const tool of ['check_link_support','get_supported_sources','estimate_processing_units','get_usage'])assert.match(cases,new RegExp('`'+tool+'`'),'Review cases must exercise '+tool);
assert.match(cases,/directory_content_access=false/);
assert.match(cases,/network_request_made=false/);
assert.match(cases,/third-party source contents/i);

assert.equal(plugin.name,'lta');
assert.match(plugin.description,/source-format compatibility/i);
assert.doesNotMatch(plugin.description,/read supported public|source content is not reliably available/i);
assert.equal(mcp.mcpServers.link2ai.url,'https://api-production-0383e.up.railway.app/mcp/openai');

assert.equal(OPENAI_FIRST_PARTY_SKILL_NAME,'use-lta-account-and-source-planning');
assert.equal(OPENAI_FIRST_PARTY_SKILL_URI,'skill://lta/use-lta-account-and-source-planning/SKILL.md');
assert.match(OPENAI_FIRST_PARTY_SKILL_DIGEST,/^sha256:[0-9a-f]{64}$/);
assert.equal(skill.trim(),OPENAI_FIRST_PARTY_SKILL_MD.trim(),'Submission Skill must exactly match runtime first-party Skill');
for(const tool of ['check_link_support','get_supported_sources','estimate_processing_units','get_usage'])assert.match(skill,new RegExp('`'+tool+'`'),'Skill must document '+tool);
assert.match(skill,/does not fetch, scrape, proxy, relay, summarize, transcribe, or return content from third-party websites or APIs/i);
assert.doesNotMatch(skill,/read_public_link|read_public_links|get_transcript_result|get_visual_assets|find_in_link|get_video_/);
assert.match(skill,/general-audience only/i);
assert.match(skill,/Do not initiate, promote, or provide checkout, purchase, subscription, upgrade, top-up, or transaction links from ChatGPT/i);

assert.match(demo,/production, not localhost/i);
assert.match(demo,/exactly four tools/i);
assert.match(demo,/network_request_made=false/);
assert.match(demo,/directory_content_access=false/);
assert.match(demo,/does not claim to read or retrieve the video contents/i);
assert.match(release,/first public OpenAI Plugin Directory submission/i);
assert.match(release,/first-party LTA account and planning companion/i);
assert.match(release,/does not fetch, scrape, proxy, relay, summarize, transcribe, or return content from third-party websites or APIs/i);

assert.match(submission,/exactly four tools/i);
assert.match(submission,/Final policy-attestation evidence map/i);
assert.match(submission,/does not access or return third-party website content or third-party API responses/i);
assert.match(submission,/not an unofficial connector or pass-through intermediary/i);
assert.match(submission,/Only after every gate above passes should Scan Tools be run/i);
for(const oldTool of ['read_public_link','read_public_links','get_transcript_result','get_visual_assets','find_in_link','get_video_transcript','get_video_time_range','get_video_map']){
  assert.match(submission,new RegExp('`'+oldTool+'`'),'Submission must explicitly list excluded legacy tool '+oldTool);
}
assert.match(submission,/interface\.logo/);
assert.match(submission,/interface\.composerIcon/);
assert.match(submission,/demo video URL/i);

console.log('OpenAI first-party submission asset tests PASS');
