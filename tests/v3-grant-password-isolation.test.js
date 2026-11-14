import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('grant changes require a secondary password and rate-limit incorrect attempts',()=>{
 const section=worker.slice(worker.indexOf("if(/^\\/api\\/admin\\/devices\\/[^/]+\\/stores$/.test(path)"),worker.indexOf("if(path==='/api/admin/device-pairings/approve'"));
 assert.match(section,/attemptScope='grants:'\+deviceId/);
 assert.match(section,/body\.secondary_pin/);
 assert.match(section,/approvalAttemptPolicy\(attempt,nowMs\)/);
 assert.match(section,/return json\(\{error:'Incorrect secondary password'\},403\)/);
});
test('Back Office collects secondary password before editing grants',()=>{
 assert.match(client,/name="secondary_pin" autocomplete="off" required/);
 assert.match(client,/\{store_ids:ids,secondary_pin\}/);
});
test('store order and table reads filter by verified session store',()=>{
 assert.match(worker,/getStoreOrders\(env,session\.storeId\)/);
 assert.match(worker,/WHERE t\.store_id=\? AND o\.source='dinein'/);
 assert.match(worker,/\.bind\(session\.storeId\)\.all\(\)/);
});
test('store WebSocket connections use distinct room keys',()=>{
 assert.match(worker,/idFromName\('store:'\+storeId\)/);
 assert.doesNotMatch(worker,/storeId===null\?'main'/);
 assert.match(worker,/return room\(env,session\.storeId\)\.fetch/);
 assert.match(worker,/await broadcastStore\(env,session\.storeId,'orders'/);
});
