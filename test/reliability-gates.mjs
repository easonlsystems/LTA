import assert from 'node:assert/strict';

Object.assign(process.env,{
  DATABASE_URL:'postgres://127.0.0.1:1/link2ai',
  PUBLIC_BASE_URL:'https://launch.example',
  APP_SECRET:'01234567890123456789012345678901'
});

const {socialFallbackCaptionBody,socialFallbackHasUsefulText}=await import('../dist/src/content/linkText.js');
const {videoTranscriptQuality}=await import('../dist/src/worker/processor.js');

const metadataOnly='38.7K likes, 22.7K comments - denghao.0304 on September 18, 2026';
assert.equal(socialFallbackCaptionBody(metadataOnly),'','engagement-only social metadata must not be treated as a caption');
assert.equal(socialFallbackHasUsefulText({caption:metadataOnly,text:'Account: @denghao.0304\nPosted: September 18, 2026\nEngagement: 38.7K likes, 22.7K comments\n👏 🙏 👏'}),false,'metadata and emoji reactions are not useful post content');

const quoted='1,234 likes, 56 comments - creator on September 18, 2026: “This is the actual caption users need the AI to read.”';
assert.equal(socialFallbackCaptionBody(quoted),'This is the actual caption users need the AI to read.');
assert.equal(socialFallbackHasUsefulText({caption:quoted,text:quoted}),true,'a real caption inside social metadata must remain usable');

assert.equal(socialFallbackHasUsefulText({caption:'Short but useful',text:'Short but useful'}),true,'short genuine post text should not be rejected just for being short');

assert.equal(videoTranscriptQuality('[Music]',600).ok,false,'a ten-minute video with only a music marker must not pass as a reliable transcript');
assert.equal(videoTranscriptQuality('The speaker explains the architecture, training loop, latent representation, decoder, and inference process in enough detail to answer questions.',600).ok,true,'substantive transcript text should pass the sparse-content gate');
assert.equal(videoTranscriptQuality('Hello world',30).ok,true,'short clips can legitimately contain only a small amount of speech');

console.log('reliability quality gate tests PASS');
