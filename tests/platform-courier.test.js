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
 assert.match(ui,/Kitchen Quick Entry/);
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

test('platform editing uses optimistic revision and locks completed dishes',()=>{
 assert.ok(api.includes("const platformEdit=path.match("));
 assert.match(api,/Order changed; refresh/);
 assert.match(api,/Completed dishes cannot be modified; refresh/);
 assert.match(api,/const changed=retained.filter/);
 assert.match(ui,/Edit Platform Order/);
 assert.match(ui,/expected_updated_at:order\.updated_at/);
});

test('completed platform dishes are locked while unfinished dishes remain editable',()=>{
 assert.match(ui,/Done · Locked/);
 assert.match(ui,/item\.is_done\?'disabled':''/);
 assert.match(api,/existing\.some\(i=>i\.is_done&&retained\.find/);
});

test('kitchen and POS may enter and edit platform orders; courier handoff stays available',()=>{
 assert.match(api,/if\(path==='\/api\/store\/quick-orders'&&req\.method==='POST'\)\{\s*if\(!\['pos','kitchen'\]\.includes\(session\.role\)\)/);
 assert.match(api,/if\(platformEdit&&req\.method==='POST'\)\{\s*if\(!\['pos','kitchen'\]\.includes\(session\.role\)\)/);
 assert.match(api,/if\(!\['pos','kitchen'\]\.includes\(session\.role\)\)return json\(\{error:'Forbidden'\},403\);\s*const id=courierCollect/);
});

test('POS consolidates platform entry, editing and courier handoff into one workspace tab',()=>{
 assert.match(ui,/\['platform','Platform Orders'\]/);
 assert.match(ui,/function platformWorkspaceHtml\(/);
 assert.match(ui,/function bindPlatformWorkspace\(/);
 assert.match(ui,/data-platform-workspace-edit/);
 assert.match(ui,/data-platform-workspace-collect/);
 assert.match(ui,/platformWorkspaceFilter==='collected'/);
 assert.doesNotMatch(ui,/\['platform-edit','Edit Platform Orders'\]/);
});
test('kitchen platform editor removes replace action and collapses modifier groups',()=>{
 const start=ui.indexOf('async function editPlatformOrder(id)');
 const end=ui.indexOf('async function openQuickOrderDialog()',start);
 const edit=ui.slice(start,end);
 assert.doesNotMatch(edit,/data-edit-replace/);
 assert.match(edit,/data-edit-remove/);
 assert.match(edit,/<details style=/);
 assert.match(edit,/data-edit-option/);
});
test('platform edit preserves completed quantities and ISO order timestamps',()=>{
 assert.match(ui,/i\.is_done\?Number\(i\.quantity\):Number/);
 assert.match(api,/const now=new Date\(\)\.toISOString\(\),revision=now.slice/);
});
test('reopening collected platform order is prevented in SQL update',()=>{
 assert.match(api,/AND NOT EXISTS\(SELECT 1 FROM order_platform_metadata pm WHERE pm\.order_id=orders\.id AND pm\.collected_at IS NOT NULL\)/);
});

test('platform modifiers use responsive compact option rows',()=>{
 assert.match(ui,/platform-mod-options/);
 assert.match(ui,/platform-mod-name/);
 assert.match(ui,/platform-mod-price/);
 assert.match(ui,/platform-dish-top/);
 assert.match(ui,/quickOrderStyle\.remove\(\)/);
});

test('changing platform warns before clearing dish selections',()=>{
 assert.match(ui,/Changing the delivery platform will clear the selected dishes and modifiers/);
 assert.match(ui,/form\.elements\.platform\.value=loadedPlatform/);
});
test('POS platform order workspace supports searching and status filters',()=>{
 assert.match(ui,/platform-workspace-search/);
 assert.match(ui,/No matching orders/);
 assert.match(ui,/platformWorkspaceFilter==='ready'/);
});
test('platform edits broadcast a dedicated update notification',()=>{
 assert.match(api,/broadcastStore\(env,storeId,'platform_order_edited',\{id\}\)/);
 assert.match(ui,/ORDER UPDATED/);
 assert.match(ui,/platformOrderUpdateAlert/);
});

test('editing guards changed dishes against concurrent kitchen completion',()=>{
 assert.ok(api.includes('const changeGuard=touched.length'));
 assert.ok(api.includes('i.is_done=1 AND i.id IN'));
 assert.ok(api.includes('for(const item of changed)'));
});

test('ready time starts at dialog opening plus 15 minutes and adjustments are cumulative',()=>{
 assert.match(ui,/const openedAt=Date\.now\(\)/);
 assert.match(ui,/let readyMinutes=15/);
 assert.match(ui,/openedAt\+readyMinutes\*60000/);
 assert.match(ui,/data-ready-adjust="-10"/);
 assert.match(ui,/data-ready-adjust="-5"/);
 assert.match(ui,/data-ready-adjust="5"/);
 assert.match(ui,/data-ready-adjust="10"/);
 assert.match(ui,/readyMinutes\+Number\(button\.dataset\.readyAdjust\)/);
 assert.match(ui,/ready_by:deadlineInput\.value/);
});

test('quick entry has platform buttons, category browser and top submit',()=>{
 assert.match(ui,/quick-platform-buttons/);
 assert.match(ui,/data-quick-platform/);
 assert.match(ui,/quick-dish-categories/);
 assert.match(ui,/quick-dish-results/);
 assert.match(ui,/quick-order-sticky/);
 assert.match(ui,/renderCatalog/);
 assert.match(ui,/data-quick-dish/);
});

test('courier collection does not reference quick entry form or catalog state',()=>{
 const start=ui.indexOf('async function openCourierCollection()');
 const end=ui.indexOf('let platformWorkspaceFilter=',start);
 assert.ok(start>=0&&end>start);
 const courier=ui.slice(start,end);
 assert.doesNotMatch(courier,/updateDishCount|renderCatalog|renderPlatforms|quick-dish-categories|form\.elements\.platform/);
 assert.match(courier,/const load=async\(\)=>/);
 assert.match(courier,/await load\(\)/);
});

test('platform edit aborts the entire D1 batch on a concurrent zero-row guarded write',()=>{
 const start=api.indexOf('const platformEdit=path.match');
 const end=api.indexOf("if(path==='/api/store/kitchen/dag'",start);
 assert.ok(start>=0&&end>start);
 const edit=api.slice(start,end);
 assert.ok(edit.includes('for(const write of writes)'));
 assert.ok(edit.includes('SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract'));
 assert.ok(edit.includes('await env.DB.batch(checked)'));
 assert.ok(edit.includes('Order changed; refresh'));
});

test('platform edit supports adding and removing pending dishes with server-side menu and modifier validation',()=>{
 const start=api.indexOf('const platformEdit=path.match');
 const end=api.indexOf("if(path==='/api/store/kitchen/dag'",start);
 const edit=api.slice(start,end);
 assert.match(edit,/removed_ids/);
 assert.match(edit,/added_items/);
 assert.match(edit,/prepareOrderItems\(env,added,id,now,storeId,order.platform\)/);
 assert.match(edit,/removed.some\(x=>!existing.some\(i=>i.id===x&&!i.is_done\)\)/);
 assert.match(edit,/DELETE FROM order_item_modifiers/);
 assert.match(edit,/DELETE FROM order_items/);
 assert.match(edit,/await env\.DB\.batch\(checked\)/);
});

