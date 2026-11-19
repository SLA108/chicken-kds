import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('admin order monitor uses database-backed platform filters and metadata',()=>{
 const start=api.indexOf("if(path==='/api/admin/orders'&&req.method==='GET')");
 const end=api.indexOf("if(path==='/api/admin/reservations'",start);
 assert.ok(start>=0&&end>start);
 const handler=api.slice(start,end);
 assert.match(handler,/params\.get\('order_type'\)/);
 assert.match(handler,/params\.get\('platform'\)/);
 assert.match(handler,/params\.get\('collection'\)/);
 assert.match(handler,/NOT EXISTS\(SELECT 1 FROM order_platform_metadata/);
 assert.match(handler,/EXISTS\(SELECT 1 FROM order_platform_metadata/);
 assert.match(handler,/pm\.collected_at IS NULL/);
 assert.match(handler,/pm\.collected_at IS NOT NULL/);
 assert.match(handler,/o\.platform_info=platformByOrder\.get\(o\.id\)\|\|null/);
});
test('admin order monitor renders and wires platform and collection filters',()=>{
 for(const id of ['admin-orders-type','admin-orders-platform','admin-orders-collection']){
  assert.ok(ui.includes('id="'+id+'"'));
  assert.ok(ui.includes("querySelector('#"+id+"').onchange"));
 }
 assert.match(ui,/q\.set\('order_type',adminOrdersType\)/);
 assert.match(ui,/platformInfo\.external_order_id/);
 assert.match(ui,/Collected by courier/);
 assert.match(ui,/Regular Order/);
});
