import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');

test('Back Office order durations show seconds rather than zero minutes',()=>{
 const source=js.match(/function boDuration\(start,end\)\{[^\n]+/ )?.[0];
 assert.ok(source,'boDuration is present');
 const boDuration=Function(source+';return boDuration')();
 assert.equal(boDuration('2026-11-15T04:55:34Z','2026-11-15T04:56:11Z'),'37s');
 assert.equal(boDuration('2026-11-15T04:55:34Z','2026-11-15T04:56:32Z'),'58s');
 assert.equal(boDuration('2026-11-15T04:55:34Z','2026-11-15T04:57:49Z'),'2m 15s');
 assert.equal(boDuration('2026-11-15T04:55:34Z','2026-11-15T05:56:11Z'),'1h 00m 37s');
 assert.equal(boDuration(null,null),'—');
});

test('Back Office item names have a full-width wrapping row',()=>{
 assert.match(js,/bo-order-item-name/);
 assert.match(css,/\.bo-monitor-details \.bo-order-item\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/\.bo-monitor-details \.bo-order-item-name\{[^}]*overflow-wrap:break-word/);
 assert.match(js,/Order → Kitchen completed/);
});
