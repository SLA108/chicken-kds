import {issueStoreSession,verifyStoreSession,sha256Hex,activeDeviceStore} from './store-auth.js';
const json=(x,status=200,extra={})=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra}});
const uid=()=>crypto.randomUUID();
const roles={pos:['pos','admin'],kitchen:['kitchen','admin'],admin:['admin'],scanner:['scanner','pos','admin']};
const encoder=new TextEncoder();
async function tokenFor(pin,secret){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(pin)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
async function identify(req,env){const header=req.headers.get('authorization')||'';const protocol=req.headers.get('sec-websocket-protocol')||'';const supplied=header.startsWith('Bearer ')?header.slice(7):protocol.startsWith('ckauth.')?protocol.slice(7):'';if(!supplied)return null;for(const role of ['admin','pos','kitchen','scanner']){if(!env[role.toUpperCase()+'_PIN'])continue;const expected=await tokenFor(env[role.toUpperCase()+'_PIN'],env.AUTH_SECRET);if(supplied.length===expected.length){let diff=0;for(let i=0;i<supplied.length;i++)diff|=supplied.charCodeAt(i)^expected.charCodeAt(i);if(!diff)return role;}}return null;}
// V3 foundation: existing clients stay on the legacy 'main' room.
// Store-scoped rooms are reserved for the authenticated store session rollout.
// Never select a store room from an unverified browser query/header.
function room(env,storeId=null){
 const key=storeId===null?'main':'store:'+storeId;
 return env.ROOM.get(env.ROOM.idFromName(key));
}
async function broadcast(env,type,data){try{const response=await room(env).fetch('https://room.internal/broadcast',{method:'POST',headers:{'content-type':'application/json','x-room-secret':env.AUTH_SECRET},body:JSON.stringify({type,data})});if(!response.ok)console.error('broadcast failed',response.status,await response.text());}catch(e){console.error('broadcast error',e);}}
async function broadcastStore(env,storeId,type,data){try{const response=await room(env,storeId).fetch('https://room.internal/broadcast',{method:'POST',headers:{'content-type':'application/json','x-room-secret':env.AUTH_SECRET},body:JSON.stringify({type,data})});if(!response.ok)console.error('store broadcast failed',response.status);}catch(e){console.error('store broadcast error',e);}}
async function parse(req){try{return await req.json();}catch{return null;}}
function allowed(role,action){return !!role&&roles[action].includes(role);}
async function event(env,orderId,type,actor,detail={}){const now=new Date().toISOString();await env.DB.batch([env.DB.prepare('INSERT INTO events(id,order_id,event,actor,detail,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),orderId,type,actor,JSON.stringify(detail),now),env.DB.prepare('INSERT INTO sync_outbox(id,order_id,event,payload,created_at) VALUES(?,?,?,?,?)').bind(uid(),orderId,type,JSON.stringify(detail),now)]);}
async function getOrders(env,limit=120){const orders=(await env.DB.prepare("SELECT * FROM orders WHERE status!='cancelled' AND (kitchen_completed_at IS NULL OR paid_at IS NULL OR id IN (SELECT order_id FROM table_occupancy)) ORDER BY created_at DESC LIMIT ?").bind(limit).all()).results;const ids=orders.map(o=>o.id);if(!ids.length)return [];const items=(await env.DB.prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(()=>'?').join(',')}) ORDER BY created_at ASC`).bind(...ids).all()).results;const itemIds=items.map(i=>i.id);const modifiers=itemIds.length?(await env.DB.prepare(`SELECT * FROM order_item_modifiers WHERE order_item_id IN (${itemIds.map(()=>'?').join(',')})`).bind(...itemIds).all()).results:[];return orders.map(o=>({...o,items:items.filter(i=>i.order_id===o.id).map(i=>({...i,modifiers:modifiers.filter(m=>m.order_item_id===i.id)}))}));}

// Store-scoped read model. Store ID comes only from a verified signed session.
async function getStoreOrders(env,storeId,limit=120){
 const orders=(await env.DB.prepare("SELECT * FROM orders WHERE store_id=? AND status!='cancelled' AND (kitchen_completed_at IS NULL OR paid_at IS NULL OR EXISTS (SELECT 1 FROM table_occupancy t WHERE t.order_id=orders.id AND t.store_id=orders.store_id)) ORDER BY created_at DESC LIMIT ?").bind(storeId,limit).all()).results;
 if(!orders.length)return [];
 const ids=orders.map(o=>o.id),placeholders=ids.map(()=>'?').join(',');
 const items=(await env.DB.prepare(`SELECT i.* FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.store_id=? AND i.order_id IN (${placeholders}) ORDER BY i.created_at ASC`).bind(storeId,...ids).all()).results;
 const itemIds=items.map(i=>i.id);
 const modifiers=itemIds.length?(await env.DB.prepare(`SELECT m.* FROM order_item_modifiers m JOIN order_items i ON i.id=m.order_item_id JOIN orders o ON o.id=i.order_id WHERE o.store_id=? AND m.order_item_id IN (${itemIds.map(()=>'?').join(',')})`).bind(storeId,...itemIds).all()).results:[];
 return orders.map(o=>({...o,items:items.filter(i=>i.order_id===o.id).map(i=>({...i,modifiers:modifiers.filter(m=>m.order_item_id===i.id)}))}));
}
async function prepareOrderItems(env,items,orderId,now,storeId=null){
 const unique=[...new Set(items.map(x=>x.menu_id))];
 const rows=storeId
  ?(await env.DB.prepare('SELECT m.id,m.name,m.category,m.vat_rate,COALESCE(o.price_cents,m.price_cents) AS price_cents FROM menu m LEFT JOIN store_menu_overrides o ON o.menu_id=m.id AND o.store_id=? WHERE COALESCE(o.active,m.active)=1 AND COALESCE(o.sold_out,0)=0 AND m.id IN ('+unique.map(()=>'?').join(',')+')').bind(storeId,...unique).all()).results
  :(await env.DB.prepare('SELECT * FROM menu WHERE active=1 AND id IN ('+unique.map(()=>'?').join(',')+')').bind(...unique).all()).results;
 const lookup=new Map(rows.map(x=>[x.id,x]));
 if(unique.some(id=>!lookup.has(id))||items.some(x=>!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>99))throw Error('Invalid items');
 const links=(await env.DB.prepare('SELECT l.menu_id,g.id AS group_id,g.name,g.min_select,g.max_select FROM menu_modifier_groups l JOIN modifier_groups g ON g.id=l.group_id AND g.active=1 WHERE l.menu_id IN ('+unique.map(()=>'?').join(',')+')').bind(...unique).all()).results;
 const groupIds=[...new Set(links.map(x=>x.group_id))];
 const options=groupIds.length?(await env.DB.prepare('SELECT id,group_id,name,price_cents FROM modifier_options WHERE active=1 AND group_id IN ('+groupIds.map(()=>'?').join(',')+')').bind(...groupIds).all()).results:[];
 const opts=new Map(options.map(o=>[o.id,o]));const statements=[];
 for(const item of items){
  const selected=item.option_ids??[];
  if(!Array.isArray(selected)||selected.length>30||new Set(selected).size!==selected.length||selected.some(id=>typeof id!=='string'))throw Error('Invalid modifier options');
  const groups=links.filter(g=>g.menu_id===item.menu_id);
  for(const g of groups){const count=selected.filter(id=>opts.get(id)?.group_id===g.group_id).length;if(count<g.min_select||count>g.max_select)throw Error('Invalid selections for '+g.name);}
  if(selected.some(id=>!opts.has(id)||!groups.some(g=>g.group_id===opts.get(id).group_id)))throw Error('Option not assigned to this dish');
  const m=lookup.get(item.menu_id),itemId=uid(),extra=selected.reduce((v,id)=>v+opts.get(id).price_cents,0);
  statements.push(env.DB.prepare('INSERT INTO order_items(id,order_id,menu_id,name,quantity,note,created_at,price_cents,vat_rate) VALUES(?,?,?,?,?,?,?,?,?)').bind(itemId,orderId,m.id,m.name,item.quantity,String(item.note||'').slice(0,300),now,m.price_cents+extra,m.vat_rate??8));
  for(const optionId of selected){const o=opts.get(optionId);statements.push(env.DB.prepare('INSERT INTO order_item_modifiers(id,order_item_id,option_id,name,price_cents) VALUES(?,?,?,?,?)').bind(uid(),itemId,o.id,o.name,o.price_cents));}
 }
 return statements;
}
export default {async fetch(req,env){const url=new URL(req.url);const path=url.pathname;if(path.startsWith('/images/')){if(req.method!=='GET')return new Response('Method not allowed',{status:405});const key=path.slice('/images/'.length);if(!/^[0-9a-f-]{36}\.(webp|png|jpg)$/.test(key))return new Response('Not found',{status:404});if(!env.MENU_IMAGES)return new Response('Image storage unavailable',{status:503});const object=await env.MENU_IMAGES.get(key);if(!object)return new Response('Not found',{status:404});return new Response(object.body,{headers:{'content-type':object.httpMetadata?.contentType||'image/webp','cache-control':'public, max-age=86400','x-content-type-options':'nosniff'}});}
if(!path.startsWith('/api/')&&path!=='/ws'){let assetPath=path;if(['/pos','/kitchen','/admin','/scanner','/'].includes(path))assetPath='/';return env.ASSETS.fetch(new Request(new URL(assetPath,url),req));}
if(!env.AUTH_SECRET||!env.POS_PIN||!env.KITCHEN_PIN||!env.ADMIN_PIN||!env.SCANNER_PIN)return json({error:'Server secrets not configured'},503);
if(path==='/api/login'&&req.method==='POST'){const b=await parse(req);if(!b||typeof b.pin!=='string'||!['pos','kitchen','admin','scanner'].includes(b.role))return json({error:'Invalid login'},400);const expected=env[b.role.toUpperCase()+'_PIN'];if(b.pin!==expected)return json({error:'Incorrect PIN'},401);return json({token:await tokenFor(expected,env.AUTH_SECRET),role:b.role});}
// Device exchange requires BOTH the role PIN and the per-device secret.
// Existing role PINs remain for legacy routes until the full cutover.
if(path==='/api/device/session'&&req.method==='POST'){
 const b=await parse(req);
 if(!b||!['pos','kitchen','scanner'].includes(b.role)||typeof b.pin!=='string'||typeof b.device_id!=='string'||typeof b.enrollment_secret!=='string'||!/^[0-9a-f]{64}$/.test(b.enrollment_secret))return json({error:'Invalid device login'},400);
 const expected=env[b.role.toUpperCase()+'_PIN'];
 if(!expected||b.pin!==expected)return json({error:'Invalid credentials'},401);
 const tokenHash=await sha256Hex(b.enrollment_secret);
 const device=await env.DB.prepare('SELECT id,store_id FROM pos_devices WHERE id=? AND token_hash=? AND active=1').bind(b.device_id,tokenHash).first();
 if(!device)return json({error:'Invalid credentials'},401);
 const store=await activeDeviceStore(env,device.id,device.store_id);
 if(!store)return json({error:'Store unavailable'},403);
 const token=await issueStoreSession(env.AUTH_SECRET,{role:b.role,storeId:store.store_id,deviceId:store.id});
 return json({token,role:b.role,store:{id:store.store_id,code:store.code,name:store.name},expires_in:28800,api_enabled:false});
}
const bearer=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
const wsProtocol=req.headers.get('sec-websocket-protocol')||'';
const sessionToken=bearer.startsWith('cks1.')?bearer:wsProtocol.startsWith('ckauth.cks1.')?wsProtocol.slice('ckauth.'.length):'';
if(sessionToken){
 const session=await verifyStoreSession(env.AUTH_SECRET,sessionToken);
 if(!session)return json({error:'Invalid or expired device session'},401);
 const device=await activeDeviceStore(env,session.deviceId,session.storeId);
 if(!device)return json({error:'Device revoked or store inactive'},403);
 if(path==='/api/device/me'&&req.method==='GET')return json({role:session.role,store:{id:device.store_id,code:device.code,name:device.name},expires_at:session.expiresAt,api_enabled:false});
 if(path==='/api/store/orders'&&req.method==='GET'){
  if(!['pos','kitchen'].includes(session.role))return json({error:'Forbidden'},403);
  const orders=await getStoreOrders(env,session.storeId);
  if(session.role==='kitchen')return json(orders);
  const ids=orders.map(o=>o.id);
  const [occupancy,payments]=await Promise.all([
   env.DB.prepare('SELECT order_id FROM table_occupancy WHERE store_id=?').bind(session.storeId).all(),
   ids.length?env.DB.prepare(`SELECT p.order_id,p.method,p.amount_cents,p.created_at FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.store_id=? AND o.store_id=? AND p.order_id IN (${ids.map(()=>'?').join(',')}) ORDER BY p.created_at DESC`).bind(session.storeId,session.storeId,...ids).all():Promise.resolve({results:[]})
  ]);
  const occupied=new Set(occupancy.results.map(x=>x.order_id));
  return json(orders.map(o=>({...o,table_occupied:occupied.has(o.id),payment:payments.results.find(p=>p.order_id===o.id)||null})));
 }
 if(path==='/api/store/tables'&&req.method==='GET'){
  if(session.role!=='pos')return json({error:'Forbidden'},403);
  const rows=(await env.DB.prepare("SELECT o.id,o.table_no,o.status,o.created_at FROM table_occupancy t JOIN orders o ON o.id=t.order_id AND o.store_id=t.store_id WHERE t.store_id=? AND o.source='dinein' AND o.status!='cancelled' ORDER BY o.created_at DESC").bind(session.storeId).all()).results;
  return json(Array.from({length:20},(_,i)=>{const number=String(i+1).padStart(2,'0'),matches=rows.filter(o=>o.table_no===number);return {number,occupied:matches.length>0,order_id:matches[0]?.id||null,conflict:matches.length>1,status:matches[0]?.status||null};}));
 }

 if(path==='/ws'){
  if(!['pos','kitchen'].includes(session.role))return json({error:'Forbidden'},403);
  if(req.headers.get('upgrade')!=='websocket')return json({error:'WebSocket required'},426);
  return room(env,session.storeId).fetch(new Request('https://room.internal/ws',{headers:{upgrade:'websocket','x-room-secret':env.AUTH_SECRET,'x-client-role':session.role,'sec-websocket-protocol':wsProtocol}}));
 }
 if(path==='/api/store/menu'&&req.method==='GET'){
  if(!['pos','kitchen'].includes(session.role))return json({error:'Forbidden'},403);
  const rows=(await env.DB.prepare("SELECT m.id,m.name,m.category,COALESCE(o.price_cents,m.price_cents) AS price_cents,m.vat_rate,m.image_url,m.sort_order FROM menu m LEFT JOIN store_menu_overrides o ON o.menu_id=m.id AND o.store_id=? WHERE COALESCE(o.active,m.active)=1 AND COALESCE(o.sold_out,0)=0 ORDER BY m.sort_order,m.name").bind(session.storeId).all()).results;
  return json(rows);
 }
 if(path==='/api/store/pickups'&&req.method==='GET'){
  if(session.role!=='pos')return json({error:'Forbidden'},403);
  const rows=(await env.DB.prepare("SELECT oi.id AS item_id,oi.order_id,oi.name,oi.quantity,oi.done_at,o.table_no,o.source FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.store_id=? AND oi.is_done=1 AND oi.picked_up_at IS NULL AND o.status!='cancelled' ORDER BY oi.done_at ASC LIMIT 200").bind(session.storeId).all()).results;
  return json({items:rows});
 }

 const scopedCheckout=path.match(/^\/api\/store\/orders\/([^/]+)\/checkout$/);
 if(scopedCheckout&&req.method==='POST'){
  if(session.role!=='pos')return json({error:'Forbidden'},403);
  const b=await parse(req);
  if(!['cash','card','other'].includes(b?.method))return json({error:'Invalid payment method'},400);
  const id=scopedCheckout[1],storeId=session.storeId;
  const order=await env.DB.prepare('SELECT id,status,paid_at FROM orders WHERE id=? AND store_id=?').bind(id,storeId).first();
  if(!order)return json({error:'Ticket not found'},404);
  if(order.paid_at||order.status==='cancelled')return json({error:'Ticket cannot be paid'},409);
  const totalRow=await env.DB.prepare('SELECT COALESCE(SUM(i.quantity*i.price_cents),0) AS total,SUM(CASE WHEN i.price_cents IS NULL THEN 1 ELSE 0 END) AS unpriced FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.id=? AND o.store_id=?').bind(id,storeId).first();
  if(totalRow.unpriced)return json({error:'Unpriced items'},409);
  const total=Number(totalRow.total);
  if(!Number.isSafeInteger(total)||total<0)return json({error:'Invalid total'},409);
  const now=new Date().toISOString(),paymentId=uid();
  // D1 batch is transactional. changes() ties payment insertion to the immediately preceding successful checkout UPDATE; the V3 unique index also prevents duplicate payments.
  const result=await env.DB.batch([
   env.DB.prepare("UPDATE orders SET paid_at=?,updated_at=? WHERE id=? AND store_id=? AND paid_at IS NULL AND status!='cancelled'").bind(now,now,id,storeId),
   env.DB.prepare("INSERT INTO payments(id,order_id,method,amount_cents,created_at,store_id) SELECT ?,?,?,?,?,? WHERE changes()=1 AND EXISTS(SELECT 1 FROM orders WHERE id=? AND store_id=? AND paid_at=?)").bind(paymentId,id,b.method,total,now,storeId,id,storeId,now),
   env.DB.prepare("INSERT INTO events(id,order_id,event,actor,detail,created_at) SELECT ?,?,'paid',?,?,? WHERE EXISTS(SELECT 1 FROM payments WHERE id=? AND store_id=?)").bind(uid(),id,session.role,JSON.stringify({method:b.method,amount_cents:total,store_id:storeId}),now,paymentId,storeId)
  ]);
  if(result[0].meta.changes!==1)return json({error:'Ticket already closed; refresh'},409);
  await broadcastStore(env,storeId,'orders',{id});
  return json({ok:true,amount_cents:total});
 }
 const scopedRelease=path.match(/^\/api\/store\/orders\/([^/]+)\/release-table$/);
 if(scopedRelease&&req.method==='POST'){
  if(session.role!=='pos')return json({error:'Forbidden'},403);
  const id=scopedRelease[1],storeId=session.storeId;
  const order=await env.DB.prepare("SELECT id,table_no FROM orders WHERE id=? AND store_id=? AND source='dinein'").bind(id,storeId).first();
  if(!order)return json({error:'Dine-in order not found'},404);
  const result=await env.DB.prepare('DELETE FROM table_occupancy WHERE order_id=? AND store_id=?').bind(id,storeId).run();
  if(!result.meta.changes)return json({error:'Table already released'},409);
  await event(env,id,'table_released',session.role,{table_no:order.table_no,store_id:storeId});
  await broadcastStore(env,storeId,'orders',{id});
  return json({ok:true});
 }

 if(path==='/api/store/orders'&&req.method==='POST'){
  if(session.role!=='pos')return json({error:'Forbidden'},403);
  const b=await parse(req);
  if(!b||!Array.isArray(b.items)||!b.items.length||b.items.length>100||typeof b.client_key!=='string'||b.client_key.length<16||!['dinein','takeaway','delivery'].includes(b.source))return json({error:'Invalid order'},400);
  if(b.items.some(x=>typeof x.menu_id!=='string'))return json({error:'Invalid menu IDs'},400);
  const storeId=session.storeId;
  const existing=await env.DB.prepare('SELECT id,store_id FROM orders WHERE client_key=?').bind(b.client_key).first();
  if(existing)return existing.store_id===storeId?json({id:existing.id,duplicate:true}):json({error:'Client key already used'},409);
  if(b.source==='dinein'){
   if(!/^(0[1-9]|1[0-9]|20)$/.test(String(b.table_no||'')))return json({error:'Choose a table from 01 to 20'},400);
   const occupied=await env.DB.prepare('SELECT order_id FROM table_occupancy WHERE store_id=? AND table_no=?').bind(storeId,b.table_no).first();
   if(occupied)return json({error:'Table occupied'},409);
  }
  const id=uid(),now=new Date().toISOString();
  const statements=[env.DB.prepare('INSERT INTO orders(id,source,table_no,status,note,created_at,updated_at,created_by,client_key,store_id) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,b.source,String(b.table_no||'').slice(0,30),'new',String(b.note||'').slice(0,500),now,now,session.role,b.client_key,storeId)];
  if(b.source==='dinein')statements.push(env.DB.prepare('INSERT INTO table_occupancy(store_id,table_no,order_id,created_at) VALUES(?,?,?,?)').bind(storeId,b.table_no,id,now));
  try{statements.push(...await prepareOrderItems(env,b.items,id,now,storeId));}catch(e){return json({error:e.message},400);}
  statements.push(env.DB.prepare('INSERT INTO events(id,order_id,event,actor,detail,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),id,'created',session.role,JSON.stringify({store_id:storeId}),now));
  statements.push(env.DB.prepare('INSERT INTO sync_outbox(id,order_id,event,payload,created_at) VALUES(?,?,?,?,?)').bind(uid(),id,'created',JSON.stringify({store_id:storeId}),now));
  try{await env.DB.batch(statements);}catch(e){
   const duplicate=await env.DB.prepare('SELECT id,store_id FROM orders WHERE client_key=?').bind(b.client_key).first();
   if(duplicate)return duplicate.store_id===storeId?json({id:duplicate.id,duplicate:true}):json({error:'Client key already used'},409);
   if(b.source==='dinein'&&String(e).includes('UNIQUE'))return json({error:'Table already occupied'},409);
   throw e;
  }
  await broadcastStore(env,storeId,'orders',{id});
  return json({id},201);
 }

 const scopedItemDone=path.match(/^\/api\/store\/order-items\/([^/]+)\/done$/);
 if(scopedItemDone&&req.method==='PATCH'){
  if(session.role!=='kitchen')return json({error:'Forbidden'},403);
  const item=await env.DB.prepare("SELECT i.id,i.order_id,o.status,o.kitchen_completed_at FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.id=? AND o.store_id=?").bind(scopedItemDone[1],session.storeId).first();
  if(!item)return json({error:'Item not found'},404);
  if(item.status==='cancelled'||item.kitchen_completed_at)return json({error:'Order is closed'},409);
  const now=new Date().toISOString();
  let updated;
  try{
   updated=await env.DB.prepare("UPDATE order_items SET is_done=CASE WHEN is_done=1 THEN 0 ELSE 1 END,done_at=CASE WHEN is_done=1 THEN NULL ELSE ? END,picked_up_at=NULL WHERE id=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND store_id=? AND status!='cancelled' AND kitchen_completed_at IS NULL) RETURNING is_done").bind(now,item.id,item.order_id,session.storeId).first();
  }catch(e){
   // Migration 0010 protects against kitchen completion between the read and write.
   const current=await env.DB.prepare('SELECT status,kitchen_completed_at FROM orders WHERE id=? AND store_id=?').bind(item.order_id,session.storeId).first();
   if(!current||current.status==='cancelled'||current.kitchen_completed_at)return json({error:'Order changed; refresh'},409);
   throw e;
  }
  if(!updated)return json({error:'Order changed; refresh'},409);
  const summary=await env.DB.prepare('SELECT COUNT(*) total,SUM(CASE WHEN is_done=1 THEN 1 ELSE 0 END) done FROM order_items WHERE order_id=?').bind(item.order_id).first();
  const nextStatus=summary.total===summary.done?'done':'new';
  // A concurrent kitchen completion must not be undone by a stale item-status refresh.
  const statusUpdate=await env.DB.prepare("UPDATE orders SET status=?,updated_at=? WHERE id=? AND store_id=? AND status!='cancelled' AND kitchen_completed_at IS NULL").bind(nextStatus,now,item.order_id,session.storeId).run();
  if(statusUpdate.meta.changes!==1)return json({error:'Order changed; refresh'},409);
  await event(env,item.order_id,updated.is_done?'item_done':'item_undone',session.role,{item_id:item.id,store_id:session.storeId});
  await broadcastStore(env,session.storeId,'orders',{id:item.order_id,item_id:item.id});
  await broadcastStore(env,session.storeId,'pickup',{item_id:item.id,ready:!!updated.is_done});
  return json({ok:true,is_done:updated.is_done,order_status:nextStatus});
 }
 const scopedStatus=path.match(/^\/api\/store\/orders\/([^/]+)\/status$/);
 if(scopedStatus&&req.method==='PATCH'){
  if(session.role!=='kitchen')return json({error:'Forbidden'},403);
  const b=await parse(req);
  if(!['cooking','done'].includes(b?.status))return json({error:'Invalid status'},400);
  const id=scopedStatus[1],old=await env.DB.prepare('SELECT status,paid_at FROM orders WHERE id=? AND store_id=?').bind(id,session.storeId).first();
  if(!old)return json({error:'Not found'},404);
  if(old.status===b.status)return json({ok:true});
  const transitions={new:['cooking'],cooking:['done']};
  if(!transitions[old.status]?.includes(b.status))return json({error:'Invalid transition'},409);
  const now=new Date().toISOString();
  const result=await env.DB.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=? AND store_id=? AND status=? AND kitchen_completed_at IS NULL').bind(b.status,now,id,session.storeId,old.status).run();
  if(result.meta.changes!==1)return json({error:'Order changed; refresh'},409);
  await event(env,id,'status',session.role,{from:old.status,to:b.status,store_id:session.storeId});
  await broadcastStore(env,session.storeId,'orders',{id});
  return json({ok:true});
 }
 const scopedPickup=path.match(/^\/api\/store\/pickups\/([^/]+)\/ack$/);
 if(scopedPickup&&req.method==='POST'){
  if(session.role!=='pos')return json({error:'Forbidden'},403);
  const now=new Date().toISOString();
  const result=await env.DB.prepare("UPDATE order_items SET picked_up_at=? WHERE id=? AND is_done=1 AND picked_up_at IS NULL AND EXISTS (SELECT 1 FROM orders WHERE id=order_items.order_id AND store_id=? AND status!='cancelled')").bind(now,scopedPickup[1],session.storeId).run();
  if(!result.meta.changes)return json({error:'Dish unavailable'},409);
  await broadcastStore(env,session.storeId,'pickup',{item_id:scopedPickup[1]});
  return json({ok:true});
 }

 const scopedAddItems=path.match(/^\/api\/store\/orders\/([^/]+)\/items$/);
 if(scopedAddItems&&req.method==='POST'){
  if(session.role!=='pos')return json({error:'Forbidden'},403);
  const b=await parse(req);
  if(!b||!Array.isArray(b.items)||b.items.length<1||b.items.length>30)return json({error:'Invalid items'},400);
  const id=scopedAddItems[1],storeId=session.storeId;
  const order=await env.DB.prepare('SELECT status,paid_at,kitchen_completed_at FROM orders WHERE id=? AND store_id=?').bind(id,storeId).first();
  if(!order)return json({error:'Order not found'},404);
  if(order.status==='cancelled'||order.paid_at||order.kitchen_completed_at)return json({error:'Order closed'},409);
  const now=new Date().toISOString();
  let statements;
  try{statements=await prepareOrderItems(env,b.items,id,now,storeId);}catch(e){return json({error:e.message},400);}
  statements.push(env.DB.prepare("UPDATE orders SET status='new',updated_at=? WHERE id=? AND store_id=? AND paid_at IS NULL AND kitchen_completed_at IS NULL AND status!='cancelled'").bind(now,id,storeId));
  statements.push(env.DB.prepare('INSERT INTO events(id,order_id,event,actor,detail,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),id,'items_added',session.role,JSON.stringify({count:b.items.length,store_id:storeId}),now));
  let result;
  try{result=await env.DB.batch(statements);}
  catch(e){
   // Migration 0009 rejects additions when checkout or kitchen completion wins
   // the race. Report a recoverable conflict, not an internal server error.
   const current=await env.DB.prepare('SELECT status,paid_at,kitchen_completed_at FROM orders WHERE id=? AND store_id=?').bind(id,storeId).first();
   if(!current||current.status==='cancelled'||current.paid_at||current.kitchen_completed_at)return json({error:'Order changed; refresh'},409);
   throw e;
  }
  if(result[result.length-2].meta.changes!==1)return json({error:'Order changed; refresh'},409);
  await broadcastStore(env,storeId,'orders',{id});
  return json({ok:true});
 }
 const scopedPickupAll=path.match(/^\/api\/store\/pickups\/orders\/([^/]+)\/ack-all$/);
 if(scopedPickupAll&&req.method==='POST'){
  if(session.role!=='pos')return json({error:'Forbidden'},403);
  const id=scopedPickupAll[1],now=new Date().toISOString();
  const result=await env.DB.prepare("UPDATE order_items SET picked_up_at=? WHERE order_id=? AND is_done=1 AND picked_up_at IS NULL AND EXISTS(SELECT 1 FROM orders WHERE id=? AND store_id=? AND status!='cancelled')").bind(now,id,id,session.storeId).run();
  if(result.meta.changes)await broadcastStore(env,session.storeId,'pickup',{order_id:id,acknowledged:result.meta.changes});
  return json({ok:true,count:result.meta.changes||0});
 }

 if(path==='/api/store/kitchen/history'&&req.method==='GET'){
  if(session.role!=='kitchen')return json({error:'Forbidden'},403);
  const u=new URL(req.url),range=u.searchParams.get('range')||'today',q=(u.searchParams.get('q')||'').trim().slice(0,80);
  const page=Math.max(1,Math.min(10000,Number.parseInt(u.searchParams.get('page')||'1',10)||1)),size=15;
  if(!['today','yesterday','all'].includes(range))return json({error:'Invalid range'},400);
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'});
  const today=fmt.format(new Date()),day=new Date(today+'T12:00:00Z');
  if(range==='yesterday')day.setUTCDate(day.getUTCDate()-1);
  const target=range==='all'?null:day.toISOString().slice(0,10);
  const where="o.store_id=? AND o.kitchen_completed_at IS NOT NULL AND o.status!='cancelled'"+(q?" AND (o.id LIKE ? OR o.table_no LIKE ?)":"");
  const args=[session.storeId,...(q?['%'+q+'%','%'+q+'%']:[])],scanLimit=range==='all'?500:1500;
  const rows=(await env.DB.prepare('SELECT o.id,o.source,o.table_no,o.created_at,o.kitchen_completed_at,o.paid_at FROM orders o WHERE '+where+' ORDER BY o.kitchen_completed_at DESC LIMIT ?').bind(...args,scanLimit).all()).results;
  const filtered=target?rows.filter(o=>fmt.format(new Date(o.kitchen_completed_at))===target):rows;
  const selected=filtered.slice((page-1)*size,page*size),ids=selected.map(o=>o.id);
  const items=ids.length?(await env.DB.prepare('SELECT i.id,i.order_id,i.name,i.quantity,i.is_done FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.store_id=? AND i.order_id IN ('+ids.map(()=>'?').join(',')+') ORDER BY i.created_at').bind(session.storeId,...ids).all()).results:[];
  return json({page,size,total:filtered.length,has_more:page*size<filtered.length,limited:rows.length===scanLimit,orders:selected.map(o=>({...o,items:items.filter(i=>i.order_id===o.id)}))});
 }

 const scopedKitchenFinish=path.match(/^\/api\/store\/kitchen\/orders\/([^/]+)\/(complete|reopen)$/);
 if(scopedKitchenFinish&&req.method==='POST'){
  if(session.role!=='kitchen')return json({error:'Forbidden'},403);
  const id=scopedKitchenFinish[1],action=scopedKitchenFinish[2],storeId=session.storeId;
  const order=await env.DB.prepare('SELECT status,kitchen_completed_at FROM orders WHERE id=? AND store_id=?').bind(id,storeId).first();
  if(!order)return json({error:'Order not found'},404);
  if(order.status==='cancelled')return json({error:'Cancelled order'},409);
  if(action==='complete'&&order.kitchen_completed_at)return json({ok:true,already_completed:true});
  if(action==='reopen'&&!order.kitchen_completed_at)return json({ok:true,already_open:true});
  const now=new Date().toISOString();
  const result=await env.DB.prepare(action==='complete'
   ?"UPDATE orders SET kitchen_completed_at=?,status='done',updated_at=? WHERE id=? AND store_id=? AND kitchen_completed_at IS NULL AND status!='cancelled'"
   :"UPDATE orders SET kitchen_completed_at=NULL,status='new',updated_at=? WHERE id=? AND store_id=? AND kitchen_completed_at IS NOT NULL AND status!='cancelled'"
  ).bind(...(action==='complete'?[now,now,id,storeId]:[now,id,storeId])).run();
  if(result.meta.changes!==1)return json({error:'Order changed; refresh'},409);
  await event(env,id,action==='complete'?'kitchen_completed':'kitchen_reopened',session.role,{store_id:storeId});
  await broadcastStore(env,storeId,'orders',{id});
  return json({ok:true});
 }

 if(path==='/api/store/pos/history'&&req.method==='GET'){
  if(session.role!=='pos')return json({error:'Forbidden'},403);
  const u=new URL(req.url),range=u.searchParams.get('range')||'today',method=u.searchParams.get('method')||'all',q=(u.searchParams.get('q')||'').trim().slice(0,80);
  const page=Math.max(1,Math.min(100000,Number.parseInt(u.searchParams.get('page')||'1',10)||1)),size=15;
  if(!['today','yesterday','custom','all'].includes(range)||!['all','cash','card','other'].includes(method))return json({error:'Invalid filters'},400);
  const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T12:00:00Z'))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
  const dateFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'});
  const warsawDay=d=>{const parts=Object.fromEntries(dateFmt.formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return parts.year+'-'+parts.month+'-'+parts.day};
  const shiftDay=(day,days)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
  const midnightUtc=day=>{
   const target=Date.parse(day+'T00:00:00Z');
   const partsFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Warsaw',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
   let t=target;
   for(let i=0;i<3;i++){const p=Object.fromEntries(partsFmt.formatToParts(new Date(t)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));t+=target-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);}
   return new Date(t).toISOString();
  };
  let from=null,to=null;
  if(range!=='all'){
   const today=warsawDay(new Date());
   from=range==='custom'?u.searchParams.get('from'):range==='today'?today:shiftDay(today,-1);
   to=range==='custom'?u.searchParams.get('to'):from;
   if(!validDate(from)||!validDate(to)||from>to)return json({error:'Invalid date range'},400);
  }
  const filters=['o.store_id=?','o.paid_at IS NOT NULL'],params=[session.storeId];
  if(from){filters.push('o.paid_at >= ? AND o.paid_at < ?');params.push(midnightUtc(from),midnightUtc(shiftDay(to,1)));}
  if(q){filters.push('(o.id LIKE ? OR o.table_no LIKE ?)');params.push('%'+q+'%','%'+q+'%');}
  if(method!=='all'){filters.push('p.method=?');params.push(method);}
  const joined=" FROM orders o LEFT JOIN payments p ON p.id=(SELECT p2.id FROM payments p2 WHERE p2.order_id=o.id AND p2.store_id=o.store_id ORDER BY p2.created_at DESC,p2.id DESC LIMIT 1) WHERE "+filters.join(' AND ');
  const summary=await env.DB.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(p.amount_cents),0) AS total_cents,COALESCE(SUM(CASE WHEN p.method='cash' THEN p.amount_cents ELSE 0 END),0) AS cash_cents,COALESCE(SUM(CASE WHEN p.method='card' THEN p.amount_cents ELSE 0 END),0) AS card_cents,COALESCE(SUM(CASE WHEN p.method='other' THEN p.amount_cents ELSE 0 END),0) AS other_cents"+joined).bind(...params).first();
  const orders=(await env.DB.prepare("SELECT o.id,o.source,o.table_no,o.paid_at,o.kitchen_completed_at,p.method,p.amount_cents"+joined+" ORDER BY o.paid_at DESC,o.id DESC LIMIT ? OFFSET ?").bind(...params,size,(page-1)*size).all()).results;
  return json({orders,total:Number(summary.total),page,size,summary:{total_cents:Number(summary.total_cents),cash_cents:Number(summary.cash_cents),card_cents:Number(summary.card_cents),other_cents:Number(summary.other_cents)},filters:{range,method,from,to}});
 }
 if(path==='/api/store/menu/modifiers'&&req.method==='GET'){
  if(session.role!=='pos')return json({error:'Forbidden'},403);
  const [groups,options,links]=await Promise.all([env.DB.prepare('SELECT id,name,min_select,max_select FROM modifier_groups WHERE active=1').all(),env.DB.prepare('SELECT id,group_id,name,price_cents FROM modifier_options WHERE active=1').all(),env.DB.prepare("SELECT l.menu_id,l.group_id FROM menu_modifier_groups l JOIN menu m ON m.id=l.menu_id LEFT JOIN store_menu_overrides o ON o.menu_id=m.id AND o.store_id=? WHERE COALESCE(o.active,m.active)=1 AND COALESCE(o.sold_out,0)=0").bind(session.storeId).all()]);
  return json({groups:groups.results,options:options.results,links:links.results});
 }
 if(path==='/api/store/kitchen/categories'&&req.method==='GET'){
  if(session.role!=='kitchen')return json({error:'Forbidden'},403);
  return json((await env.DB.prepare('SELECT name,sort_order FROM menu_categories ORDER BY sort_order,name').all()).results);
 }

 const scopedPosDetail=path.match(/^\/api\/store\/pos\/history\/([^/]+)$/);
 if(scopedPosDetail&&req.method==='GET'){
  if(session.role!=='pos')return json({error:'Forbidden'},403);
  const id=decodeURIComponent(scopedPosDetail[1]),storeId=session.storeId;
  const order=await env.DB.prepare('SELECT id,source,table_no,status,note,created_at,paid_at,kitchen_completed_at FROM orders WHERE id=? AND store_id=? AND paid_at IS NOT NULL').bind(id,storeId).first();
  if(!order)return json({error:'Paid order not found'},404);
  const [itemsResult,paymentsResult,eventsResult,occupancy]=await Promise.all([
   env.DB.prepare('SELECT i.id,i.name,i.quantity,i.note,i.price_cents,i.is_done,i.created_at FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.order_id=? AND o.store_id=? ORDER BY i.created_at,i.id').bind(id,storeId).all(),
   env.DB.prepare('SELECT id,method,amount_cents,created_at FROM payments WHERE order_id=? AND store_id=? ORDER BY created_at').bind(id,storeId).all(),
   env.DB.prepare('SELECT e.event,e.actor,e.detail,e.created_at FROM events e JOIN orders o ON o.id=e.order_id WHERE e.order_id=? AND o.store_id=? ORDER BY e.created_at').bind(id,storeId).all(),
   env.DB.prepare('SELECT table_no FROM table_occupancy WHERE order_id=? AND store_id=?').bind(id,storeId).first()
  ]);
  const items=itemsResult.results,ids=items.map(i=>i.id);
  const modifiers=ids.length?(await env.DB.prepare('SELECT m.order_item_id,m.name,m.price_cents FROM order_item_modifiers m JOIN order_items i ON i.id=m.order_item_id JOIN orders o ON o.id=i.order_id WHERE o.store_id=? AND i.order_id=? AND m.order_item_id IN ('+ids.map(()=>'?').join(',')+')').bind(storeId,id,...ids).all()).results:[];
  return json({order:{...order,table_occupied:!!occupancy},items:items.map(i=>({...i,modifiers:modifiers.filter(m=>m.order_item_id===i.id)})),payments:paymentsResult.results,events:eventsResult.results});
 }
 // Fail closed: do not grant access to unscoped legacy APIs.
 return json({error:'Store-scoped API rollout not enabled',code:'STORE_API_NOT_READY'},503);
}
const role=await identify(req,env);if(!role)return json({error:'Unauthorized'},401);
// Optional staging-only cutover guard. Never enable before all legacy
// endpoints have store-scoped replacements and admin access is secured.
if(env.DISABLE_LEGACY_STORE_ACCESS==='true'&&role!=='admin')return json({error:'Legacy role sessions disabled',code:'LEGACY_ACCESS_DISABLED'},403);
try{
// V3.0 read-only store inventory. Requires migration 0007.
// Store selection and order routing are intentionally NOT enabled until
// authenticated store-scoped sessions and all query isolation are implemented.
if(path==='/api/admin/stores'&&req.method==='GET'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 try{
  const rows=(await env.DB.prepare("SELECT s.id,s.code,s.name,s.active,COUNT(o.id) AS order_count FROM stores s LEFT JOIN orders o ON o.store_id=s.id GROUP BY s.id,s.code,s.name,s.active ORDER BY CASE WHEN s.code='TEST' THEN 0 ELSE 1 END,s.name").all()).results;
  return json({stores:rows,multistore_enabled:false});
 }catch(e){
  console.error('store inventory unavailable',e);
  return json({error:'Multi-store schema not installed',code:'MULTISTORE_SCHEMA_MISSING'},503);
 }
}

const storeConfigMatch=path.match(/^\/api\/admin\/stores\/([a-zA-Z0-9_-]{1,64})\/config$/);
if(storeConfigMatch&&req.method==='PATCH'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 if(env.ENABLE_V3_STORE_ADMIN!=='true')return json({error:'Store configuration is disabled until V3 staging verification'},503);
 const id=storeConfigMatch[1],b=await parse(req);
 if(!b||typeof b.active!=='boolean')return json({error:'Expected active boolean'},400);
 const store=await env.DB.prepare('SELECT id,code,active FROM stores WHERE id=?').bind(id).first();
 if(!store)return json({error:'Store not found'},404);
 if(store.code==='TEST'&&!b.active)return json({error:'Test store must remain available'},409);
 const result=await env.DB.prepare('UPDATE stores SET active=? WHERE id=?').bind(b.active?1:0,id).run();
 return json({ok:true,id,active:b.active,changed:result.meta.changes});
}
const storeMenuMatch=path.match(/^\/api\/admin\/stores\/([a-zA-Z0-9_-]{1,64})\/menu$/);
if(storeMenuMatch&&req.method==='GET'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const id=storeMenuMatch[1],store=await env.DB.prepare('SELECT id,code,name,active FROM stores WHERE id=?').bind(id).first();
 if(!store)return json({error:'Store not found'},404);
 const items=(await env.DB.prepare('SELECT m.id,m.name,m.category,m.price_cents AS base_price_cents,m.active AS base_active,o.price_cents AS override_price_cents,o.active AS override_active,COALESCE(o.sold_out,0) AS sold_out,o.updated_at FROM menu m LEFT JOIN store_menu_overrides o ON o.menu_id=m.id AND o.store_id=? ORDER BY m.category,m.sort_order,m.name').bind(id).all()).results;
 return json({store,items});
}
const storeMenuItemMatch=path.match(/^\/api\/admin\/stores\/([a-zA-Z0-9_-]{1,64})\/menu\/([^/]+)$/);
if(storeMenuItemMatch&&req.method==='PUT'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 if(env.ENABLE_V3_STORE_ADMIN!=='true')return json({error:'Store menu editing is disabled until V3 staging verification'},503);
 const storeId=storeMenuItemMatch[1],menuId=decodeURIComponent(storeMenuItemMatch[2]),b=await parse(req);
 if(!b||!Number.isInteger(b.price_cents)&&b.price_cents!==null||b.price_cents!==null&&(b.price_cents<0||b.price_cents>10000000)||![null,true,false].includes(b.active)||typeof b.sold_out!=='boolean')return json({error:'Invalid menu override'},400);
 const [store,item]=await Promise.all([env.DB.prepare('SELECT id FROM stores WHERE id=?').bind(storeId).first(),env.DB.prepare('SELECT id FROM menu WHERE id=?').bind(menuId).first()]);
 if(!store||!item)return json({error:'Store or menu item not found'},404);
 await env.DB.prepare('INSERT INTO store_menu_overrides(store_id,menu_id,price_cents,active,sold_out,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(store_id,menu_id) DO UPDATE SET price_cents=excluded.price_cents,active=excluded.active,sold_out=excluded.sold_out,updated_at=excluded.updated_at').bind(storeId,menuId,b.price_cents,b.active===null?null:b.active?1:0,b.sold_out?1:0,new Date().toISOString()).run();
 await broadcastStore(env,storeId,'menu',{menu_id:menuId});
 return json({ok:true});
}
// Cross-store paid sales report. TEST is excluded unless explicitly requested.
if(path==='/api/admin/store-sales'&&req.method==='GET'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const q=new URL(req.url).searchParams,from=q.get('from'),to=q.get('to'),includeTest=q.get('include_test')==='true';
 const valid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
 if((from&&!valid(from))||(to&&!valid(to))||(from&&to&&from>to))return json({error:'Invalid date range'},400);
 const conditions=["o.paid_at IS NOT NULL"],args=[];
 if(!includeTest)conditions.push("s.code!='TEST'");
 // Convert Warsaw calendar-day boundaries to UTC, including DST changes.
 const midnightUtc=day=>{
  const target=Date.parse(day+'T00:00:00Z');
  const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Warsaw',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  let t=target;
  for(let i=0;i<3;i++){const p=Object.fromEntries(fmt.formatToParts(new Date(t)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));t+=target-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);}
  return new Date(t).toISOString();
 };
 if(from){conditions.push('o.paid_at>=?');args.push(midnightUtc(from));}
 if(to){const next=new Date(to+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);conditions.push('o.paid_at<?');args.push(midnightUtc(next.toISOString().slice(0,10)));}
 const rows=(await env.DB.prepare("SELECT s.id AS store_id,s.code,s.name,COUNT(DISTINCT o.id) AS paid_orders,COALESCE(SUM(p.amount_cents),0) AS revenue_cents FROM stores s LEFT JOIN orders o ON o.store_id=s.id AND "+conditions.join(' AND ')+" LEFT JOIN payments p ON p.order_id=o.id AND p.store_id=s.id WHERE "+(includeTest?'1=1':"s.code!='TEST'")+" GROUP BY s.id,s.code,s.name ORDER BY s.code").bind(...args).all()).results;
 return json({stores:rows,include_test:includeTest,from:from||null,to:to||null,timezone:'Europe/Warsaw'});
}
// V3 admin-only store detail. Does not grant access to POS/KDS store routing.
// V3 device enrollment foundation: admin-only; credentials are stored hashed.
// Device credentials do not authorize any POS/KDS endpoint until the
// store-scoped session and authorization rollout is complete.
if(path==='/api/admin/devices'&&req.method==='GET'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const devices=(await env.DB.prepare("SELECT d.id,d.store_id,s.code AS store_code,s.name AS store_name,d.label,d.active,d.created_at,d.revoked_at FROM pos_devices d JOIN stores s ON s.id=d.store_id ORDER BY d.created_at DESC LIMIT 200").all()).results;
 return json({devices,device_auth_enabled:false});
}
if(path==='/api/admin/devices'&&req.method==='POST'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const b=await parse(req);
 if(!b||typeof b.store_id!=='string'||typeof b.label!=='string'||!b.label.trim()||b.label.length>100)return json({error:'Invalid device registration'},400);
 const store=await env.DB.prepare('SELECT id,code,name,active FROM stores WHERE id=?').bind(b.store_id).first();
 if(!store||!store.active)return json({error:'Active store not found'},404);
 const deviceId=uid(),credential=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
 const digest=await crypto.subtle.digest('SHA-256',encoder.encode(credential));
 const tokenHash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
 await env.DB.prepare('INSERT INTO pos_devices(id,store_id,label,token_hash,active,created_at) VALUES(?,?,?,?,1,?)').bind(deviceId,store.id,b.label.trim(),tokenHash,new Date().toISOString()).run();
 return json({id:deviceId,store_id:store.id,label:b.label.trim(),enrollment_secret:credential,device_auth_enabled:false},201);
}
const revokeDeviceMatch=path.match(/^\/api\/admin\/devices\/([0-9a-f-]{36})\/revoke$/);
if(revokeDeviceMatch&&req.method==='POST'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const result=await env.DB.prepare("UPDATE pos_devices SET active=0,revoked_at=? WHERE id=? AND active=1").bind(new Date().toISOString(),revokeDeviceMatch[1]).run();
 if(!result.meta.changes)return json({error:'Active device not found'},404);
 return json({ok:true});
}
const storeDetailMatch=path.match(/^\/api\/admin\/stores\/([^/]+)\/orders$/);
if(storeDetailMatch&&req.method==='GET'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const storeId=decodeURIComponent(storeDetailMatch[1]);
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(storeId))return json({error:'Invalid store ID'},400);
 const store=await env.DB.prepare('SELECT id,code,name,active FROM stores WHERE id=?').bind(storeId).first();
 if(!store)return json({error:'Store not found'},404);
 const limit=50;
 const rows=(await env.DB.prepare('SELECT id,source,table_no,status,created_at,paid_at,kitchen_completed_at FROM orders WHERE store_id=? ORDER BY created_at DESC,id DESC LIMIT ?').bind(storeId,limit).all()).results;
 return json({store,orders:rows,limit});
}
if(path==='/ws'){if(req.headers.get('upgrade')!=='websocket')return json({error:'WebSocket required'},426);return room(env).fetch(new Request('https://room.internal/ws',{headers:{upgrade:'websocket','x-room-secret':env.AUTH_SECRET,'x-client-role':role,'sec-websocket-protocol':req.headers.get('sec-websocket-protocol')||''}}));}
// Modifier configuration endpoints. Existing Phase 2 foundation tables are reused.
if(path==='/api/menu/modifiers'&&req.method==='GET'){
 if(!allowed(role,'pos'))return json({error:'Forbidden'},403);
 const [groups,options,links]=await Promise.all([env.DB.prepare('SELECT id,name,min_select,max_select FROM modifier_groups WHERE active=1').all(),env.DB.prepare('SELECT id,group_id,name,price_cents FROM modifier_options WHERE active=1').all(),env.DB.prepare('SELECT menu_id,group_id FROM menu_modifier_groups').all()]);
 return json({groups:groups.results,options:options.results,links:links.results});
}
if(path==='/api/modifiers'&&req.method==='GET'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const [groups,options,links]=await Promise.all([
  env.DB.prepare('SELECT * FROM modifier_groups ORDER BY name').all(),
  env.DB.prepare('SELECT * FROM modifier_options ORDER BY name').all(),
  env.DB.prepare('SELECT * FROM menu_modifier_groups').all()
 ]);
 return json({groups:groups.results,options:options.results,links:links.results});
}
if(path==='/api/modifiers/assign'&&req.method==='PUT'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const b=await parse(req);
 if(!b||typeof b.group_id!=='string'||!Array.isArray(b.menu_ids)||b.menu_ids.length>2000||b.menu_ids.some(id=>typeof id!=='string')||new Set(b.menu_ids).size!==b.menu_ids.length)return json({error:'Invalid assignment'},400);
 const group=await env.DB.prepare('SELECT id FROM modifier_groups WHERE id=?').bind(b.group_id).first();
 if(!group)return json({error:'Modifier group not found'},404);
 const menuRows=(await env.DB.prepare('SELECT id FROM menu').all()).results;
 const valid=new Set(menuRows.map(m=>m.id));
 if(b.menu_ids.some(id=>!valid.has(id)))return json({error:'Unknown dish'},400);
 const selected=new Set(b.menu_ids);
 const existing=(await env.DB.prepare('SELECT menu_id FROM menu_modifier_groups WHERE group_id=?').bind(b.group_id).all()).results.map(x=>x.menu_id);
 const statements=[];
 for(const id of existing)if(!selected.has(id))statements.push(env.DB.prepare('DELETE FROM menu_modifier_groups WHERE group_id=? AND menu_id=?').bind(b.group_id,id));
 const already=new Set(existing);
 for(const id of b.menu_ids)if(!already.has(id))statements.push(env.DB.prepare('INSERT INTO menu_modifier_groups(menu_id,group_id) VALUES(?,?)').bind(id,b.group_id));
 if(statements.length)await env.DB.batch(statements);
 await broadcast(env,'menu',{});
 return json({ok:true,assigned:b.menu_ids.length,changed:statements.length});
}
if(path==='/api/modifiers/groups'&&req.method==='POST'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const b=await parse(req),name=String(b?.name||'').trim(),min=b?.min_select,max=b?.max_select;
 if(!name||name.length>100||!Number.isInteger(min)||!Number.isInteger(max)||min<0||max<1||min>max||max>20)return json({error:'Invalid modifier group'},400);
 const id=uid();await env.DB.prepare('INSERT INTO modifier_groups(id,name,required,min_select,max_select,active) VALUES(?,?,?,?,?,1)').bind(id,name,min>0?1:0,min,max).run();
 await broadcast(env,'menu',{});return json({id},201);
}
const modifierGroupMatch=path.match(/^\/api\/modifiers\/groups\/([^/]+)$/);
if(modifierGroupMatch&&req.method==='PATCH'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const b=await parse(req),name=String(b?.name||'').trim(),min=b?.min_select,max=b?.max_select;
 if(!name||name.length>100||!Number.isInteger(min)||!Number.isInteger(max)||min<0||max<1||min>max||max>20||![0,1].includes(b?.active))return json({error:'Invalid modifier group'},400);
 const result=await env.DB.prepare('UPDATE modifier_groups SET name=?,required=?,min_select=?,max_select=?,active=? WHERE id=?').bind(name,min>0?1:0,min,max,b.active,modifierGroupMatch[1]).run();
 if(!result.meta.changes)return json({error:'Group not found'},404);
 await broadcast(env,'menu',{});return json({ok:true});
}
if(path==='/api/modifiers/options'&&req.method==='POST'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const b=await parse(req),name=String(b?.name||'').trim();
 if(!name||name.length>100||typeof b?.group_id!=='string'||!Number.isInteger(b?.price_cents)||b.price_cents<0||b.price_cents>1000000)return json({error:'Invalid modifier option'},400);
 const group=await env.DB.prepare('SELECT id FROM modifier_groups WHERE id=?').bind(b.group_id).first();
 if(!group)return json({error:'Group not found'},404);
 const id=uid();await env.DB.prepare('INSERT INTO modifier_options(id,group_id,name,price_cents,active) VALUES(?,?,?,?,1)').bind(id,b.group_id,name,b.price_cents).run();
 await broadcast(env,'menu',{});return json({id},201);
}
const modifierOptionMatch=path.match(/^\/api\/modifiers\/options\/([^/]+)$/);
if(modifierOptionMatch&&req.method==='PATCH'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const b=await parse(req),name=String(b?.name||'').trim();
 if(!name||name.length>100||!Number.isInteger(b?.price_cents)||b.price_cents<0||b.price_cents>1000000||![0,1].includes(b?.active))return json({error:'Invalid modifier option'},400);
 const result=await env.DB.prepare('UPDATE modifier_options SET name=?,price_cents=?,active=? WHERE id=?').bind(name,b.price_cents,b.active,modifierOptionMatch[1]).run();
 if(!result.meta.changes)return json({error:'Option not found'},404);
 await broadcast(env,'menu',{});return json({ok:true});
}
const modifierLinkMatch=path.match(/^\/api\/menu\/([^/]+)\/modifiers$/);
if(modifierLinkMatch&&req.method==='PUT'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const b=await parse(req);
 if(!Array.isArray(b?.group_ids)||b.group_ids.length>30||b.group_ids.some(id=>typeof id!=='string')||new Set(b.group_ids).size!==b.group_ids.length)return json({error:'Invalid group selection'},400);
 const dish=await env.DB.prepare('SELECT id FROM menu WHERE id=?').bind(modifierLinkMatch[1]).first();
 if(!dish)return json({error:'Dish not found'},404);
 if(b.group_ids.length){
  const matches=await env.DB.prepare('SELECT id FROM modifier_groups WHERE id IN ('+b.group_ids.map(()=>'?').join(',')+')').bind(...b.group_ids).all();
  if(matches.results.length!==b.group_ids.length)return json({error:'Unknown modifier group'},400);
 }
 await env.DB.batch([env.DB.prepare('DELETE FROM menu_modifier_groups WHERE menu_id=?').bind(dish.id),...b.group_ids.map(id=>env.DB.prepare('INSERT INTO menu_modifier_groups(menu_id,group_id) VALUES(?,?)').bind(dish.id,id))]);
 await broadcast(env,'menu',{});return json({ok:true});
}
if(path==='/api/categories'&&req.method==='GET'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 return json((await env.DB.prepare('SELECT c.*, (SELECT COUNT(*) FROM menu m WHERE m.category=c.name) item_count FROM menu_categories c ORDER BY c.sort_order,c.name').all()).results);
}
if(path==='/api/categories'&&req.method==='POST'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const b=await parse(req),name=String(b?.name||'').trim();
 if(!name||name.length>50||!Number.isInteger(b?.sort_order)||Math.abs(b.sort_order)>100000)return json({error:'Invalid category'},400);
 try{const id=uid();await env.DB.prepare('INSERT INTO menu_categories(id,name,sort_order) VALUES(?,?,?)').bind(id,name,b.sort_order).run();await broadcast(env,'menu',{});return json({id},201);}
 catch(e){if(String(e).includes('UNIQUE'))return json({error:'Category already exists'},409);throw e;}
}
const catMatch=path.match(/^\/api\/categories\/([^/]+)$/);
if(catMatch&&req.method==='PATCH'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const b=await parse(req),name=String(b?.name||'').trim();
 if(!name||name.length>50||!Number.isInteger(b?.sort_order)||Math.abs(b.sort_order)>100000)return json({error:'Invalid category'},400);
 const old=await env.DB.prepare('SELECT * FROM menu_categories WHERE id=?').bind(catMatch[1]).first();
 if(!old)return json({error:'Category not found'},404);
 try{
  await env.DB.batch([
   env.DB.prepare('UPDATE menu_categories SET name=?,sort_order=? WHERE id=?').bind(name,b.sort_order,catMatch[1]),
   env.DB.prepare('UPDATE menu SET category=? WHERE category=?').bind(name,old.name)
  ]);
 }catch(e){if(String(e).includes('UNIQUE'))return json({error:'Category already exists'},409);throw e;}
 await broadcast(env,'menu',{});return json({ok:true});
}
if(catMatch&&req.method==='DELETE'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const old=await env.DB.prepare('SELECT name FROM menu_categories WHERE id=?').bind(catMatch[1]).first();
 if(!old)return json({error:'Category not found'},404);
 const used=await env.DB.prepare('SELECT COUNT(*) n FROM menu WHERE category=?').bind(old.name).first();
 if(used.n)return json({error:'Move or remove dishes in this category first'},409);
 await env.DB.prepare('DELETE FROM menu_categories WHERE id=?').bind(catMatch[1]).run();await broadcast(env,'menu',{});return json({ok:true});
}
if(path==='/api/menu/all'&&req.method==='GET'){if(!allowed(role,'admin'))return json({error:'Forbidden'},403);return json((await env.DB.prepare('SELECT * FROM menu ORDER BY sort_order,category,name').all()).results);}
if(path==='/api/menu/images'&&req.method==='POST'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 if(!env.MENU_IMAGES)return json({error:'R2 storage not configured'},503);
 const length=Number(req.headers.get('content-length')||0);
 if(length>5*1024*1024)return json({error:'Image exceeds 5 MB'},413);
 const contentType=(req.headers.get('content-type')||'').split(';')[0].toLowerCase();
 if(contentType!=='image/webp')return json({error:'Only converted WebP images are accepted'},415);
 const bytes=new Uint8Array(await req.arrayBuffer());
 if(!bytes.length||bytes.length>5*1024*1024)return json({error:'Image must be 5 MB or less'},413);
 const webp=bytes.length>12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
 if(!webp)return json({error:'Invalid WebP content'},415);
 const key=uid()+'.webp';await env.MENU_IMAGES.put(key,bytes,{httpMetadata:{contentType}});
 return json({image_url:'/images/'+key},201);
}
const menuMatch=path.match(/^\/api\/menu\/([^/]+)$/);
if(menuMatch&&req.method==='DELETE'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const dish=await env.DB.prepare('SELECT id FROM menu WHERE id=?').bind(menuMatch[1]).first();
 if(!dish)return json({error:'Dish not found'},404);
 const references=await env.DB.prepare('SELECT (SELECT COUNT(*) FROM order_items WHERE menu_id=?) + (SELECT COUNT(*) FROM menu_modifier_groups WHERE menu_id=?) AS n').bind(dish.id,dish.id).first();
 if(references.n){
  await env.DB.prepare('UPDATE menu SET active=0 WHERE id=?').bind(dish.id).run();
  await broadcast(env,'menu',{});
  return json({ok:true,archived:true,message:'Dish archived to preserve historical order references'});
 }
 await env.DB.prepare('DELETE FROM menu WHERE id=?').bind(dish.id).run();
 await broadcast(env,'menu',{});
 return json({ok:true,deleted:true});
}
if(menuMatch&&req.method==='PATCH'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const b=await parse(req);
 if(!b||typeof b.name!=='string'||!b.name.trim()||typeof b.category!=='string'||!b.category.trim()||!Number.isInteger(b.price_cents)||b.price_cents<0||b.price_cents>10000000||![0,5,8,23].includes(b.vat_rate)||![0,1,false,true].includes(b.active)||!Number.isInteger(b.sort_order)||Math.abs(b.sort_order)>100000)return json({error:'Invalid menu item'},400);
 const image=String(b.image_url||'');
 if(image.length>1000||image&&!(/^\/images\/[0-9a-f-]{36}\.(webp|png|jpg)$/.test(image)||/^https:\/\//i.test(image)))return json({error:'Invalid image URL'},400);
 const result=await env.DB.prepare('UPDATE menu SET name=?,category=?,price_cents=?,vat_rate=?,image_url=?,sort_order=?,active=? WHERE id=?').bind(b.name.trim().slice(0,100),b.category.trim().slice(0,50),b.price_cents,b.vat_rate,image,b.sort_order,Number(b.active),menuMatch[1]).run();
 if(!result.meta.changes)return json({error:'Menu item not found'},404);
 await broadcast(env,'menu',{});return json({ok:true});
}
if(path==='/api/menu'&&req.method==='GET')return json((await env.DB.prepare('SELECT * FROM menu WHERE active=1 ORDER BY sort_order,category,name').all()).results);
if(path==='/api/menu'&&req.method==='POST'){if(!allowed(role,'admin'))return json({error:'Forbidden'},403);const b=await parse(req);if(!b||typeof b.name!=='string'||!b.name.trim()||typeof b.category!=='string'||!Number.isInteger(b.price_cents)||b.price_cents<0)return json({error:'Invalid menu item'},400);const id=uid();await env.DB.prepare('INSERT INTO menu(id,name,category,price_cents,sort_order,image_url,vat_rate) VALUES(?,?,?,?,?,?,?)').bind(id,b.name.trim().slice(0,100),b.category.slice(0,50),b.price_cents,Number(b.sort_order)||0,String(b.image_url||'').slice(0,1000),[0,5,8,23].includes(Number(b.vat_rate))?Number(b.vat_rate):8).run();await broadcast(env,'menu',{});return json({id},201);}
if(path==='/api/orders'&&req.method==='GET'){
 const list=await getOrders(env);
 if(!allowed(role,'pos'))return json(list);
 const occupied=(await env.DB.prepare('SELECT order_id FROM table_occupancy').all()).results;
 const set=new Set(occupied.map(x=>x.order_id)),ids=list.map(x=>x.id);
 const payments=ids.length?(await env.DB.prepare('SELECT order_id,method,amount_cents,created_at FROM payments WHERE order_id IN ('+ids.map(()=>'?').join(',')+') ORDER BY created_at DESC').bind(...ids).all()).results:[];
 return json(list.map(o=>({...o,table_occupied:set.has(o.id),payment:payments.find(p=>p.order_id===o.id)||null})));
}
if(path==='/api/kitchen/categories'&&req.method==='GET'){
 if(!allowed(role,'kitchen'))return json({error:'Forbidden'},403);
 return json((await env.DB.prepare('SELECT name,sort_order FROM menu_categories ORDER BY sort_order,name').all()).results);
}
if(path==='/api/kitchen/history'&&req.method==='GET'){
 if(!allowed(role,'kitchen'))return json({error:'Forbidden'},403);
 const u=new URL(req.url),range=u.searchParams.get('range')||'today',query=(u.searchParams.get('q')||'').trim().slice(0,80),page=Math.max(1,Math.min(10000,Number.parseInt(u.searchParams.get('page')||'1',10)||1)),size=15;
 if(!['today','yesterday','all'].includes(range))return json({error:'Invalid range'},400);
 const now=new Date(),warsawDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const dayOffset=range==='yesterday'?-1:0;
 const localDay=new Date(warsawDate+'T12:00:00Z');localDay.setUTCDate(localDay.getUTCDate()+dayOffset);
 const day=localDay.toISOString().slice(0,10);
 const dateClause=range==='all'?'':" AND date(kitchen_completed_at, '+1 hour')= ?"; 
 // Date filtering uses the actual Warsaw calendar boundaries, including DST.
 const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'});
 const matchDate=range==='all'?null:day;
 const searchClause=query?" AND (table_no LIKE ? OR id LIKE ?)":"";
 const where="kitchen_completed_at IS NOT NULL AND status!='cancelled'"+searchClause;
 const args=query?['%'+query+'%','%'+query+'%']:[];
 // Fetch a bounded recent window and filter Warsaw dates in JS to avoid fixed-offset DST errors.
 const scanLimit=range==='all'?500:1500;
 const rows=(await env.DB.prepare('SELECT id,source,table_no,created_at,kitchen_completed_at,paid_at FROM orders WHERE '+where+' ORDER BY kitchen_completed_at DESC LIMIT ?').bind(...args,scanLimit).all()).results;
 const filtered=matchDate?rows.filter(o=>fmt.format(new Date(o.kitchen_completed_at))===matchDate):rows;
 const total=filtered.length,selected=filtered.slice((page-1)*size,page*size);
 const ids=selected.map(o=>o.id);
 const items=ids.length?(await env.DB.prepare('SELECT id,order_id,name,quantity,is_done FROM order_items WHERE order_id IN ('+ids.map(()=>'?').join(',')+') ORDER BY created_at').bind(...ids).all()).results:[];
 return json({page,size,total,has_more:page*size<total,limited:rows.length===scanLimit,orders:selected.map(o=>({...o,items:items.filter(i=>i.order_id===o.id)}))});
}
const kitchenCompleteMatch=path.match(/^\/api\/kitchen\/orders\/([^/]+)\/(complete|reopen)$/);
if(kitchenCompleteMatch&&req.method==='POST'){
 if(!allowed(role,'kitchen'))return json({error:'Forbidden'},403);
 const [_,id,action]=kitchenCompleteMatch;
 const order=await env.DB.prepare('SELECT id,status,kitchen_completed_at FROM orders WHERE id=?').bind(id).first();
 if(!order)return json({error:'Order not found'},404);
 if(order.status==='cancelled')return json({error:'Cancelled order'},409);
 const now=new Date().toISOString();
 if(action==='complete'){
  if(order.kitchen_completed_at)return json({ok:true,already_completed:true});
  const result=await env.DB.prepare("UPDATE orders SET kitchen_completed_at=?,updated_at=? WHERE id=? AND kitchen_completed_at IS NULL AND status!='cancelled' AND EXISTS(SELECT 1 FROM order_items WHERE order_id=?) AND NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=? AND is_done=0)").bind(now,now,id,id,id).run();
  if(result.meta.changes!==1)return json({error:'All dishes must be done before completing this order'},409);
 }else{
  if(!order.kitchen_completed_at)return json({ok:true,already_open:true});
  const result=await env.DB.prepare("UPDATE orders SET kitchen_completed_at=NULL,updated_at=? WHERE id=? AND kitchen_completed_at IS NOT NULL AND status!='cancelled'").bind(now,id).run();
  if(result.meta.changes!==1)return json({error:'Order changed; refresh'},409);
 }
 await event(env,id,action==='complete'?'kitchen_completed':'kitchen_reopened',role,{});
 await broadcast(env,'orders',{id});
 return json({ok:true});
}

if(path==='/api/tables'&&req.method==='GET'){
 if(!allowed(role,'pos'))return json({error:'Forbidden'},403);
 const active=(await env.DB.prepare("SELECT id,table_no,status,created_at FROM orders WHERE source='dinein' AND id IN (SELECT order_id FROM table_occupancy) AND status!='cancelled' AND table_no IN ("+Array.from({length:20},(_,i)=>"'"+String(i+1).padStart(2,'0')+"'").join(',')+") ORDER BY created_at DESC").all()).results;
 return json(Array.from({length:20},(_,i)=>{const number=String(i+1).padStart(2,'0'),matches=active.filter(o=>o.table_no===number);return {number,occupied:matches.length>0,order_id:matches[0]?.id||null,conflict:matches.length>1,status:matches[0]?.status||null}}));
}
const releaseMatch=path.match(/^\/api\/orders\/([^/]+)\/release-table$/);
if(releaseMatch&&req.method==='POST'){
 if(!allowed(role,'pos'))return json({error:'Forbidden'},403);
 const id=releaseMatch[1],order=await env.DB.prepare('SELECT id,source,table_no FROM orders WHERE id=?').bind(id).first();
 if(!order||order.source!=='dinein')return json({error:'Dine-in order not found'},404);
 const result=await env.DB.prepare('DELETE FROM table_occupancy WHERE order_id=?').bind(id).run();
 if(!result.meta.changes)return json({error:'Table already released'},409);
 await event(env,id,'table_released',role,{table_no:order.table_no});
 await broadcast(env,'orders',{id});return json({ok:true});
}
const posDetailMatch=path.match(/^\/api\/pos\/history\/([^/]+)$/);
if(posDetailMatch&&req.method==='GET'){
 if(!allowed(role,'pos'))return json({error:'Forbidden'},403);
 const id=decodeURIComponent(posDetailMatch[1]);
 const order=await env.DB.prepare('SELECT id,source,table_no,status,note,created_at,paid_at,kitchen_completed_at FROM orders WHERE id=? AND paid_at IS NOT NULL').bind(id).first();
 if(!order)return json({error:'Paid order not found'},404);
 const [itemsResult,paymentsResult,eventsResult,occupancy]=await Promise.all([
  env.DB.prepare('SELECT id,name,quantity,note,price_cents,is_done,created_at FROM order_items WHERE order_id=? ORDER BY created_at,id').bind(id).all(),
  env.DB.prepare('SELECT id,method,amount_cents,created_at FROM payments WHERE order_id=? ORDER BY created_at').bind(id).all(),
  env.DB.prepare('SELECT event,actor,detail,created_at FROM events WHERE order_id=? ORDER BY created_at').bind(id).all(),
  env.DB.prepare('SELECT table_no FROM table_occupancy WHERE order_id=?').bind(id).first()
 ]);
 const items=itemsResult.results;
 const ids=items.map(i=>i.id);
 const modifiers=ids.length?(await env.DB.prepare('SELECT order_item_id,name,price_cents FROM order_item_modifiers WHERE order_item_id IN ('+ids.map(()=>'?').join(',')+')').bind(...ids).all()).results:[];
 return json({order:{...order,table_occupied:!!occupancy},items:items.map(i=>({...i,modifiers:modifiers.filter(m=>m.order_item_id===i.id)})),payments:paymentsResult.results,events:eventsResult.results});
}
if(path==='/api/pos/history'&&req.method==='GET'){
 if(!allowed(role,'pos'))return json({error:'Forbidden'},403);
 const u=new URL(req.url),range=u.searchParams.get('range')||'today',method=u.searchParams.get('method')||'all',q=(u.searchParams.get('q')||'').trim().slice(0,80);
 const page=Math.max(1,Math.min(100000,Number.parseInt(u.searchParams.get('page')||'1',10)||1)),size=15;
 if(!['today','yesterday','custom','all'].includes(range)||!['all','cash','card','other'].includes(method))return json({error:'Invalid filters'},400);
 const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
 const dateFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'});
 const warsawDay=d=>{const parts=Object.fromEntries(dateFmt.formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return parts.year+'-'+parts.month+'-'+parts.day};
 const shiftDay=(day,days)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
 // Convert a Warsaw midnight to UTC using the timezone's actual offset (including DST).
 const midnightUtc=day=>{
  const target=Date.parse(day+'T00:00:00Z');
  const partsFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Warsaw',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  let t=target;
  for(let i=0;i<3;i++){
   const p=Object.fromEntries(partsFmt.formatToParts(new Date(t)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
   const local=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
   t+=target-local;
  }
  return new Date(t).toISOString();
 };
 let from=null,to=null;
 if(range!=='all'){
  const today=warsawDay(new Date());
  from=range==='custom'?u.searchParams.get('from'):range==='today'?today:shiftDay(today,-1);
  to=range==='custom'?u.searchParams.get('to'):from;
  if(!validDate(from)||!validDate(to)||from>to)return json({error:'Invalid date range'},400);
 }
 const filters=["o.paid_at IS NOT NULL"],params=[];
 if(from){filters.push('o.paid_at >= ? AND o.paid_at < ?');params.push(midnightUtc(from),midnightUtc(shiftDay(to,1)))}
 if(q){filters.push('(o.id LIKE ? OR o.table_no LIKE ?)');params.push('%'+q+'%','%'+q+'%')}
 if(method!=='all'){filters.push('p.method=?');params.push(method)}
 const joined=" FROM orders o LEFT JOIN payments p ON p.id=(SELECT p2.id FROM payments p2 WHERE p2.order_id=o.id ORDER BY p2.created_at DESC,p2.id DESC LIMIT 1) WHERE "+filters.join(' AND ');
 const summary=(await env.DB.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(p.amount_cents),0) AS total_cents,COALESCE(SUM(CASE WHEN p.method='cash' THEN p.amount_cents ELSE 0 END),0) AS cash_cents,COALESCE(SUM(CASE WHEN p.method='card' THEN p.amount_cents ELSE 0 END),0) AS card_cents,COALESCE(SUM(CASE WHEN p.method='other' THEN p.amount_cents ELSE 0 END),0) AS other_cents"+joined).bind(...params).first());
 const orders=(await env.DB.prepare("SELECT o.id,o.source,o.table_no,o.paid_at,o.kitchen_completed_at,p.method,p.amount_cents"+joined+" ORDER BY o.paid_at DESC,o.id DESC LIMIT ? OFFSET ?").bind(...params,size,(page-1)*size).all()).results;
 return json({orders,total:Number(summary.total),page,size,summary:{total_cents:Number(summary.total_cents),cash_cents:Number(summary.cash_cents),card_cents:Number(summary.card_cents),other_cents:Number(summary.other_cents)},filters:{range,method,from,to}});
}
const checkoutMatch=path.match(/^\/api\/orders\/([^/]+)\/checkout$/);
if(checkoutMatch&&req.method==='POST'){
 if(!allowed(role,'pos'))return json({error:'Forbidden'},403);
 const b=await parse(req);
 if(!['cash','card','other'].includes(b?.method))return json({error:'Invalid payment method'},400);
 const id=checkoutMatch[1],order=await env.DB.prepare('SELECT id,source,status,paid_at FROM orders WHERE id=?').bind(id).first();
 if(!order)return json({error:'Ticket not found'},404);
 if(order.paid_at)return json({error:'Ticket already paid'},409);
 if(order.status==='cancelled')return json({error:'Cancelled ticket cannot be paid'},409);
 const amount=await env.DB.prepare('SELECT COALESCE(SUM(quantity*COALESCE(price_cents,0)),0) AS total FROM order_items WHERE order_id=?').bind(id).first();
 const unpriced=await env.DB.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id=? AND price_cents IS NULL').bind(id).first();
 if(unpriced.n)return json({error:'Legacy ticket has unpriced items; cannot safely checkout'},409);
 const total=Number(amount.total);
 if(!Number.isSafeInteger(total)||total<0)return json({error:'Invalid ticket amount'},409);
 const now=new Date().toISOString(),paymentId=uid();
 const statements=[
  env.DB.prepare('INSERT INTO payments(id,order_id,method,amount_cents,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND paid_at IS NULL AND status!=\'cancelled\')').bind(paymentId,id,b.method,total,now,id),
  env.DB.prepare("UPDATE orders SET paid_at=?,updated_at=? WHERE id=? AND paid_at IS NULL AND status!='cancelled'").bind(now,now,id),
  env.DB.prepare('INSERT INTO events(id,order_id,event,actor,detail,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),id,'paid',role,JSON.stringify({method:b.method,amount_cents:total}),now)
 ];
 const result=await env.DB.batch(statements);
 if(result[1].meta.changes!==1)return json({error:'Ticket already closed; refresh'},409);
 await broadcast(env,'orders',{id});return json({ok:true,amount_cents:total,paid_at:now});
}

if(path==='/api/orders'&&req.method==='POST'){if(!allowed(role,'pos'))return json({error:'Forbidden'},403);const b=await parse(req);if(!b||!Array.isArray(b.items)||!b.items.length||b.items.length>100||typeof b.client_key!=='string'||b.client_key.length<16||!['dinein','takeaway','delivery'].includes(b.source))return json({error:'Invalid order'},400);const existing=await env.DB.prepare('SELECT id FROM orders WHERE client_key=?').bind(b.client_key).first();if(existing)return json({id:existing.id,duplicate:true});const ids=b.items.map(x=>x.menu_id);if(ids.some(x=>typeof x!=='string'))return json({error:'Invalid menu IDs'},400);const unique=[...new Set(ids)];const rows=(await env.DB.prepare(`SELECT * FROM menu WHERE active=1 AND id IN (${unique.map(()=>'?').join(',')})`).bind(...unique).all()).results;const lookup=new Map(rows.map(x=>[x.id,x]));if(unique.some(id=>!lookup.has(id))||b.items.some(x=>!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>99))return json({error:'Invalid items'},400);if(b.source==='dinein'){
 if(!/^(0[1-9]|1[0-9]|20)$/.test(String(b.table_no||'')))return json({error:'Choose a table from 01 to 20'},400);
 const occupied=await env.DB.prepare("SELECT id FROM orders WHERE source='dinein' AND table_no=? AND paid_at IS NULL AND status!='cancelled' LIMIT 1").bind(b.table_no).first();
 if(occupied)return json({error:'Table already has an open ticket',order_id:occupied.id},409);
}
const id=uid(),now=new Date().toISOString();const statements=[env.DB.prepare('INSERT INTO orders(id,source,table_no,status,note,created_at,updated_at,created_by,client_key) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,b.source,String(b.table_no||'').slice(0,30),'new',String(b.note||'').slice(0,500),now,now,role,b.client_key)];if(b.source==='dinein')statements.push(env.DB.prepare('INSERT INTO table_occupancy(table_no,order_id,created_at) VALUES(?,?,?)').bind(b.table_no,id,now));try{statements.push(...await prepareOrderItems(env,b.items,id,now));}catch(e){return json({error:e.message},400);}statements.push(env.DB.prepare('INSERT INTO events(id,order_id,event,actor,detail,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),id,'created',role,'{}',now));statements.push(env.DB.prepare('INSERT INTO sync_outbox(id,order_id,event,payload,created_at) VALUES(?,?,?,?,?)').bind(uid(),id,'created','{}',now));try{await env.DB.batch(statements);}catch(e){console.error('ORDER_CREATE_D1_ERROR:',e?.message,e?.stack);const dup=await env.DB.prepare('SELECT id FROM orders WHERE client_key=?').bind(b.client_key).first();if(dup)return json({id:dup.id,duplicate:true});if(b.source==='dinein'&&String(e).includes('UNIQUE'))return json({error:'Table already occupied; refresh'},409);throw e;}await broadcast(env,'orders',{id});return json({id},201);}
if(path==='/api/pos/pickups'&&req.method==='GET'){
 if(!allowed(role,'pos'))return json({error:'Forbidden'},403);
 const rows=(await env.DB.prepare("SELECT oi.id AS item_id,oi.order_id,oi.name,oi.quantity,oi.done_at,o.table_no,o.source FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.is_done=1 AND oi.picked_up_at IS NULL AND o.status!='cancelled' ORDER BY oi.done_at ASC LIMIT 200").all()).results;
 return json({items:rows});
}
const pickupAllMatch=path.match(/^\/api\/pos\/pickups\/orders\/([^/]+)\/ack-all$/);
if(pickupAllMatch&&req.method==='POST'){
 if(!allowed(role,'pos'))return json({error:'Forbidden'},403);
 const id=pickupAllMatch[1],now=new Date().toISOString();
 const result=await env.DB.prepare("UPDATE order_items SET picked_up_at=? WHERE order_id=? AND is_done=1 AND picked_up_at IS NULL AND EXISTS (SELECT 1 FROM orders WHERE id=? AND status!='cancelled')").bind(now,id,id).run();
 if(result.meta.changes)await broadcast(env,'pickup',{order_id:id,acknowledged:result.meta.changes});
 return json({ok:true,count:result.meta.changes||0});
}
const pickupMatch=path.match(/^\/api\/pos\/pickups\/([^/]+)\/ack$/);
if(pickupMatch&&req.method==='POST'){
 if(!allowed(role,'pos'))return json({error:'Forbidden'},403);
 const now=new Date().toISOString();
 const result=await env.DB.prepare("UPDATE order_items SET picked_up_at=? WHERE id=? AND is_done=1 AND picked_up_at IS NULL AND order_id IN (SELECT id FROM orders WHERE status!='cancelled')").bind(now,pickupMatch[1]).run();
 if(!result.meta.changes)return json({error:'Dish is already picked up or no longer ready'},409);
 await broadcast(env,'pickup',{item_id:pickupMatch[1]});
 return json({ok:true});
}
const itemMatch=path.match(/^\/api\/order-items\/([^/]+)\/done$/);
if(itemMatch&&req.method==='PATCH'){
 if(!allowed(role,'kitchen'))return json({error:'Forbidden'},403);
   const item=await env.DB.prepare('SELECT oi.id,oi.order_id,o.status,o.paid_at,o.kitchen_completed_at FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.id=?').bind(itemMatch[1]).first();
  if(!item)return json({error:'Item not found'},404);
  if(item.status==='cancelled')return json({error:'Cancelled order'},409);if(item.kitchen_completed_at)return json({error:'Reopen the completed order first'},409);
  const now=new Date().toISOString();
  const updated=await env.DB.prepare('UPDATE order_items SET is_done=CASE WHEN is_done=1 THEN 0 ELSE 1 END,done_at=CASE WHEN is_done=1 THEN NULL ELSE ? END,picked_up_at=NULL WHERE id=? RETURNING is_done').bind(now,item.id).first();
  if(!updated)return json({error:'Item not found'},404);
  const next=updated.is_done;
  await env.DB.prepare('INSERT INTO events(id,order_id,event,actor,detail,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),item.order_id,next?'item_done':'item_undone',role,JSON.stringify({item_id:item.id}),now).run();
  const summary=await env.DB.prepare('SELECT COUNT(*) total,SUM(CASE WHEN is_done=1 THEN 1 ELSE 0 END) done FROM order_items WHERE order_id=?').bind(item.order_id).first();
  const newStatus=summary.total===summary.done?'done':'new';
  await env.DB.prepare("UPDATE orders SET status=?,updated_at=? WHERE id=? AND status!='cancelled'").bind(newStatus,now,item.order_id).run();
  await broadcast(env,'orders',{id:item.order_id,item_id:item.id});await broadcast(env,'pickup',{item_id:item.id,ready:!!next});return json({ok:true,is_done:next,order_status:newStatus});
}
const statusMatch=path.match(/^\/api\/orders\/([^/]+)\/status$/);
if(statusMatch&&req.method==='PATCH'){if(!allowed(role,'kitchen'))return json({error:'Forbidden'},403);const b=await parse(req);if(!b||!['cooking','done','cancelled'].includes(b.status))return json({error:'Invalid status'},400);if(b.status==='cancelled'&&role!=='admin')return json({error:'Admin only'},403);const id=statusMatch[1],old=await env.DB.prepare('SELECT status,paid_at FROM orders WHERE id=?').bind(id).first();if(!old)return json({error:'Not found'},404);if(old.paid_at&&b.status==='cancelled')return json({error:'Paid ticket cannot be cancelled'},409);if(old.status===b.status)return json({ok:true});const transitions={new:['cooking','cancelled'],cooking:['done','cancelled'],done:[],cancelled:[]};if(!transitions[old.status]?.includes(b.status))return json({error:'Invalid transition'},409);const now=new Date().toISOString();const result=await env.DB.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=? AND status=?').bind(b.status,now,id,old.status).run();if(result.meta.changes!==1)return json({error:'Order changed, refresh'},409);if(b.status==='cancelled')await env.DB.prepare('DELETE FROM table_occupancy WHERE order_id=?').bind(id).run();await event(env,id,'status',role,{from:old.status,to:b.status});await broadcast(env,'orders',{id});return json({ok:true});}
const addMatch=path.match(/^\/api\/orders\/([^/]+)\/items$/);
if(addMatch&&req.method==='POST'){if(!allowed(role,'pos'))return json({error:'Forbidden'},403);const b=await parse(req);if(!b||!Array.isArray(b.items)||!b.items.length||b.items.length>30)return json({error:'Invalid items'},400);const o=await env.DB.prepare('SELECT status,paid_at,kitchen_completed_at FROM orders WHERE id=?').bind(addMatch[1]).first();if(!o||o.status==='cancelled'||o.paid_at||o.kitchen_completed_at)return json({error:'Order closed'},409);const keys=[...new Set(b.items.map(x=>x.menu_id))];if(keys.some(x=>typeof x!=='string'))return json({error:'Invalid menu'},400);const rows=(await env.DB.prepare(`SELECT * FROM menu WHERE active=1 AND id IN (${keys.map(()=>'?').join(',')})`).bind(...keys).all()).results;const map=new Map(rows.map(x=>[x.id,x]));if(keys.some(x=>!map.has(x))||b.items.some(x=>!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>99))return json({error:'Invalid items'},400);const now=new Date().toISOString();let stmts;try{stmts=await prepareOrderItems(env,b.items,addMatch[1],now)}catch(e){return json({error:e.message},400)};stmts.push(env.DB.prepare("UPDATE orders SET status='new',updated_at=? WHERE id=?").bind(now,addMatch[1]));stmts.push(env.DB.prepare('INSERT INTO events(id,order_id,event,actor,detail,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),addMatch[1],'items_added',role,JSON.stringify({count:b.items.length}),now));await env.DB.batch(stmts);await broadcast(env,'orders',{id:addMatch[1]});return json({ok:true});}
if(path==='/api/events'&&req.method==='GET'){if(!allowed(role,'admin'))return json({error:'Forbidden'},403);return json((await env.DB.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 200').all()).results);}
if(path==='/api/ws-diagnostics'&&req.method==='GET'){if(!allowed(role,'admin'))return json({error:'Forbidden'},403);const response=await room(env).fetch('https://room.internal/diagnostics',{headers:{'x-room-secret':env.AUTH_SECRET}});return json(await response.json(),response.status);}
if(path==='/api/health'&&req.method==='GET')return json({ok:true,time:new Date().toISOString()});
if(path==='/api/scanner/reserve'&&req.method==='GET')return json({ready:false,message:'Scanner OCR is reserved for a later release; no external orders are imported.'});
return json({error:'Not found'},404);
}catch(e){console.error(e);return json({error:'Server error'},500);}
}};
export class OrderRoom {constructor(state,env){this.state=state;this.env=env;}async fetch(req){if(req.headers.get('x-room-secret')!==this.env.AUTH_SECRET)return new Response('Forbidden',{status:403});const path=new URL(req.url).pathname;if(path==='/ws'){const pair=new WebSocketPair();const [client,server]=Object.values(pair);this.state.acceptWebSocket(server);server.send(JSON.stringify({type:'connected',time:Date.now()}));return new Response(null,{status:101,webSocket:client,headers:{'Sec-WebSocket-Protocol':req.headers.get('sec-websocket-protocol')||''}});}if(path==='/broadcast'){const message=await req.text();let delivered=0,failed=0;for(const socket of this.state.getWebSockets()){try{socket.send(message);delivered++;}catch{failed++;try{socket.close();}catch{}}}console.log('KDS_BROADCAST',JSON.stringify({delivered,failed,event:JSON.parse(message).type}));return json({delivered,failed});}if(path==='/diagnostics'){return json({connected_sockets:this.state.getWebSockets().length,time:new Date().toISOString()});}return new Response('Not found',{status:404});}webSocketMessage(ws,message){if(message==='ping')ws.send('pong');}webSocketError(ws){try{ws.close();}catch{}}}
