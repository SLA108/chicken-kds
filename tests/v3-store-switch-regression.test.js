import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('device session renew accepts only authorized stores',()=>{
 assert.match(worker,/const stores=await listAllowedDeviceStores\(env,device\.id\)/);
 assert.match(worker,/if\(!store\)return json\(\{error:'Store not authorized'\},403\)/);
 assert.match(worker,/const device=await allowedDeviceStore\(env,session\.deviceId,session\.storeId\)/);
});
test('browser retries after last store grant is removed',()=>{
 assert.match(client,/if\(r\.status===403&&preferredStore\)/);
 assert.match(client,/localStorage\.removeItem\(lastStoreKey\)/);
 assert.match(client,/r=await request\(null\)/);
});
test('store switch uses clean reload rather than retaining old WebSocket',()=>{
 assert.match(client,/sessionStorage\.removeItem\('ck_token_'\+page\)/);
 assert.match(client,/location\.reload\(\)/);
 assert.match(client,/deviceStores\.some\(x=>x\.id===selected\)/);
});
