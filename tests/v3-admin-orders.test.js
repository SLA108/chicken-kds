import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('admin orders endpoint requires admin and supports scoped filters',()=>{
 assert.match(worker,/path==='\/api\/admin\/orders'&&req\.method==='GET'/);
 assert.match(worker,/if\(!allowed\(role,'admin'\)\)return json\(\{error:'Forbidden'\},403\)/);
 assert.match(worker,/o\.store_id=\?/);
 assert.match(worker,/o\.status=\?/);
 assert.match(worker,/ORDER BY o\.created_at DESC,o\.id DESC LIMIT \? OFFSET \?/);
 assert.match(worker,/\[50,100\]\.includes/);
 assert.match(worker,/period==='current'/);
});
test('Back Office Orders uses clickable restaurant status cards, pagination and refresh',()=>{
 for(const id of ['data-monitor-store','data-monitor-status','admin-orders-refresh','admin-orders-prev','admin-orders-next','admin-orders-period'])assert.ok(app.includes(id),id);
 assert.match(app,/v3Stores\.map\(store=>/);
 assert.match(app,/adminOrdersStore=store;adminOrdersStatus=status/);
 assert.doesNotMatch(app,/id="admin-orders-store"/);
 assert.doesNotMatch(app,/id="admin-orders-status"/);
 assert.match(app,/api\('\/admin\/orders\?'\+q\)/);
 assert.match(app,/adminOrderPanel\(\)/);
 assert.doesNotMatch(app,/orders\.filter\(o=>o\.status==='new'\|\|o\.status==='cooking'\)\.map\(o=>ticket\(o\)\)/);
});
