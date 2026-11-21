import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('collected platform history includes store-scoped dish details',()=>{
 const start=server.indexOf("if(path==='/api/store/platform-orders/history'&&req.method==='GET')");
 const end=server.indexOf("if(path==='/api/store/platform-orders/collection'",start);
 assert.ok(start>=0&&end>start);
 const handler=server.slice(start,end);
 assert.match(handler,/SELECT oi\.order_id,oi\.name,oi\.quantity,oi\.is_done FROM order_items oi JOIN orders o/);
 assert.match(handler,/WHERE o\.store_id=\? AND oi\.order_id IN/);
 assert.match(handler,/order\.items=byOrder\.get\(order\.order_id\)\|\|\[\]/);
 assert.match(handler,/o\.created_at>=\? AND o\.created_at<\?/);
});
test('POS preserves dish details from collected history response',()=>{
 assert.match(client,/platformCollectedHistory=\(history\.orders\|\|\[\]\)\.map\(o=>\(\{\.\.\.o,id:o\.order_id,items:o\.items\|\|\[\]\}\)\)/);
});
