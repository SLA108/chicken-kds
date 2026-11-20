import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
test('KDS uses branded platform header and prominent external order ID',()=>{
 const start=app.indexOf('const brand=o.platform?platformBrand(o.platform):null;');
 const end=app.indexOf('(o.platform_deadline_at?',start);
 assert.ok(start>0&&end>start);
 const head=app.slice(start,end);
 assert.match(head,/brand\?esc\(brand.name\):esc\(o.table_no\|\|sourceName\[o.source\]\)/);
 assert.match(head,/kds-platform-order-number/);
 assert.match(head,/o.external_order_id\|\|o.id.slice\(0,8\)/);
 assert.match(head,/!brand\?'<div class="kds-head-id"/);
 assert.doesNotMatch(head,/replaceAll\('_',' '\)\.toUpperCase\(\)/);
});
test('KDS platform header uses existing theme colors',()=>{
 assert.match(css,/\.kds-order-head\.kds-platform-head\{background:var\(--kds-platform-color\);color:var\(--kds-platform-ink\)/);
});
