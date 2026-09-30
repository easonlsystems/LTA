import assert from 'node:assert/strict';
import {assertPlatformAllowedForProfile,parseAllowedMediaUrl,platformAllowedForProfile,supportedSourcesForProfile} from '../dist/src/mcp/policy.js';

const github='https://github.com/gnembon/scarpet/issues/408';
const parsedOpenai=parseAllowedMediaUrl(github,'openai');
const parsedDefault=parseAllowedMediaUrl(github,'default');
assert.equal(parsedOpenai.platform,'github');
assert.equal(parsedDefault.platform,'github');
assert.equal(platformAllowedForProfile('github','openai'),true);
assert.equal(platformAllowedForProfile('github','default'),true);
assert.doesNotThrow(()=>assertPlatformAllowedForProfile('github','openai'));

const blockedForOpenAi=[
  ['https://bsky.app/profile/bsky.app/post/3mnzpiackwk25','bluesky'],
  ['https://news.ycombinator.com/item?id=8863','hackernews'],
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ','youtube'],
  ['https://www.instagram.com/reel/ABCdef123_/','instagram'],
  ['https://www.tiktok.com/@user/video/7123456789012345678','tiktok'],
  ['https://x.com/githubstatus/status/2039764648241598521','x'],
  ['https://www.reddit.com/comments/1w8skpx/','reddit'],
  ['https://example.com/article','web'],
  ['https://example.com/report.pdf','pdf']
];

for(const [url,platform] of blockedForOpenAi){
  const parsed=parseAllowedMediaUrl(url,'default');
  assert.equal(parsed.platform,platform,'default/Claude source support must not shrink');
  assert.equal(platformAllowedForProfile(parsed.platform,'default'),true);
  assert.equal(platformAllowedForProfile(parsed.platform,'openai'),false);
  assert.throws(()=>parseAllowedMediaUrl(url,'openai'),error=>
    error?.code==='PLATFORM_BLOCKED'&&error?.details?.cause_code==='openai_source_not_authorized'
  );
}

const openaiSources=supportedSourcesForProfile('openai',true);
const defaultSources=supportedSourcesForProfile('default',true);
assert.match(openaiSources,/GitHub Issue\/PR/);
assert.match(openaiSources,/CC0-1\.0/);
assert.match(openaiSources,/0BSD/);
assert.match(openaiSources,/Unlicense/);
assert.doesNotMatch(openaiSources,/Bluesky|Hacker News|YouTube|Instagram|TikTok|\bX\b|Reddit|webpage|PDF/);
for(const expected of ['YouTube','Instagram','TikTok','X','Reddit','Bluesky','GitHub','Hacker News','webpage','PDF']){
  assert.ok(defaultSources.includes(expected),'default/Claude matrix must retain '+expected);
}

console.log('OpenAI GitHub-only source policy tests PASS');
