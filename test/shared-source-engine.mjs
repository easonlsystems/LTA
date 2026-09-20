import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [sourceService,sourcePolicy,mcpServer,mcpService,mcpPolicy]=await Promise.all([
  readFile(new URL('../src/source/service.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/source/policy.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/mcp/server.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/mcp/service.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/mcp/policy.ts',import.meta.url),'utf8')
]);

assert.doesNotMatch(sourceService,/\.\.\/mcp\//,'shared source service must not depend on the MCP transport layer');
assert.doesNotMatch(sourcePolicy,/\.\.\/mcp\//,'shared source policy must not depend on the MCP transport layer');
assert.match(mcpServer,/\.\.\/source\/service\.js/,'MCP must consume the shared source service');
assert.match(mcpServer,/\.\.\/source\/policy\.js/,'MCP must consume the shared source policy');
assert.match(mcpService,/export \* from '\.\.\/source\/service\.js'/,'legacy MCP service module must only re-export the shared service');
assert.match(mcpPolicy,/export \* from '\.\.\/source\/policy\.js'/,'legacy MCP policy module must only re-export the shared policy');

console.log('shared source engine architecture tests PASS');
