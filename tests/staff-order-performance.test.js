import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const token='staff-order-performance-test-token-0123456789';
const base='https://kimchipos.app/api/integrations/order-performance';
function env(rows=[]) {
 return {AUTH_SECRET:'test',ADMIN_PIN:'123456',STAFF_INTEGRATION_TOKEN:token,DB:{
  prepare(sql){
   assert.match(sql,/FROM orders o LEFT JOIN order_service_ratings r/);
   return {bind(...args){
    assert.ok(args.length>=3);
    return {async all(){return {results:rows}}};
   }};
  }
 }};
}
function request(query='',bearer=token,method='GET'){
 return new Request(base+query,{method,headers:{authorization:'Bearer '+bearer}});
}
test('order performance returns bounded read-only records and rating',async()=>{
 const record={order_id:'order-1',store_id:'store-1',completed_at:'2026-11-20T12:00:00',source:'dinein',service_rating:5};
 const response=await worker.fetch(request('?from=2026-11-20&to=2026-11-20'),env([record]));
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{orders:[record],next_cursor:null,completion_basis:'paid_at',timezone:'Europe/Warsaw'});
});
test('order performance paginates with deterministic cursor',async()=>{
 const records=[{order_id:'a',completed_at:'2026-11-20T12:00:00'},{order_id:'b',completed_at:'2026-11-20T13:00:00'}];
 const response=await worker.fetch(request('?from=2026-11-20&to=2026-11-20&limit=1'),env(records));
 const body=await response.json();
 assert.equal(body.orders.length,1);
 assert.equal(body.next_cursor,'2026-11-20T12:00:00|a');
});
test('order performance requires authorized read-only access',async()=>{
 assert.equal((await worker.fetch(request('?from=2026-11-20&to=2026-11-20','wrong'),env())).status,401);
 assert.equal((await worker.fetch(request('?from=2026-11-20&to=2026-11-20',token,'POST'),env())).status,405);
});
test('order performance validates dates and pagination',async()=>{
 for(const query of ['','?from=2026-11-20','?from=2026-01-01&to=2026-11-20','?from=2026-11-20&to=2026-11-20&limit=201','?from=2026-11-20&to=2026-11-20&cursor=bad']){
  assert.equal((await worker.fetch(request(query),env())).status,400,query);
 }
});
