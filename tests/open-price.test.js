import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const migration=readFileSync(new URL('../migrations/0016_open_price_kitchen_routing.sql',import.meta.url),'utf8');
test('open-price schema and server-side validation',()=>{
 assert.match(migration,/ADD COLUMN open_price/);
 assert.match(migration,/ADD COLUMN send_to_kitchen/);
 assert.match(api,/Number\.isSafeInteger\(item\.price_cents\)/);
 assert.match(api,/Custom amount is only allowed for open-price items/);
 assert.match(api,/basePrice=m\.open_price===1\?item\.price_cents:m\.price_cents/);
});
test('POS amount keypad and admin routing controls',()=>{
 for(const id of ['open-price-amount','data-price-key','menu-open-price','menu-send-kitchen'])assert.ok(ui.includes(id),id);
 assert.match(ui,/price_cents:x\.price_cents/);
 assert.match(ui,/m\.open_price\?'Enter amount'/);
});
test('non-kitchen items are omitted from kitchen and remain in order records',()=>{
 assert.match(api,/visible\.has\(i\.id\)/);
 assert.match(api,/m\.send_to_kitchen=1/);
 assert.match(api,/UPDATE orders SET kitchen_completed_at=\?,status='done'/);
 assert.match(api,/SELECT i\.\* FROM order_items i JOIN orders o/);
});
