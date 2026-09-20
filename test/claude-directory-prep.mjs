import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [mcp,pack]=await Promise.all([
  readFile(new URL('../src/mcp/server.ts',import.meta.url),'utf8'),
  readFile(new URL('../docs/CLAUDE_DIRECTORY_SUBMISSION.md',import.meta.url),'utf8')
]);

for(const phrase of [
  'Do not call Link2AI merely because',
  'native source access is already sufficient',
  'Reuse a successful result for the same source',
  'rather than assuming the link is inaccessible',
  'before answering',
  'Do not provide checkout, purchase, upgrade, top-up'
]){
  assert.equal(mcp.toLowerCase().includes(phrase.toLowerCase()),false,'MCP directory-facing guidance must not contain steering phrase: '+phrase);
}

assert.match(mcp,/Read one supported public URL and return AI-readable source context/);
assert.match(mcp,/Read two or more supported public URLs in one request/);
assert.match(mcp,/Return the current result or a later text slice/);
assert.match(mcp,/Search the text of an already processed Link2AI source/);
assert.match(mcp,/Return a compact timeline map/);
assert.match(mcp,/authoritative available processing-unit balance/);

assert.match(pack,/Status: PREPARED, NOT CLEARED FOR SUBMISSION/);
assert.match(pack,/third-party websites and APIs that Link2AI does not own or control/i);
assert.match(pack,/do not submit yet/i);
assert.equal(/l2ai_live_[A-Za-z0-9_-]{8,}/.test(pack),false,'submission pack must not contain an API key');

console.log('Claude Directory prep tests PASS');
