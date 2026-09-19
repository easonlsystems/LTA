import assert from 'node:assert/strict';
import {assertPlatformAllowedForProfile,parseAllowedMediaUrl,platformAllowedForProfile,supportedSourcesForProfile} from '../dist/src/mcp/policy.js';

const shared=[
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ','youtube'],
  ['https://www.instagram.com/reel/ABCdef123_/','instagram'],
  ['https://www.tiktok.com/@user/video/7123456789012345678','tiktok'],
  ['https://x.com/githubstatus/status/2039764648241598521','x'],
  ['https://www.reddit.com/comments/1w8skpx/','reddit'],
  ['https://bsky.app/profile/bsky.app/post/3mnzpiackwk25','bluesky'],
  ['https://github.com/nodejs/node/issues/64850','github'],
  ['https://news.ycombinator.com/item?id=8863','hackernews'],
  ['https://example.com/article','web'],
  ['https://example.com/report.pdf','pdf']
];

for(const [url,platform] of shared){
  const parsedOpenai=parseAllowedMediaUrl(url,'openai');
  const parsedDefault=parseAllowedMediaUrl(url,'default');
  assert.equal(parsedOpenai.platform,platform);
  assert.equal(parsedDefault.platform,platform);
  assert.equal(platformAllowedForProfile(parsedOpenai.platform,'openai'),true);
  assert.equal(platformAllowedForProfile(parsedDefault.platform,'default'),true);
  assert.doesNotThrow(()=>assertPlatformAllowedForProfile(parsedOpenai.platform,'openai'));
}

const openaiSources=supportedSourcesForProfile('openai',true);
const defaultSources=supportedSourcesForProfile('default',true);
assert.equal(openaiSources,defaultSources,'OpenAI and default/Claude distributions must advertise the same source matrix');
assert.match(openaiSources,/YouTube/);
assert.match(openaiSources,/Instagram/);
assert.match(openaiSources,/TikTok/);
assert.match(openaiSources,/\bX\b/);
assert.match(openaiSources,/Reddit/);
assert.match(openaiSources,/Bluesky/);
assert.match(openaiSources,/GitHub/);
assert.match(openaiSources,/Hacker News/);
assert.match(openaiSources,/webpage/);
assert.match(openaiSources,/PDF/);

console.log('OpenAI distribution policy tests PASS');
