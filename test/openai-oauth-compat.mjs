import assert from 'node:assert/strict';
import {openAiIssuedResourceOverride} from '../dist/src/auth/openaiCompat.js';

const normal='https://api-production-0383e.up.railway.app/mcp';
const openai='https://api-production-0383e.up.railway.app/mcp/openai';

assert.equal(
  openAiIssuedResourceOverride('openai-connectors-oauth/1.0',normal,normal,openai),
  openai,
  'official OpenAI token exchange must narrow the legacy /mcp audience to /mcp/openai'
);
assert.equal(
  openAiIssuedResourceOverride('OPENAI-CONNECTORS-OAUTH/2.1.3',normal,normal,openai),
  openai,
  'official OpenAI token-exchanger matching must be case-insensitive'
);
assert.equal(
  openAiIssuedResourceOverride('Mozilla/5.0',normal,normal,openai),
  undefined,
  'browser and non-OpenAI clients must not be rewritten'
);
assert.equal(
  openAiIssuedResourceOverride('openai-connectors-oauth/1.0',openai,normal,openai),
  undefined,
  'already-correct OpenAI resource must not need compatibility rewriting'
);
assert.equal(
  openAiIssuedResourceOverride('openai-connectors-oauth/1.0','https://example.com/mcp',normal,openai),
  undefined,
  'unrelated resources must never be rewritten'
);
assert.equal(
  openAiIssuedResourceOverride('openai-connectors-oauth/1.0',normal,normal,normal),
  undefined,
  'compatibility rule must never widen or keep an identical audience'
);

console.log('OpenAI OAuth audience compatibility tests PASS');
