import test from 'node:test';
import assert from 'node:assert/strict';
import {validateQuickOrder} from '../src/quick-order.js';
const now=Date.parse('2026-11-16T12:00:00Z');
const valid=()=>({platform:'wolt',external_order_id:' W-101 ',ready_by:'2026-11-16T14:00:00+01:00',client_key:'1234567890abcdef',items:[{menu_id:'m1',quantity:2}]});
test('normalizes valid platform order and timezone-aware deadline',()=>{
 const o=validateQuickOrder(valid(),now);
 assert.equal(o.external_order_id,'W-101');assert.equal(o.ready_by,'2026-11-16T13:00:00.000Z');
});
test('rejects missing external ID and unknown platform',()=>{
 for(const update of [{external_order_id:''},{platform:'unknown'}])assert.throws(()=>validateQuickOrder({...valid(),...update},now));
});
test('rejects deadlines without timezone, expired or too far in future',()=>{
 for(const ready_by of ['2026-11-16T13:00:00','2026-11-16T11:00:00Z','2026-11-20T12:00:00Z'])assert.throws(()=>validateQuickOrder({...valid(),ready_by},now));
});
test('rejects invalid item quantities and duplicate unsafe requests',()=>{
 assert.throws(()=>validateQuickOrder({...valid(),items:[{menu_id:'m1',quantity:0}]},now));
 assert.throws(()=>validateQuickOrder({...valid(),client_key:'short'},now));
});
