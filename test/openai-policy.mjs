import assert from 'node:assert/strict';
import {assertPlatformAllowedForProfile,parseAllowedMediaUrl,platformAllowedForProfile,supportedSourcesForProfile} from '../dist/src/mcp/policy.js';

const openaiAllowed=[
  ['https://bsky.app/profile/bsky.app/post/3mnzpiackwk25','bluesky'],
  ['https://github.com/nodejs/node/issues/64850','github'],
  ['https://news.ycombinator.com/item?id=8863','hackernews']
];

const openaiBlocked=[
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ','youtube'],
  ['https://www.instagram.com/reel/ABCdef123_/','instagram'],
  ['https://www.tiktok.com/@user/video/7123456789012345678','tiktok'],
  ['https://x.com/githubstatus/status/2039764648241598521','x'],
  ['https://www.reddit.com/comments/1w8skpx/','reddit'],
  ['https://example.com/article','web'],
  ['https://example.com/report.pdf','pdf']
];

for(const [url,platform] of openaiAllowed){
  const parsedOpenai=parseAllowedMediaUrl(url,'openai');
  const parsedDefault=parseAllowedMediaUrl(url,'default');
  assert.equal(parsedOpenai.platform,platform);
  assert.equal(parsedDefault.platform,platform);
  assert.equal(platformAllowedForProfile(parsedOpenai.platform,'openai'),true);
  assert.equal(platformAllowedForProfile(parsedDefault.platform,'default'),true);
  assert.doesNotThrow(()=>assertPlatformAllowedForProfile(parsedOpenai.platform,'openai'));
}

for(const [url,platform] of openaiBlocked){
  const parsedDefault=parseAllowedMediaUrl(url,'default');
  assert.equal(parsedDefault.platform,platform);
  assert.equal(platformAllowedForProfile(parsedDefault.platform,'default'),true);
  assert.equal(platformAllowedForProfile(parsedDefault.platform,'openai'),false);
  assert.throws(
    ()=>parseAllowedMediaUrl(url,'openai'),
    error=>error?.code==='PLATFORM_BLOCKED'&&error?.details?.cause_code==='openai_source_not_authorized'
  );
}

const openaiSources=supportedSourcesForProfile('openai',true);
const defaultSources=supportedSourcesForProfile('default',true);
assert.equal(openaiSources,'Bluesky, GitHub Issue/PR, or Hacker News');
assert.match(defaultSources,/YouTube/);
assert.match(defaultSources,/Instagram/);
assert.match(defaultSources,/TikTok/);
assert.match(defaultSources,/\bX\b/);
assert.match(defaultSources,/Reddit/);
assert.match(defaultSources,/Bluesky/);
assert.match(defaultSources,/GitHub/);
assert.match(defaultSources,/Hacker News/);
assert.match(defaultSources,/webpage/);
assert.match(defaultSources,/PDF/);

console.log('OpenAI distribution policy tests PASS');
