import assert from 'node:assert/strict';
import {parseMediaUrl} from '../dist/src/media/url.js';
import {isPublicAddress,orderPublicAddresses,pinnedLookup} from '../dist/src/util/safeHttp.js';
import {textUsageUnits,videoUsageUnits,estimateTokens} from '../dist/src/content/limits.js';

const cases=[
  ['youtube watch','https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_source=x','youtube','media','dQw4w9WgXcQ'],
  ['youtube short','https://youtube.com/shorts/dQw4w9WgXcQ?si=abc','youtube','media','dQw4w9WgXcQ'],
  ['youtube short host','https://youtu.be/dQw4w9WgXcQ?feature=share','youtube','media','dQw4w9WgXcQ'],
  ['instagram reel','https://www.instagram.com/reel/ABCdef123_/','instagram','media','ABCdef123_'],
  ['instagram post','https://instagram.com/p/ABCdef123_/','instagram','post','post_ABCdef123_'],
  ['tiktok video','https://www.tiktok.com/@user/video/7123456789012345678?utm_source=x','tiktok','media','7123456789012345678'],
  ['tiktok photo','https://www.tiktok.com/@user/photo/7123456789012345678','tiktok','post','photo_7123456789012345678'],
  ['x post','https://x.com/githubstatus/status/2039764648241598521?ref_src=foo','x','post','2039764648241598521'],
  ['twitter post','https://twitter.com/githubstatus/status/2039764648241598521','x','post','2039764648241598521'],
  ['reddit canonical','https://www.reddit.com/r/test/comments/1w8skpx/title/?utm_source=chatgpt.com','reddit','post','1w8skpx'],
  ['reddit short','https://redd.it/1w8skpx','reddit','post','1w8skpx'],
  ['reddit opaque share','https://www.reddit.com/r/test/s/AbCdEf12345/','reddit','post',/^share_/],
  ['bluesky','https://bsky.app/profile/bsky.app/post/3mnzpiackwk25','bluesky','post','bsky.app/3mnzpiackwk25'],
  ['github issue','https://github.com/nodejs/node/issues/64850','github','post','nodejs/node/issues/64850'],
  ['github pr','https://github.com/nodejs/node/pull/1','github','post','nodejs/node/pull/1'],
  ['hacker news','https://news.ycombinator.com/item?id=8863','hackernews','post','8863'],
  ['pdf','https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf?utm_source=x','pdf','document',/^pdf_/],
  ['web','https://example.com/article?utm_source=x&b=2&a=1','web','page',/^web_/]
];

for(const [name,url,platform,kind,id] of cases){
  const parsed=parseMediaUrl(url);
  assert.equal(parsed.platform,platform,`${name}: platform`);
  assert.equal(parsed.kind,kind,`${name}: kind`);
  if(id instanceof RegExp)assert.match(parsed.canonicalMediaId,id,`${name}: canonical id`);
  else assert.equal(parsed.canonicalMediaId,id,`${name}: canonical id`);
  assert.ok(!parsed.normalizedUrl.includes('utm_source='),`${name}: tracking params must be removed`);
}

const web=parseMediaUrl('https://example.com/article?z=9&utm_campaign=x&a=1#frag');
assert.equal(web.normalizedUrl,'https://example.com/article?a=1&z=9','generic URLs must strip tracking/hash and sort params');

const rejected=[
  'http://example.com/',
  'https://user:pass@example.com/',
  'https://www.youtube.com/channel/UC1234567890',
  'https://www.instagram.com/someprofile/',
  'https://x.com/githubstatus',
  'https://www.reddit.com/r/ClaudeAI/',
  'https://bsky.app/profile/bsky.app',
  'https://github.com/nodejs/node',
  'https://news.ycombinator.com/news'
];
for(const url of rejected)assert.throws(()=>parseMediaUrl(url),undefined,`must reject unsupported/private-ish surface: ${url}`);

for(const privateIp of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.1.1','::1','fc00::1','fe80::1','2001:db8::1']){
  assert.equal(isPublicAddress(privateIp),false,`${privateIp} must be blocked by SSRF guard`);
}
for(const publicIp of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111'])assert.equal(isPublicAddress(publicIp),true,`${publicIp} should be public`);
const ordered=orderPublicAddresses([{address:'2606:4700:4700::1111',family:6},{address:'1.1.1.1',family:4}]);
assert.equal(ordered[0].family,4,'IPv4 should be preferred in current Railway environment');
const lookup=pinnedLookup('1.1.1.1',4);
await new Promise((resolve,reject)=>lookup('example.com',{all:true},(err,addresses)=>{try{assert.ifError(err);assert.deepEqual(addresses,[{address:'1.1.1.1',family:4}]);resolve();}catch(e){reject(e);}}));
await new Promise((resolve,reject)=>lookup('example.com',{all:false},(err,address,family)=>{try{assert.ifError(err);assert.equal(address,'1.1.1.1');assert.equal(family,4);resolve();}catch(e){reject(e);}}));

assert.equal(videoUsageUnits(1),1);
assert.equal(videoUsageUnits(60),1);
assert.equal(videoUsageUnits(61),2);
assert.equal(textUsageUnits(1),1);
assert.equal(textUsageUnits(2500),1);
assert.equal(textUsageUnits(2501),2);
assert.equal(estimateTokens('abcd'),1);
assert.equal(estimateTokens('abcde'),2);

console.log(`source matrix tests PASS (${cases.length} supported URL shapes + rejection/safety/usage checks)`);
