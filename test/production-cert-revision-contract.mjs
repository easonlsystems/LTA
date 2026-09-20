import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [workflow,cert,api]=await Promise.all([
  readFile(new URL('../.github/workflows/production-certification.yml',import.meta.url),'utf8'),
  readFile(new URL('../test/production-public-cert.mjs',import.meta.url),'utf8'),
  readFile(new URL('../src/api/main.ts',import.meta.url),'utf8')
]);

assert.match(workflow,/LINK2AI_EXPECTED_REVISION:\s*\$\{\{\s*github\.sha\s*\}\}/,'production workflow must certify the triggering main commit');
assert.match(cert,/Production certification requires LINK2AI_EXPECTED_REVISION/);
assert.match(cert,/healthData\.revision,expectedRevision/,'production gate must wait for the exact deployed revision');
assert.match(cert,/data\.revision,expectedRevision/,'health assertion must remain revision-bound');
assert.match(api,/RAILWAY_GIT_COMMIT_SHA/,'healthz must expose Railway deployment revision');
assert.match(api,/revision:/);

console.log('production certification revision contract tests PASS');
