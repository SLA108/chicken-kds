import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateProductionComponents} from '../src/production-components.js';
const mappings=[
 {store_id:'A',menu_id:'5h',component_id:'chicken',component_name:'Fried Chicken',quantity_per_dish:1,unit:'portion'},
 {store_id:'A',menu_id:'5sw',component_id:'chicken',component_name:'Fried Chicken',quantity_per_dish:1,unit:'portion'},
 {store_id:'A',menu_id:'5y',component_id:'chicken',component_name:'Fried Chicken',quantity_per_dish:1,unit:'portion'},
 {store_id:'A',menu_id:'tondak',component_id:'soy',component_name:'Soy Honey Sauce',quantity_per_dish:1,unit:'portion',modifier_option_id:'soy'},
 {store_id:'B',menu_id:'5h',component_id:'other',quantity_per_dish:100,unit:'portion'}
];
const order=(id,menu_id,quantity,modifiers=[])=>({id,store_id:'A',status:'new',created_at:'2026-11-16T12:00:00Z',items:[{id:id+'-i',menu_id,quantity,is_done:0,modifiers}]});
test('three different rice dishes share one production component',()=>{
 const result=aggregateProductionComponents([order('1','5h',2),order('2','5sw',3),order('3','5y',1)],mappings,{storeId:'A'});
 assert.equal(result.length,1);assert.equal(result[0].quantity,6);assert.equal(result[0].sources.length,3);
});
test('modifier-specific component only counted when selected',()=>{
 const result=aggregateProductionComponents([order('1','tondak',2,[{option_id:'soy'}]),order('2','tondak',1,[{option_id:'yang'}])],mappings,{storeId:'A'});
 assert.equal(result[0].quantity,2);
});
test('completed items, cancelled orders, other stores are excluded',()=>{
 const done=order('1','5h',5);done.items[0].is_done=1;
 const cancelled=order('2','5h',4);cancelled.status='cancelled';
 const foreign=order('3','5h',9);foreign.store_id='B';
 assert.deepEqual(aggregateProductionComponents([done,cancelled,foreign],mappings,{storeId:'A'}),[]);
});
test('unmapped dishes remain available to the original dish-level DAG',()=>{
 assert.deepEqual(aggregateProductionComponents([order('1','unmapped',2)],mappings,{storeId:'A'}),[]);
});
