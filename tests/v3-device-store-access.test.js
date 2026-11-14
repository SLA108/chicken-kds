import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedDeviceStore,listAllowedDeviceStores} from '../src/store-auth.js';

test('device store allowlist requires explicit device and store ids',async()=>{
 const calls=[];
 const env={DB:{prepare(sql){return {bind(...args){calls.push({sql,args});return {async first(){return null;},async all(){return {results:[]};}};}};}}};
 assert.equal(await allowedDeviceStore(env,'device-a','store-b'),null);
 assert.deepEqual(calls[0].args,['device-a','store-b']);
 assert.match(calls[0].sql,/JOIN device_store_access/);
 assert.match(calls[0].sql,/d\.active=1 AND s\.active=1/);
 assert.deepEqual(await listAllowedDeviceStores(env,'device-a'),[]);
 assert.deepEqual(calls[1].args,['device-a']);
 assert.match(calls[1].sql,/JOIN device_store_access/);
});
