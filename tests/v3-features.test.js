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
