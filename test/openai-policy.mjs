import assert from 'node:assert/strict';
import {assertPlatformAllowedForProfile,parseAllowedMediaUrl,platformAllowedForProfile,supportedSourcesForProfile} from '../dist/src/mcp/policy.js';

const authorized=[
  ['https://bsky.app/profile/bsky.app/post/3mnzpiackwk25','bluesky'],
  ['https://github.com/nodejs/node/issues/64850','github'],
  ['https://news.ycombinator.com/item?id=8863','hackernews']
];

const blockedForOpenAi=[
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ','youtube'],
  ['https://www.instagram.com/reel/ABCdef123_/','instagram'],
  ['https://www.tiktok.com/@user/video/7123456789012345678','tiktok'],
  ['https://x.com/githubstatus/status/2039764648241598521','x'],
  ['https://www.reddit.com/comments/1w8skpx/','reddit'],
  ['https://example.com/article','web'],
  ['https://example.com/report.pdf','pdf']
];

for(const [url,platform] of authorized){
  const parsedOpenai=parseAllowedMediaUrl(url,'openai');
  const parsedDefault=parseAllowedMediaUrl(url,'default');
  assert.equal(parsedOpenai.platform,platform);
  assert.equal(parsedDefault.platform,platform);
  assert.equal(platformAllowedForProfile(parsedOpenai.platform,'openai'),true);
  assert.equal(platformAllowedForProfile(parsedDefault.platform,'default'),true);
  assert.doesNotThrow(()=>assertPlatformAllowedForProfile(parsedOpenai.platform,'openai'));
}

for(const [url,platform] of blockedForOpenAi){
  const parsedDefault=parseAllowedMediaUrl(url,'default');
  assert.equal(parsedDefault.platform,platform,'default/Claude source support must not shrink');
  assert.equal(platformAllowedForProfile(parsedDefault.platform,'default'),true);
  assert.equal(platformAllowedForProfile(parsedDefault.platform,'openai'),false);
  assert.throws(()=>parseAllowedMediaUrl(url,'openai'),error=>
    error?.code==='PLATFORM_BLOCKED'&&error?.details?.cause_code==='openai_source_not_authorized'
  );
}

const openaiSources=supportedSourcesForProfile('openai',true);
const defaultSources=supportedSourcesForProfile('default',true);
assert.match(openaiSources,/Bluesky/);
assert.match(openaiSources,/GitHub/);
assert.match(openaiSources,/Hacker News/);
assert.doesNotMatch(openaiSources,/YouTube|Instagram|TikTok|\bX\b|Reddit|webpage|PDF/);
for(const expected of ['YouTube','Instagram','TikTok','X','Reddit','Bluesky','GitHub','Hacker News','webpage','PDF']){
  assert.ok(defaultSources.includes(expected),'default/Claude matrix must retain '+expected);
}

console.log('OpenAI authorized-source policy tests PASS');
