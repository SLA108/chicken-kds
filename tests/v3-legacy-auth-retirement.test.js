import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('only admin can obtain or use legacy PIN bearer tokens',()=>{
 assert.match(server,/b\.role!=='admin'/);
 assert.match(server,/for\(const role of \['admin'\]\)/);
});
test('legacy manual device enrollment and credential login removed',()=>{
 assert.ok(!server.includes("if(path==='/api/device/session'"));
 assert.ok(!server.includes("if(path==='/api/admin/devices'&&req.method==='POST')"));
 assert.ok(!ui.includes("device-secret"));
 assert.ok(!ui.includes("device-id"));
});
test('pairing and store-scoped device sessions retained',()=>{
 assert.ok(server.includes("if(path==='/api/device/renew'"));
 assert.ok(server.includes("if(path==='/api/device/pair"));
 assert.ok(ui.includes("Pair this device via Back Office"));
 assert.ok(server.includes("room(env,session.storeId)"));
});
test('shared legacy websocket no longer available to POS and Kitchen',()=>{
 assert.ok(server.includes("Use a paired device for store-scoped WebSocket access"));
});
