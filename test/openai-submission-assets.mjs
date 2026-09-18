import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const cases=await readFile(new URL('../integrations/openai/REVIEW_CASES.md',import.meta.url),'utf8');
const demo=await readFile(new URL('../integrations/openai/DEMO_VIDEO.md',import.meta.url),'utf8');
const release=await readFile(new URL('../integrations/openai/RELEASE_NOTES.md',import.meta.url),'utf8');
const submission=await readFile(new URL('../integrations/openai/SUBMISSION.md',import.meta.url),'utf8');

assert.equal((cases.match(/^### P\d+ /gm)||[]).length,5,'OpenAI remote MCP submission requires exactly five positive cases');
assert.equal((cases.match(/^### N\d+ /gm)||[]).length,3,'OpenAI remote MCP submission requires exactly three negative cases');
assert.match(cases,/continuation_required/);
assert.match(cases,/Failed reads consume 0 processing units/);
assert.match(demo,/production, not localhost/i);
assert.match(demo,/Do not show passwords, tokens, client secrets/i);
assert.match(release,/first public OpenAI Plugin Directory submission/i);
assert.match(submission,/interface\.logo/);
assert.match(submission,/interface\.composerIcon/);
assert.match(submission,/demo video URL/i);
console.log('OpenAI final-submission asset tests PASS');
