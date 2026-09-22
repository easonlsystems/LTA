import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const css=await readFile(new URL('../src/api/activationCss.ts',import.meta.url),'utf8');
assert.match(css,/@media\(max-width:700px\)/);
assert.match(css,/\.a-hero-grid\{grid-template-columns:1fr\}/);
assert.match(css,/\.a-hero-actions \.a-primary\{width:100%\}/);
assert.match(css,/\.a-how-grid\{grid-template-columns:1fr\}/);
assert.match(css,/@media\(max-width:450px\)/);
assert.match(css,/\.a-source-list\{grid-template-columns:1fr\}/);
assert.match(css,/\.a-test-row button\{width:100%\}/);
assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
console.log('mobile homepage CSS schema tests passed');
