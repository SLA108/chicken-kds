import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const api=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');

test('device POS pickup paths map to backend scoped pickup routes',()=>{
 assert.match(ui,/path==='\/pos\/pickups'\|\|path\.startsWith\('\/pos\/pickups\/'\)/);
 assert.match(ui,/path\.slice\('\/pos'\.length\)/);
 for(const path of ['/api/store/pickups','/api/store/pickups/orders/'])assert.ok(api.includes(path),path);
});

test('device mode rejects unknown API routes rather than falling back to legacy',()=>{
 assert.match(ui,/throw Error\('Device mode does not permit this endpoint:/);
 assert.match(api,/STORE_API_NOT_READY/);
});

test('admin V3 store configuration requires explicit feature flag',()=>{
 assert.match(api,/ENABLE_V3_STORE_ADMIN!=='true'/);
 assert.match(api,/Store configuration is disabled until V3 staging verification/);
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
