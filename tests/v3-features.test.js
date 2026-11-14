import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const api=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const tips=readFileSync(new URL('../migrations/0011_order_tips.sql',import.meta.url),'utf8');
const discounts=readFileSync(new URL('../migrations/0012_item_discounts.sql',import.meta.url),'utf8');
const reservations=readFileSync(new URL('../migrations/0013_reservations.sql',import.meta.url),'utf8');

test('paired POS reservations use the store-scoped API',()=>{
 assert.match(app,/path\.startsWith\('\/reservations\?'\)/);
 assert.match(app,/order-items\|reservations\|pos/);
 assert.match(api,/path==='\/api\/store\/reservations'/);
 assert.match(api,/session\.storeId,from\+'T00:00:00'/);
});
test('reservations are separate from orders and table occupancy',()=>{
 assert.match(reservations,/CREATE TABLE IF NOT EXISTS reservations/);
 assert.doesNotMatch(reservations,/REFERENCES orders\(/);
 assert.doesNotMatch(reservations,/table_occupancy/i);
 assert.match(api,/broadcastStore\(env,b\.store_id,'reservations'/);
});
test('tips remain separate from sales orders',()=>{
 assert.match(tips,/CREATE TABLE IF NOT EXISTS order_tips/);
 assert.match(tips,/CHECK\(method IN \('cash','card'\)\)/);
 assert.match(api,/tip_amount_cents:tipAmount/);
});
test('discount percentages are validated and persisted',()=>{
 assert.match(discounts,/discount_percent/);
 assert.match(api,/\[0,20,50\]\.includes\(discount\)/);
 assert.match(app,/50% – Finebite/);
});

test('discount controls do not run modifier group selection logic',()=>{
 assert.match(app,/input\[name\^="group-"\]/);
 assert.match(app,/input\[name="item-discount"\]/);
 assert.doesNotMatch(app,/querySelectorAll\('\.modifier-choice input'\)/);
});
test('reservation alerts refresh while POS is open and stay scoped to the current restaurant',()=>{
 assert.match(app,/loadPosReservations\(\)\},60000\)/);
 assert.match(app,/epoch!==storeEpoch\|\|store!==currentDeviceStore\?\.id/);
 assert.match(app,/posReservationAlerts\.clear\(\)/);
});

test('release-table tip and table occupancy update share one transactional batch',()=>{
 const start=api.indexOf('const scopedRelease=');
 const end=api.indexOf('const orderLookup=',start);
 const block=api.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.match(block,/env\.DB\.batch\(statements\)/);
 assert.match(block,/DELETE FROM table_occupancy/);
 assert.match(block,/INSERT INTO order_tips/);
 assert.match(block,/changes\(\)=1/);
 assert.match(app,/tip_request_key:releaseTipKey/);
 assert.doesNotMatch(app,/stage:'release',request_key:releaseTipKey/);
});

test('reservation reminders are rescheduled and not lost behind another dialog',()=>{
 assert.match(app,/posReservationAlerts\.has\(r\.id\+'@'\+r\.starts_at\)/);
 assert.match(app,/if\(showReservationAlert\(r\)\)posReservationAlerts\.add/);
 assert.match(app,/document\.querySelector\('\[id\^="reservation-reminder-"\]'\)/);
 assert.match(app,/function showReservationAlert\(r\)/);
});
test('database scripts use D1 migrations, not the legacy schema bootstrap',()=>{
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 assert.match(pkg.scripts['db:local'],/d1 migrations apply/);
 assert.match(pkg.scripts['db:remote'],/d1 migrations apply/);
 assert.doesNotMatch(pkg.scripts['db:remote'],/schema\.sql/);
});

test('Warsaw reservation reminders use calendar components instead of host-local Date.parse',()=>{
 const start=app.indexOf('async function loadPosReservations()');
 const end=app.indexOf('function showReservationAlert(',start);
 const block=app.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.match(block,/timeZone:'Europe\/Warsaw'/);
 assert.match(block,/hourCycle:'h23'/);
 assert.match(block,/Date\.UTC\(/);
 assert.doesNotMatch(block,/Date\.parse\(/);
});

test('one paired restaurant device can renew independent POS and Kitchen sessions',()=>{
 assert.match(api,/const roleCookie=\(role\)=>'ck_device'/);
 assert.match(api,/const rolePairCookie=\(role\)=>'ck_pair'/);
 assert.match(api,/issueStoreSession\(env\.AUTH_SECRET,\{role,storeId:store\.id,deviceId:device\.id\}\)/);
 assert.match(api,/session\.role!=='scanner'&&boundRole\.role==='scanner'/);
 assert.match(api,/renewalCookie\(role,device\.id,match\.credential\)/);
 assert.match(app,/pair\/start\?role=/);
 assert.match(app,/pair\/status\?role=/);
 assert.match(app,/JSON\.stringify\(storeId\?\{role:page,store_id:storeId\}:\{role:page\}\)/);
 assert.match(app,/JSON\.stringify\(\{role:page,store_id:selected\}\)/);
});

test('reservation create and edits broadcast details to their restaurant only',()=>{
 assert.match(api,/broadcastStore\(env,b\.store_id,'reservations',\{action:'created',reservation:/);
 assert.match(api,/broadcastStore\(env,storeId,'reservations',\{action:status==='cancelled'/);
 assert.match(api,/broadcastStore\(env,existing\.store_id,'reservations',\{action:'cancelled'/);
});
test('POS receives immediate booking notifications and reconnect catch-up',()=>{
 assert.match(app,/queueReservationEvent\(m\.data\);loadPosReservations\(\)/);
 assert.match(app,/NEW RESERVATION/);
 assert.match(app,/RESERVATION UPDATED/);
 assert.match(app,/RESERVATION CANCELLED/);
 assert.match(app,/sound\(\)/);
 assert.match(app,/catchUpReservationEvents\(\)/);
 assert.match(api,/updated_at>\? ORDER BY updated_at ASC/);
});

test('restaurant device approval has no POS Kitchen role selection',()=>{
 assert.doesNotMatch(app,/Device role<select name="role">/);
 assert.match(app,/Access: Front of House \+ Kitchen Display/);
 assert.match(api,/b\.role==='scanner'\?'scanner':'pos'/);
 assert.match(api,/b\.role!==undefined/);
});
