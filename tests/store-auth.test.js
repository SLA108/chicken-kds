import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {issueStoreSession,verifyStoreSession,sha256Hex} from '../src/store-auth.js';
globalThis.crypto??=webcrypto;
const secret='a'.repeat(64);
test('store session roundtrip and scope',async()=>{
 const token=await issueStoreSession(secret,{role:'kitchen',storeId:'store-slow',deviceId:'device-1'},1000,5000);
 assert.deepEqual(await verifyStoreSession(secret,token,2000),{role:'kitchen',storeId:'store-slow',deviceId:'device-1',expiresAt:6000});
 assert.equal(await verifyStoreSession(secret,token,6000),null);
 assert.equal(await verifyStoreSession('b'.repeat(64),token,2000),null);
 assert.equal(await verifyStoreSession(secret,token.slice(0,-1)+'0',2000),null);
});
test('invalid roles and credential hash',async()=>{
 await assert.rejects(issueStoreSession(secret,{role:'admin',storeId:'store-slow',deviceId:'x'}));
 assert.equal((await sha256Hex('secret')).length,64);
});
