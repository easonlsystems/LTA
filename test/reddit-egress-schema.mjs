import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../src/content/linkText.ts',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../src/worker/preflight.ts',import.meta.url),'utf8');
const docker=fs.readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');

assert.ok(source.includes('fetchRedditJsonViaBrowserFingerprint'));
assert.ok(source.includes('from curl_cffi import requests'));
assert.match(source,/impersonate=.*chrome/);
assert.ok(source.includes('https://www.reddit.com/comments/{post_id}'));
assert.ok(source.includes('https://old.reddit.com/comments/{post_id}'));
assert.ok(source.includes('https://api.reddit.com/comments/{post_id}'));
assert.ok(source.includes('parseRedditJson(input,await fetchRedditJsonViaBrowserFingerprint(input.canonicalMediaId))'));
assert.ok(!source.includes('fetchRedditJsonViaBrowserFingerprint(input.normalizedUrl)'));
assert.ok(worker.includes('import curl_cffi'));
assert.ok(docker.includes('yt-dlp[default,curl-cffi]'));
console.log('reddit egress schema tests PASS');
