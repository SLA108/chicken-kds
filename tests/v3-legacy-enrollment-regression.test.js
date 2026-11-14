import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const migration=readFileSync(new URL('../migrations/0012_device_store_access.sql',import.meta.url),'utf8');
test('V3.1 migration backfills existing device store permissions',()=>{
 assert.match(migration,/CREATE TABLE IF NOT EXISTS device_store_access/);
 assert.match(migration,/INSERT OR IGNORE INTO device_store_access/);
 assert.match(migration,/SELECT id,store_id,created_at FROM pos_devices/);
});
test('legacy Back Office registration creates its initial allowlist grant atomically',()=>{
 assert.match(worker,/env\.DB\.batch\(\[\s*env\.DB\.prepare\('INSERT INTO pos_devices\(id,store_id,label,token_hash,active,created_at\)/);
 assert.match(worker,/env\.DB\.prepare\('INSERT INTO device_store_access\(device_id,store_id,granted_at\)/);
});
test('legacy device session signs the actual device id and enforces its grant',()=>{
 assert.match(worker,/const store=await allowedDeviceStore\(env,device\.id,device\.store_id\)/);
 assert.match(worker,/role:b\.role,storeId:store\.store_id,deviceId:device\.id/);
 assert.doesNotMatch(worker,/role:b\.role,storeId:store\.store_id,deviceId:store\.id/);
});
