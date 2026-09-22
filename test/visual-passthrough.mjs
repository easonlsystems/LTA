import assert from 'node:assert/strict';

Object.assign(process.env,{
  DATABASE_URL:'postgres://127.0.0.1:1/link2ai',
  PUBLIC_BASE_URL:'https://launch.example',
  APP_SECRET:'01234567890123456789012345678901'
});

const {extractGalleryVisualAssets}=await import('../dist/src/content/linkText.js');
const {imageMimeFromBytes}=await import('../dist/src/media/imageMime.js');
const {loadVisualImagePage}=await import('../dist/src/mcp/server.js');

assert.equal(imageMimeFromBytes(Buffer.from('<html>expired signed URL</html>')),
  null,'an expired CDN URL must not count as a delivered image');
assert.equal(imageMimeFromBytes(Buffer.from([0xff,0xd8,0xff,0xe0,0,0])),'image/jpeg');
assert.equal(imageMimeFromBytes(Buffer.from([137,80,78,71,13,10,26,10,0])),'image/png');
assert.equal(imageMimeFromBytes(Buffer.from('GIF89a0000')),'image/gif');
assert.equal(imageMimeFromBytes(Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBPVP8 ')])),'image/webp');
assert.equal(imageMimeFromBytes(Buffer.from([0xff,0xd8])),null,'truncated image header must not count');

const visualJob={visual_assets:[{kind:'image',url:'https://cdn.example.com/signed.jpg',mimeType:'image/jpeg'}]};
const expired=await loadVisualImagePage(visualJob,0,1,async()=>({
  bytes:Buffer.from('<html>expired</html>'),contentType:'image/jpeg',finalUrl:'https://cdn.example.com/signed.jpg'
}));
assert.equal(expired.delivered,0,'mislabeled CDN error body must not count as a delivered image');
assert.equal(expired.failed,1);
const delivered=await loadVisualImagePage(visualJob,0,1,async()=>({
  bytes:Buffer.from([137,80,78,71,13,10,26,10,0]),contentType:'text/html',finalUrl:'https://cdn.example.com/signed.jpg'
}));
assert.equal(delivered.delivered,1,'valid image bytes should be delivered even if the CDN header is wrong');
assert.equal(delivered.blocks[0].mimeType,'image/png','MCP image block must use the detected bytes, not the stale hint');

const dump=[
  [2,{description:'A visual post',username:'creator'}],
  [3,'https://cdn.example.com/photo-1.jpg?x=1',{extension:'jpg',width:1080,height:1350}],
  [3,'https://cdn.example.com/photo-2.webp',{extension:'webp',width:1080,height:1080}],
  [3,'https://cdn.example.com/clip.mp4',{extension:'mp4',width:1080,height:1920}],
  [3,'https://cdn.example.com/photo-1.jpg?x=1',{extension:'jpg',width:1080,height:1350}]
];

const assets=extractGalleryVisualAssets(dump);
assert.equal(assets.length,3,'gallery media URLs should be preserved once and in source order');
assert.deepEqual(assets.map(a=>a.kind),['image','image','video']);
assert.deepEqual(assets.map(a=>a.position),[0,1,2]);
assert.equal(assets[0].mimeType,'image/jpeg');
assert.equal(assets[1].mimeType,'image/webp');
assert.equal(assets[2].mimeType,'video/mp4');
assert.equal(assets[0].width,1080);
assert.equal(assets[0].height,1350);

const urlOnly=extractGalleryVisualAssets([
  [3,'https://cdn.example.com/third.png',{}],
  [3,'http://127.0.0.1/private.jpg',{extension:'jpg'}]
]);
assert.equal(urlOnly.length,1,'only public HTTPS media references should be retained');
assert.equal(urlOnly[0].kind,'image');
assert.equal(urlOnly[0].mimeType,'image/png');

console.log('visual passthrough tests PASS');
