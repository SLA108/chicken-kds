import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
test('store switch cannot interrupt an active order submission or silently discard a draft',()=>{
 const part=app.slice(app.indexOf('function storeBanner(){'),app.indexOf('function render(){'));
 assert.match(part,/if\(busy\)\{notify\('Wait for the current order submission to finish\.'\);return\}/);
 assert.match(part,/configuredCart\.length&&!confirm\('Switching stores will discard the unsent order draft\. Continue\?'\)/);
 assert.match(part,/if\(selected===currentDeviceStore\?\.id\)/);
});
test('store-scoped order creation enforces unique client key and recovers racing inserts',()=>{
 const part=worker.slice(worker.indexOf("if(path==='/api/store/orders'&&req.method==='POST')"),worker.indexOf('const scopedItemDone='));
 assert.match(part,/SELECT id,store_id FROM orders WHERE client_key=\?/);
 assert.match(part,/if\(duplicate\)return duplicate\.store_id===storeId/);
 assert.match(part,/await env\.DB\.batch\(statements\)/);
});
