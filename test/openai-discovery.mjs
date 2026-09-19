import assert from 'node:assert/strict';
import {isUnauthenticatedMcpDiscoveryRequest} from '../dist/src/mcp/discovery.js';

for(const method of [
  'initialize',
  'notifications/initialized',
  'ping',
  'tools/list',
  'prompts/list',
  'resources/list',
  'resources/templates/list'
]){
  assert.equal(
    isUnauthenticatedMcpDiscoveryRequest({jsonrpc:'2.0',id:1,method}),
    true,
    method+' must be allowed for unauthenticated MCP metadata discovery'
  );
}

for(const method of [
  'tools/call',
  'resources/read',
  'prompts/get',
  'completion/complete',
  'logging/setLevel'
]){
  assert.equal(
    isUnauthenticatedMcpDiscoveryRequest({jsonrpc:'2.0',id:1,method}),
    false,
    method+' must remain behind OAuth'
  );
}

assert.equal(isUnauthenticatedMcpDiscoveryRequest({}),false);
assert.equal(isUnauthenticatedMcpDiscoveryRequest(null),false);
assert.equal(isUnauthenticatedMcpDiscoveryRequest([]),false);
assert.equal(
  isUnauthenticatedMcpDiscoveryRequest([
    {jsonrpc:'2.0',id:1,method:'tools/list'},
    {jsonrpc:'2.0',id:2,method:'resources/list'}
  ]),
  true
);
assert.equal(
  isUnauthenticatedMcpDiscoveryRequest([
    {jsonrpc:'2.0',id:1,method:'tools/list'},
    {jsonrpc:'2.0',id:2,method:'tools/call'}
  ]),
  false,
  'mixed batches must not smuggle an authenticated operation through discovery'
);

console.log('OpenAI unauthenticated discovery tests PASS');
