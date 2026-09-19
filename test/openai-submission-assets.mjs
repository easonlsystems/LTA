import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const cases=await readFile(new URL('../integrations/openai/REVIEW_CASES.md',import.meta.url),'utf8');
const demo=await readFile(new URL('../integrations/openai/DEMO_VIDEO.md',import.meta.url),'utf8');
const release=await readFile(new URL('../integrations/openai/RELEASE_NOTES.md',import.meta.url),'utf8');
const submission=await readFile(new URL('../integrations/openai/SUBMISSION.md',import.meta.url),'utf8');
const mcp=JSON.parse(await readFile(new URL('../integrations/openai/mcp.json',import.meta.url),'utf8'));
const skill=await readFile(new URL('../integrations/openai/skills/read-public-links/SKILL.md',import.meta.url),'utf8');

assert.equal((cases.match(/^### P\d+ /gm)||[]).length,5,'OpenAI remote MCP submission requires exactly five positive cases');
assert.equal((cases.match(/^### N\d+ /gm)||[]).length,3,'OpenAI remote MCP submission requires exactly three negative cases');
assert.doesNotMatch(cases,/<REVIEW_[A-Z0-9_]+>/,'OpenAI review cases must not contain placeholder fixture URLs');
assert.match(cases,/https:\/\/www\.instagram\.com\/reel\/DdNnHPip4RD\//,'OpenAI review must demonstrate Instagram Reel value');
assert.match(cases,/https:\/\/www\.youtube\.com\/watch\?v=M7lc1UVf-VE/,'OpenAI review must demonstrate YouTube value');
assert.match(cases,/https:\/\/news\.ycombinator\.com\/item\?id=37137448/,'OpenAI Hacker News review fixture must be pinned');
assert.match(cases,/https:\/\/github\.com\/nodejs\/node\/issues\/65470[\s\S]*https:\/\/github\.com\/nodejs\/node\/pull\/65472/,'OpenAI multi-source fixture must compare a compact related Node.js issue\/PR pair');

assert.equal(mcp.mcpServers.link2ai.url,'https://api-production-0383e.up.railway.app/mcp/openai');
assert.match(skill,/same exact-public-source categories as its default\/Claude distribution/i);
assert.match(skill,/YouTube and YouTube Shorts/i);
assert.match(skill,/Instagram Reels/i);
assert.match(skill,/TikTok/i);
assert.match(skill,/readable public HTTPS webpages/i);
assert.match(skill,/text-layer PDFs/i);
assert.match(skill,/explicitly asks to use Link2AI/i,'Skill must honor explicit Link2AI requests');
assert.match(skill,/do not spend Link2AI processing units/i,'Skill must avoid unnecessary quota use when native access is sufficient');
assert.match(skill,/server logs/i,'Skill must keep logs and internal diagnostics out of normal user-facing answers');
assert.doesNotMatch(skill,/plan_info_url|checkout_url/i,'Skill must not instruct ChatGPT to surface purchase or checkout URLs');

assert.match(cases,/continuation_required/);
assert.match(cases,/Failed reads consume 0 processing units/);
assert.match(demo,/production, not localhost/i);
assert.match(demo,/Do not show passwords, tokens, client secrets/i);
assert.match(demo,/\/mcp\/openai/);
assert.match(demo,/DdNnHPip4RD/,'Demo must show Instagram Reel support');
assert.match(demo,/M7lc1UVf-VE/,'Demo must show YouTube support');
assert.match(demo,/nodejs\/node\/pull\/65472/,'Demo must include the same GitHub fixture as formal review');
assert.match(release,/first public OpenAI Plugin Directory submission/i);
assert.match(release,/same supported-source matrix as Link2AI's default\/Claude distribution/i);
assert.match(submission,/interface\.logo/);
assert.match(submission,/interface\.composerIcon/);
assert.match(submission,/demo video URL/i);
console.log('OpenAI final-submission asset tests PASS');
