import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('store grants update the default and disconnect sockets for removed stores',()=>{
 assert.match(worker,/SELECT id,store_id,active FROM pos_devices WHERE id=\?/);
 assert.match(worker,/UPDATE pos_devices SET store_id=\? WHERE id=\?/);
 assert.match(worker,/previous\.filter\(id=>!ids\.includes\(id\)\)\.map\(id=>disconnectDeviceStore/);
});
test('revoking a device disconnects sockets from every authorized store',()=>{
 assert.match(worker,/assigned\.map\(id=>disconnectDeviceStore\(env,id,revokeDeviceMatch\[1\]\)\)/);
});
test('durable object tags and closes device WebSockets',()=>{
 assert.match(worker,/this\.state\.acceptWebSocket\(server,deviceId\?\['device:'\+deviceId\]:\[\]\)/);
 assert.match(worker,/this\.state\.getTags\(socket\)\.includes\('device:'\+body\.device_id\)/);
 assert.match(worker,/socket\.close\(1008,'Device store access changed'\)/);
});
test('browser refreshes session when permission close arrives',()=>{
 assert.match(client,/event\.code===1008&&deviceMode\(\)/);
 assert.match(client,/const recovered=await renewDeviceSession\(\)/);
});
