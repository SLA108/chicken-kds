import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
test('void releases occupancy while preserving cancelled order',()=>{
 const start=source.indexOf('const scopedVoid=path.match('),end=source.indexOf('// Edit the quantity of an unfinished dish',start);
 const body=source.slice(start,end);
 assert.match(body,/UPDATE orders SET status='cancelled'/);
 assert.match(body,/DELETE FROM table_occupancy WHERE store_id=\? AND order_id=\?/);
 assert.ok(body.indexOf('DELETE FROM table_occupancy')<body.lastIndexOf('ticket_voided'));
});
test('new dine-in order repairs stale cancelled occupancy before checking availability',()=>{
 const start=source.indexOf("if(path==='/api/store/orders'&&req.method==='POST')");
 const body=source.slice(start,start+3000);
 assert.match(body,/DELETE FROM table_occupancy WHERE store_id=\? AND table_no=\? AND order_id IN \(SELECT id FROM orders WHERE store_id=\? AND status='cancelled'\)/);
 assert.ok(body.indexOf('DELETE FROM table_occupancy')<body.indexOf('SELECT order_id FROM table_occupancy'));
});
