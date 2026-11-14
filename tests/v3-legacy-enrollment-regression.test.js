import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const migration=readFileSync(new URL('../migrations/0012_device_store_access.sql',import.meta.url),'utf8');
test('device store permissions schema exists',()=>{
 assert.match(migration,/CREATE TABLE IF NOT EXISTS device_store_access/);
 assert.match(migration,/INSERT OR IGNORE INTO device_store_access/);
});
test('legacy enrollment APIs are retired',()=>{
 assert.doesNotMatch(worker,/if\(path==='\/api\/device\/session'/);
 assert.doesNotMatch(worker,/if\(path==='\/api\/admin\/devices'&&req\.method==='POST'/);
});
test('pairing creates a device with store grant',()=>{
 assert.match(worker,/INSERT INTO pos_devices\(/);
 assert.match(worker,/INSERT INTO device_store_access\(/);
});
