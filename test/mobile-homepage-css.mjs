import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../src/api/main.ts',import.meta.url),'utf8');
assert.match(source,/\/\* Mobile homepage polish · 2026-09-17 \*\//);
assert.match(source,/@media\(max-width:650px\)\{[\s\S]*?\.experience-copy\{text-align:left/);
assert.match(source,/\.experience-hero h1\{margin:14px 0 14px;font-size:clamp\(37px,10\.7vw,44px\)/);
assert.match(source,/\.home-nav\{position:absolute;top:0;left:50%;transform:translateX\(-50%\);width:min\(calc\(100vw - 56px\),1224px\)/);
assert.match(source,/\.experience-hero\{position:relative;margin-top:0;padding:112px 0 58px/);
assert.match(source,/\.home-nav\{left:max\(14px,env\(safe-area-inset-left\)\);right:max\(14px,env\(safe-area-inset-right\)\);width:auto;transform:none\}/);
assert.match(source,/\.experience-hero\{margin-top:0;padding:92px 0 38px\}/);
assert.match(source,/\.mobile-menu summary\{width:40px;height:40px/);
assert.match(source,/\.source-buttons\{display:flex;overflow-x:auto/);
assert.match(source,/\.usecase-menu\{display:flex;overflow-x:auto/);
assert.match(source,/\.proof-grid\{display:flex;overflow-x:auto/);
assert.match(source,/\.sim-panel\{min-height:0;padding:14px/);
assert.match(source,/\.sim-chat-user\{max-width:94%;padding:10px 11px/);
assert.match(source,/@media\(max-width:380px\)\{/);
console.log('mobile homepage CSS schema tests passed');
