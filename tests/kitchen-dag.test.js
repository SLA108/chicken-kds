import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKitchenDag } from '../src/kitchen-dag.js';
const item = (id, qty, overrides={}) => ({id,menu_id:'yang',name:'Yang Chicken',quantity:qty,is_done:0,modifiers:[],...overrides});
const order = (id,store,source,items,overrides={}) => ({id,store_id:store,source,status:'new',items,created_at:'2026-11-16T12:00:00Z',...overrides});
test('merges same kitchen dish across POS, Super POS and platform Quick Orders, retaining order identity and deadlines',()=>{
 const data=[
  order('pos','a','dinein',[item('i1',1)]),
  order('super','a','dinein',[item('i2',2)]),
  order('wolt','a','delivery',[item('i3',3)],{platform:'wolt',external_order_id:'W1',platform_deadline_at:'2026-11-16T12:20:00Z'}),
  order('uber','a','delivery',[item('i4',1)],{platform:'uber',platform_deadline_at:'2026-11-16T12:10:00Z'})
 ];
 const result=buildKitchenDag(data,{storeId:'a',now:Date.parse('2026-11-16T12:05:00Z')});
 assert.equal(result.length,1);
 assert.equal(result[0].quantity,7);
 assert.equal(result[0].orders.length,4);
 assert.equal(result[0].earliest_deadline_at,'2026-11-16T12:10:00.000Z');
 assert.equal(result[0].orders[0].order_id,'uber');
 assert.equal(result[0].orders[1].external_order_id,'W1');
});
test('never mixes stores, cancelled, completed orders or done items',()=>{
 const data=[
  order('other','b','delivery',[item('x',8)]),
  order('cancel','a','delivery',[item('y',5)],{status:'cancelled'}),
  order('complete','a','delivery',[item('z',6)],{kitchen_completed_at:'2026-11-16T12:02:00Z'}),
  order('partial','a','dinein',[item('d',3,{is_done:1}),item('active',2)])
 ];
 const result=buildKitchenDag(data,{storeId:'a'});
 assert.equal(result.length,1);assert.equal(result[0].quantity,2);
});
test('keeps preparation variants separate, regardless of price or sales name',()=>{
 const a=item('1',1,{name:'Wolt Yang',price_cents:5000});
 const b=item('2',2,{name:'Uber Yang',price_cents:6500});
 const c=item('3',1,{note:'No sesame'});
 const d=item('4',1,{modifiers:[{option_id:'spicy'}]});
 const result=buildKitchenDag([order('o','a','delivery',[a,b,c,d])],{storeId:'a'});
 assert.equal(result.length,3);
 assert.deepEqual(result.map(g=>g.quantity).sort((x,y)=>x-y),[1,1,3]);
});
test('expired platform deadline is flagged without changing original deadline',()=>{
 const result=buildKitchenDag([order('w','a','delivery',[item('1',1)],{platform_deadline_at:'2026-11-16T12:20:00Z'})],{storeId:'a',now:Date.parse('2026-11-16T12:21:00Z')});
 assert.equal(result[0].overdue,true);
 assert.equal(result[0].orders[0].deadline_at,'2026-11-16T12:20:00.000Z');
});
