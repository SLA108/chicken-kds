import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
test('pairing issues session from an active granted store rather than the legacy default',()=>{
 assert.match(source,/const allowedStores=await listAllowedDeviceStores\(env,device\.id\)/);
 assert.match(source,/const initialStore=allowedStores\.find\(s=>s\.id===device\.store_id\)\|\|allowedStores\[0\]/);
 assert.match(source,/storeId:initialStore\.id,deviceId:device\.id/);
});
test('explicit unauthorized store never silently switches to a different store',()=>{
 assert.match(source,/selectedId=body\.store_id;explicitStore=true/);
 assert.match(source,/const store=stores\.find\(s=>s\.id===selectedId\)\|\|\(!explicitStore\?stores\[0\]:null\)/);
 assert.match(source,/if\(!store\)return json\(\{error:'Store not authorized'\},403\)/);
});
test('WebSocket room is scoped by verified store session',()=>{
 assert.match(source,/const device=await allowedDeviceStore\(env,session\.deviceId,session\.storeId\)/);
 assert.match(source,/return room\(env,session\.storeId\)\.fetch/);
});
