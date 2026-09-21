import assert from 'node:assert/strict';

Object.assign(process.env,{
  DATABASE_URL:'postgres://127.0.0.1:1/link2ai',
  PUBLIC_BASE_URL:'https://launch.example',
  APP_SECRET:'01234567890123456789012345678901'
});

const {extractGalleryVisualAssets}=await import('../dist/src/content/linkText.js');

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
