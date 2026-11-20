import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
test('KDS platform header prioritizes external number and compact badge',()=>{
 const start=app.indexOf('const brand=o.platform?platformBrand(o.platform):null;');
 const end=app.indexOf('(o.platform_deadline_at?',start);
 assert.ok(start>0&&end>start);
 const head=app.slice(start,end);
 assert.match(head,/kds-platform-order-number/);
 assert.match(head,/kds-platform-badge/);
 assert.match(head,/o.external_order_id\|\|o.id.slice\(0,8\)/);
 assert.match(head,/kds-platform-timing/);
 assert.match(head,/data-kitchen-age/);
 assert.match(head,/!brand\?'<div class="kds-head-id"/);
});
test('KDS keeps age severity background and platform color only in badge',()=>{
 for(const band of ['blue','green','yellow','red'])assert.match(css,new RegExp('\\.kds-order-head\\.kds-platform-head\\[data-age-band='+band+'\\]'));
 assert.match(css,/\.kds-platform-head \.kds-platform-badge\{[^}]*background:var\(--kds-platform-color\)/);
});
