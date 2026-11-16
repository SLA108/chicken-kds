import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const migration=readFileSync(new URL('../migrations/platform_courier_collection.sql',import.meta.url),'utf8');
test('platform orders do not enter ordinary POS checkout or open tickets',()=>{
 assert.match(api,/Platform Orders are collected by couriers, not checked out at POS/);
 assert.match(ui,/function activeTickets\(\)\{return orders.filter\(o=>!o.platform/);
});
test('FOH pickup queue excludes platform orders',()=>{
 assert.match(api,/AND NOT EXISTS\(SELECT 1 FROM order_platform_metadata pm WHERE pm.order_id=o.id\)/);
 assert.match(api,/AND NOT EXISTS\(SELECT 1 FROM order_platform_metadata pm WHERE pm.order_id=orders.id\)/);
});
test('courier collection requires kitchen completion and is store scoped',()=>{
 assert.match(api,/path==='\/api\/store\/platform-orders\/collection'/);
 assert.match(api,/o.kitchen_completed_at IS NOT NULL/);
 assert.match(api,/pm.collected_at IS NULL/);
 assert.match(api,/o.status='done' AND o.kitchen_completed_at IS NOT NULL/);
 assert.match(api,/await broadcastStore\(env,storeId,'orders',\{id\}\)/);
 assert.match(migration,/ADD COLUMN collected_at TEXT/);
});
test('platform UI is distinct from kitchen and POS pickup',()=>{
 assert.match(ui,/\+ Platform Order/);
 assert.match(ui,/New Platform Order/);
 assert.match(ui,/Courier Collection/);
 assert.match(ui,/Collected by Courier/);
 assert.match(ui,/path==='\/platform-orders\/collection'/);
});

test('platform collection history is store-scoped and read-only',()=>{
 assert.match(api,/path==='\/api\/store\/platform-orders\/history'/);
 assert.match(api,/pm\.collected_at IS NOT NULL ORDER BY pm\.collected_at DESC/);
 assert.match(ui,/historyMode\?'\/platform-orders\/history':'\/platform-orders\/collection'/);
 assert.match(ui,/historyMode\?'':'<button type="button" data-courier-collect/);
});
test('platform order modifiers are available to kitchen and validated before submit',()=>{
 assert.match(api,/if\(!\['pos','kitchen'\]\.includes\(session\.role\)\)return json\(\{error:'Forbidden'\},403\);\s*const \[groups,options,links\]/);
 assert.match(ui,/const groupsFor=id=>platformModifiers\.groups\.filter/);
 assert.match(ui,/selected<g\.min_select\|\|selected>g\.max_select/);
 assert.match(ui,/quantity:Number\(row\.querySelector\('input\[aria-label="Quantity"\]'\)\.value\),option_ids/);
});

test('collected platform orders cannot be reopened or changed via ordinary POS item API',()=>{
 assert.match(api,/Courier has already collected this platform order/);
 assert.match(api,/Use Platform Orders to manage platform items/);
});

test('platform editing requires optimistic revision and unstarted kitchen work',()=>{
 assert.ok(api.includes("const platformEdit=path.match("));
 assert.match(api,/Order changed; refresh/);
 assert.match(api,/Kitchen has started or order items changed; refresh/);
 assert.match(api,/Completed dishes cannot be modified; refresh/);
 assert.match(api,/b.items.filter\(i=>!existing.find\(x=>x.id===i.id\).is_done\)/);
 assert.match(ui,/Edit Platform Order/);
 assert.match(ui,/expected_updated_at:order\.updated_at/);
});

test('completed platform dishes are locked while unfinished dishes remain editable',()=>{
 assert.match(ui,/Done \(locked\)/);
 assert.match(ui,/i.is_done\?'disabled':''/);
 assert.match(api,/existing.some\(i=>i.is_done&&b.items.find/);
});
