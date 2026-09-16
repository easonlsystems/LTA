import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [source,envSource,mcpSource]=await Promise.all([
  readFile(new URL('../src/content/linkText.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/config/env.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/mcp/server.ts',import.meta.url),'utf8')
]);
assert.match(envSource,/REDDIT_CLIENT_ID/);
assert.match(envSource,/REDDIT_CLIENT_SECRET/);
assert.match(source,/https:\/\/www\.reddit\.com\/api\/v1\/access_token/,'Reddit must obtain an OAuth access token');
assert.match(source,/https:\/\/oauth\.reddit\.com\/comments\//,'Reddit content must use the OAuth Data API host');
assert.match(source,/grant_type=client_credentials/);
assert.match(source,/reddit_oauth_not_configured/,'Missing approved OAuth must fail explicitly');
assert.match(source,/503,false,\{cause_code:'reddit_oauth_not_configured'/,'Missing OAuth must be non-retryable');
assert.doesNotMatch(source,/curl_cffi/,'Reddit must not use browser fingerprint impersonation to bypass platform controls');
assert.doesNotMatch(source,/old\.reddit\.com\/comments\/\$\{id\}/,'Reddit must not fall back to scraping old.reddit HTML');
assert.match(mcpSource,/redditReady/,'MCP source advertising must reflect Reddit runtime readiness');
console.log('reddit egress schema tests PASS');
