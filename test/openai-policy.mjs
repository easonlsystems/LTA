import assert from 'node:assert/strict';
import {assertPlatformAllowedForProfile,parseAllowedMediaUrl,platformAllowedForProfile,supportedSourcesForProfile} from '../dist/src/mcp/policy.js';

const allowed=[
  ['https://bsky.app/profile/bsky.app/post/3mnzpiackwk25','bluesky'],
  ['https://github.com/nodejs/node/issues/64850','github'],
  ['https://news.ycombinator.com/item?id=8863','hackernews']
];
for(const [url,platform] of allowed){
  const parsed=parseAllowedMediaUrl(url,'openai');
  assert.equal(parsed.platform,platform);
  assert.equal(platformAllowedForProfile(parsed.platform,'openai'),true);
}

const blocked=[
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ','youtube'],
  ['https://www.instagram.com/reel/ABCdef123_/','instagram'],
  ['https://www.tiktok.com/@user/video/7123456789012345678','tiktok'],
  ['https://x.com/githubstatus/status/2039764648241598521','x'],
  ['https://www.reddit.com/comments/1w8skpx/','reddit'],
  ['https://example.com/article','web'],
  ['https://example.com/report.pdf','pdf']
];
for(const [url,platform] of blocked){
  assert.throws(
    ()=>parseAllowedMediaUrl(url,'openai'),
    error=>error?.code==='PLATFORM_BLOCKED'
      && error?.details?.cause_code==='openai_distribution_source_not_authorized'
      && error?.details?.platform===platform
  );
  assert.doesNotThrow(()=>parseAllowedMediaUrl(url,'default'));
}

assert.doesNotThrow(()=>assertPlatformAllowedForProfile('github','openai'));
assert.throws(()=>assertPlatformAllowedForProfile('youtube','openai'),error=>error?.code==='PLATFORM_BLOCKED');
const openaiSources=supportedSourcesForProfile('openai',true);
assert.match(openaiSources,/Bluesky/);
assert.match(openaiSources,/GitHub/);
assert.match(openaiSources,/Hacker News/);
assert.doesNotMatch(openaiSources,/YouTube|Instagram|TikTok|\bX\b|Reddit|PDF|webpage/i);

console.log('OpenAI distribution policy tests PASS');
