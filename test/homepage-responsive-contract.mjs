import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../src/api/main.ts',import.meta.url),'utf8');

assert.match(source,/class="activation-site signal-home" data-activation-home/);
assert.match(source,/Your AI got the link\.<\/span><em>LTA brings the source\.<\/em>/);
assert.match(source,/PUBLIC URL[\s\S]*SOURCE IN YOUR AI/);
assert.match(source,/data-install-handoff href="\/start\?from=hero"/);
assert.match(source,/class="signal-console" id="proof"/);
assert.match(source,/href="\/sources"/);
assert.match(source,/href="\/pricing"/);
assert.match(source,/href="\/developers"/);
assert.match(source,/\.signal-stage-inner\{position:relative;z-index:1;display:grid;grid-template-columns:minmax\(600px,1fr\) minmax\(0,1\.08fr\)/);
assert.match(source,/@media\(max-width:1180px\)\{\.signal-stage-inner\{grid-template-columns:1fr/);
assert.match(source,/@media\(max-width:700px\)[\s\S]*\.signal-home \.sim-grid\{grid-template-columns:1fr\}/);
assert.match(source,/id="sim-run"[^>]*aria-expanded="false"[^>]*aria-controls="sim-comparison-panels"/);
assert.match(source,/id="sim-comparison-panels"[^>]*hidden/);
assert.match(source,/state=\{source:'instagram',[\s\S]*opened:false\}/);
assert.match(source,/data-sim-source="instagram"[^>]*class="[^"]*active|class="[^"]*active[^"]*"[^>]*data-sim-source="instagram"/);
assert.match(source,/Same AI assistant · same public link/);
assert.match(source,/https:\/\/www\.instagram\.com\/reel\/Ddx6Q_MJNyg\//);
assert.match(source,/RECORDED PUBLIC TEST/);
assert.match(source,/SWIPE FOR MORE SOURCES/);
assert.match(source,/interactive-widget=resizes-content/);
assert.match(source,/scroll-snap-type:x proximity/);
assert.match(source,/min-height:100svh/);
assert.match(source,/-webkit-tap-highlight-color:transparent/);
assert.match(source,/Marcus Lemonis/);
assert.match(source,/qa\('\.sim-user-link'\)\.forEach/);
assert.match(source,/state\.opened=true;const panels=q\('#sim-comparison-panels'\);if\(panels\)panels\.hidden=false/);
assert.match(source,/resetDemo\(false,false\);\s*\}\)\(\);/);
assert.match(source,/src="\/home\.js\?v=signal-relay-v2" defer/);

console.log('homepage responsive architecture tests PASS');
