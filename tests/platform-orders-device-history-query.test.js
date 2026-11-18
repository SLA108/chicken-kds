import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const client=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const start=client.indexOf('function scopedApiPath(path){');
const end=client.indexOf('\nlet deviceStores=',start);
assert.ok(start>=0&&end>start,'scopedApiPath source exists');
// Exercise the actual router source in isolation, without browser dependencies.
const route=vm.runInNewContext('('+client.slice(start,end).trim().replace(/^function scopedApiPath/,'function')+')', {deviceMode:()=>true,page:'pos'});
test('device POS routes platform history with query parameters',()=>{
 assert.equal(route('/platform-orders/history?limit=40'),'/store/platform-orders/history?limit=40');
 assert.equal(route('/platform-orders/history'),'/store/platform-orders/history');
 assert.equal(route('/platform-orders/history/search?page=2'),'/store/platform-orders/history/search?page=2');
 assert.equal(route('/quick-order/menu?platform=wolt'),'/store/quick-order/menu?platform=wolt');
 assert.throws(()=>route('/admin/orders?limit=40'),/Device mode does not permit/);
});
test('store API accepts collected platform history query',()=>{
 assert.match(worker,/path==='\/api\/store\/platform-orders\/history'&&req\.method==='GET'/);
 assert.match(worker,/params\.get\('limit'\)/);
});
