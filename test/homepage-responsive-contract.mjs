import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../src/api/main.ts',import.meta.url),'utf8');

assert.match(source,/Homepage responsive architecture · 2026-09-20/);
assert.match(source,/hero-line hero-line-plain/);
assert.match(source,/hero-line hero-line-accent/);
assert.match(source,/\.home-only \.home-inner\{width:min\(calc\(100vw - 64px\),1240px\)/);
assert.match(source,/\.home-only \.home-nav\{width:min\(calc\(100vw - 64px\),1240px\)/);
assert.match(source,/\.home-only \.experience-hero h1\{font-size:clamp\(60px,5vw,78px\)[\s\S]*?white-space:normal/);
assert.match(source,/\.home-only \.experience-hero h1 \.hero-line\{display:block\}\.home-only \.experience-hero h1 \.hero-line\+\.hero-line\{margin-top:\.08em\}/);
assert.match(source,/@media\(max-width:1279px\) and \(min-width:901px\)/);
assert.match(source,/@media\(max-width:900px\) and \(min-width:651px\)/);
assert.match(source,/@media\(max-width:650px\)\{[\s\S]*?\.home-only \.home-inner\{width:100%;padding-left:18px;padding-right:18px\}/);
assert.match(source,/\.home-only \.sim-panel\{min-height:150px/);
assert.match(source,/\.home-only \.sim-chat-user\{display:block/);
assert.match(source,/\.home-only \.sim-panel-sub\{display:block/);
assert.match(source,/id="sim-run"[^>]*aria-expanded="false"[^>]*aria-controls="sim-comparison-panels"/);
assert.match(source,/id="sim-comparison-panels"[^>]*hidden/,'comparison panels must be closed on first paint');
assert.match(source,/state=\{source:'youtube',[\s\S]*opened:false\}/);
assert.match(source,/state\.opened=true;const panels=q\('#sim-comparison-panels'\);if\(panels\)panels\.hidden=false/,'clicking the comparison CTA must reveal the panels');
assert.match(source,/resetDemo\(false,false\);\s*\}\)\(\);/,'homepage must initialize the comparison closed');

console.log('homepage responsive architecture tests PASS');
