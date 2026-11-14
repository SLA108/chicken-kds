import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const api=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');

test('device POS pickup paths map to backend scoped pickup routes',()=>{
 assert.match(ui,/path==='\/pos\/pickups'\|\|path\.startsWith\('\/pos\/pickups\/'\)/);
 assert.match(ui,/path\.slice\('\/pos'\.length\)/);
 assert.ok(api.includes('const scopedPickup=path.match('),'single-dish pickup route');
 assert.ok(api.includes('const scopedPickupAll=path.match('),'bulk pickup route');
 assert.ok(api.includes("scopedPickupAll&&req.method==='POST'"),'bulk pickup POST handler');
});

test('device mode rejects unknown API routes rather than falling back to legacy',()=>{
 assert.match(ui,/throw Error\('Device mode does not permit this endpoint:/);
 assert.doesNotMatch(api,/STORE_API_NOT_READY/);
 assert.match(api,/Unknown store-scoped API endpoint/);
});

test('store administration is not blocked by obsolete staging flags',()=>{
 assert.doesNotMatch(api,/ENABLE_V3_STORE_ADMIN/);
 assert.match(api,/multistore_enabled:true/);
});

test('store-specific paid order detail scopes all lookups',()=>{
 assert.ok(api.includes('const scopedPosDetail=path.match('));
 assert.ok(api.includes('Paid order not found'));
 assert.ok(api.includes('AND store_id=? AND paid_at IS NOT NULL'));
 assert.ok(api.includes('WHERE order_id=? AND store_id=?'));
});

test('order-item preparation uses effective store price without duplicate column names',()=>{
 const start=api.indexOf('async function prepareOrderItems(');
 const end=api.indexOf('export default',start);
 const section=api.slice(start,end);
 assert.ok(start>=0);
 assert.ok(section.includes('COALESCE(o.price_cents,m.price_cents) AS price_cents'));
 assert.ok(section.includes('m.id,m.name,m.category,m.vat_rate,COALESCE'));
 assert.ok(!section.includes('SELECT m.*,COALESCE(o.price_cents,m.price_cents) AS price_cents'));
 assert.ok(section.includes('m.price_cents+extra'));
});

test('add-items checkout race returns recoverable conflict',()=>{
 const start=api.indexOf('const scopedAddItems=');
 const end=api.indexOf('const scopedPickupAll=',start);
 assert.ok(start>=0&&end>start);
 const section=api.slice(start,end);
 assert.ok(section.includes('try{result=await env.DB.batch(statements);}'));
 assert.ok(section.includes("current.paid_at||current.kitchen_completed_at"));
 assert.ok(section.includes("return json({error:'Order changed; refresh'},409)"));
});

test('store-specific active override controls both menu visibility and order item validation',()=>{
 const matches=api.match(/WHERE COALESCE\(o\.active,m\.active\)=1/g)||[];
 assert.equal(matches.length,3);
 assert.ok(!api.includes('WHERE m.active=1 AND COALESCE(o.active,1)=1'));
 assert.ok(api.includes('COALESCE(o.sold_out,0)=0'));
});

test('admin store sales uses Warsaw calendar day boundaries',()=>{
 const start=api.indexOf("if(path==='/api/admin/store-sales'");
 const end=api.indexOf("// V3 admin-only store detail",start);
 assert.ok(start>=0&&end>start);
 const section=api.slice(start,end);
 assert.ok(section.includes("timeZone:'Europe/Warsaw'"));
 assert.ok(section.includes('args.push(midnightUtc(from))'));
 assert.ok(section.includes("args.push(midnightUtc(next.toISOString().slice(0,10)))"));
 assert.ok(section.includes("timezone:'Europe/Warsaw'"));
});

test('item completion cannot overwrite kitchen-completed order status',()=>{
 const start=api.indexOf('const scopedItemDone=');
 const end=api.indexOf('const scopedStatus=',start);
 assert.ok(start>=0&&end>start);
 const section=api.slice(start,end);
 assert.ok(section.includes("AND kitchen_completed_at IS NULL"));
 assert.ok(section.includes('if(statusUpdate.meta.changes!==1)'));
 assert.ok(section.includes("return json({error:'Order changed; refresh'},409)"));
});

test('dish completion trigger race returns conflict instead of server error',()=>{
 const start=api.indexOf('const scopedItemDone='),end=api.indexOf('const scopedStatus=',start);
 const section=api.slice(start,end);
 assert.ok(section.includes("current.status==='cancelled'||current.kitchen_completed_at"));
 assert.ok(section.includes("return json({error:'Order changed; refresh'},409)"));
});

test('kitchen status transition cannot overwrite completed order',()=>{
 const start=api.indexOf('const scopedStatus='),end=api.indexOf('const scopedPickup=',start);
 assert.ok(start>=0&&end>start);
 const section=api.slice(start,end);
 assert.ok(section.includes("AND status=? AND kitchen_completed_at IS NULL"));
 assert.ok(section.includes("result.meta.changes!==1"));
});

test('reopening kitchen completion preserves status implied by dish completion',()=>{
 const start=api.indexOf('const scopedKitchenFinish='),end=api.indexOf("if(path==='/api/store/pos/history'",start);
 assert.ok(start>=0&&end>start);
 const section=api.slice(start,end);
 assert.ok(section.includes("status=CASE WHEN EXISTS(SELECT 1 FROM order_items WHERE order_id=orders.id AND is_done=0) THEN 'new' ELSE 'done' END"));
 assert.ok(section.includes('kitchen_completed_at=NULL'));
 assert.ok(section.includes("AND store_id=? AND kitchen_completed_at IS NOT NULL"));
});

test('bulk pickup acknowledgement rejects orders outside device store and cancelled orders',()=>{
 const start=api.indexOf('const scopedPickupAll='),end=api.indexOf("if(path==='/api/store/kitchen/history'",start);
 assert.ok(start>=0&&end>start);
 const section=api.slice(start,end);
 assert.ok(section.includes('SELECT status FROM orders WHERE id=? AND store_id=?'));
 assert.ok(section.includes("return json({error:'Order not found'},404)"));
 assert.ok(section.includes("return json({error:'Order cancelled'},409)"));
 assert.ok(section.includes('picked_up_at IS NULL'));
});

test('idempotent kitchen status cannot silently succeed after kitchen completion',()=>{
 const start=api.indexOf('const scopedStatus='),end=api.indexOf('const scopedPickup=',start);
 assert.ok(start>=0&&end>start);
 const section=api.slice(start,end);
 assert.ok(section.includes("if(old.status===b.status){"));
 assert.ok(section.includes("if(current?.kitchen_completed_at)return json({error:'Order already kitchen-completed; refresh'},409)"));
});
