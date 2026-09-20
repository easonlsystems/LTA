import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [cacheSource,serviceSource]=await Promise.all([
  readFile(new URL('../src/worker/cache.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/source/service.ts',import.meta.url),'utf8')
]);

assert.match(
  cacheSource,
  /hackernews:'2026-09-18T18:05:44\.000Z'/,
  'Hacker News cache provenance must start after the old worker stopped and /mcp/openai was live'
);
assert.ok(
  cacheSource.includes("clauses.push('created_at >= $'+params.length+'::timestamptz')"),
  'shared HN cache reuse must reject pre-cutover cache rows'
);
assert.ok(
  cacheSource.includes("clauses.push('c.created_at >= $'+params.length+'::timestamptz')"),
  'same-user HN cache reuse must reject pre-cutover cache rows'
);
assert.match(
  serviceSource,
  /cacheProvenanceEpoch\(parsed\.platform\)/,
  'MCP same-source completed reuse must use source provenance'
);
assert.ok(
  serviceSource.includes("AND ($5::timestamptz IS NULL OR c.created_at >= $5::timestamptz)"),
  'MCP completed-job reuse must enforce the HN provenance epoch'
);
assert.match(
  serviceSource,
  /profile==='openai'[\s\S]*source_fetched_at[\s\S]*TRANSCRIPT_EXPIRED/,
  'ChatGPT job-id reads must reject completed HN results from before the approved retrieval path'
);

console.log('OpenAI HN provenance tests PASS');
