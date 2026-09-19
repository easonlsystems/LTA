import assert from 'node:assert/strict';
import {SOURCE_REDUNDANCY,independentRootFamilies} from '../dist/src/resolvers/redundancy.js';

for(const [source,entry] of Object.entries(SOURCE_REDUNDANCY)){
  const families=independentRootFamilies(entry);
  if(entry.state==='redundant'){
    assert.ok(families.length>=2,`${source} is marked redundant but has fewer than two independent root families`);
  }
  if(entry.state==='single_path'){
    assert.equal(families.length,1,`${source} single-path status must describe exactly one active root family`);
  }
}

assert.equal(SOURCE_REDUNDANCY.youtube_media.state,'redundant');
assert.equal(SOURCE_REDUNDANCY.x_post_media.state,'redundant');
assert.equal(SOURCE_REDUNDANCY.hackernews.state,'redundant');
assert.equal(SOURCE_REDUNDANCY.instagram_media.state,'redundant');
assert.equal(SOURCE_REDUNDANCY.tiktok_media.state,'redundant');
assert.equal(SOURCE_REDUNDANCY.pdf.state,'redundant');
assert.equal(SOURCE_REDUNDANCY.github.state,'conditional');
assert.equal(SOURCE_REDUNDANCY.reddit.state,'single_path');

console.log('source redundancy audit PASS');
