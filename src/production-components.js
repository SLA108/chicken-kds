// Configurable production-component projection. No dish-name or menu-code hardcoding.
// Mapping rows: {menu_id,component_id,component_name,quantity_per_dish,unit,modifier_option_id?}
export function aggregateProductionComponents(orders,mappings,{storeId}={}){
 if(!storeId)throw new Error('storeId required');
 const byMenu=new Map();
 for(const row of mappings||[]){
  if(row.store_id&&row.store_id!==storeId)continue;
  if(!row.menu_id||!row.component_id||!(Number(row.quantity_per_dish)>0))continue;
  const list=byMenu.get(row.menu_id)||[];list.push(row);byMenu.set(row.menu_id,list);
 }
 const groups=new Map();
 for(const order of orders||[]){
  if(order.store_id!==storeId||order.status==='cancelled'||order.kitchen_completed_at)continue;
  for(const item of order.items||[]){
   if(item.is_done||!(Number(item.quantity)>0))continue;
   const selected=new Set((item.modifiers||[]).map(m=>String(m.option_id||'')));
   for(const mapping of byMenu.get(item.menu_id)||[]){
    if(mapping.modifier_option_id&&!selected.has(String(mapping.modifier_option_id)))continue;
    const key=JSON.stringify([mapping.component_id,mapping.unit||'unit']);
    if(!groups.has(key))groups.set(key,{component_id:mapping.component_id,name:mapping.component_name||mapping.component_id,unit:mapping.unit||'unit',quantity:0,sources:[]});
    const g=groups.get(key),quantity=Number(item.quantity)*Number(mapping.quantity_per_dish);
    g.quantity+=quantity;
    g.sources.push({order_id:order.id,order_item_id:item.id,menu_id:item.menu_id,quantity,received_at:order.created_at,deadline_at:order.platform_deadline_at||null});
   }
  }
 }
 return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
