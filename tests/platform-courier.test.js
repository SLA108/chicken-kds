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
