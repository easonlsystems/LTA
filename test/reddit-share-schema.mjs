import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [urlSource,linkSource,processorSource]=await Promise.all([
  readFile(new URL('../src/media/url.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/content/linkText.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/worker/processor.ts',import.meta.url),'utf8')
]);

assert.match(urlSource,/parts\[0\]==='r'&&parts\[2\]==='s'/,'Reddit subreddit /s/ share URLs must be recognized');
assert.match(urlSource,/parts\[0\]==='s'&&parts\.length===2/,'Direct reddit.com\/s\/ share URLs must be recognized');
assert.match(urlSource,/canonicalMediaId:`share_\$\{sha256\(normalizedUrl\)\.slice\(0,24\)\}`/,'Opaque share tokens must use a temporary non-post cache key');
assert.match(linkSource,/export async function resolveRedditSharePost/,'Reddit share URLs need an explicit pre-quota handling step');
assert.match(linkSource,/reddit_opaque_share_url/,'Opaque Reddit share URLs must fail clearly without scraping around access controls');

const resolveIndex=processorSource.indexOf("parsed=await resolveRedditSharePost(parsed)");
const nonMediaIndex=processorSource.indexOf("if(parsed.kind!=='media')");
const firstQuotaIndex=processorSource.indexOf('await reserveQuota',resolveIndex);
assert.ok(resolveIndex>=0,'Worker must resolve Reddit share URLs');
assert.ok(nonMediaIndex>resolveIndex,'Worker must resolve the share URL before entering the text extraction path');
assert.ok(firstQuotaIndex>resolveIndex,'Worker must resolve the canonical Reddit post before quota reservation');
assert.match(processorSource,/findUserCompletedCache\(job\.user_id,job\.platform,parsed\.canonicalMediaId\)/,'Worker must re-check the user cache with the resolved post id');
assert.doesNotMatch(processorSource,/share_url:|share_key:/,'Opaque Reddit share identifiers must not be written to structured logs');

console.log('reddit share schema tests PASS');
