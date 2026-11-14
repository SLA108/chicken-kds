import {isPairingCode,isDeviceRole,pairingExpired,approvalAttemptPolicy,parseDeviceCookie} from './device-pairing.js';
import {issueStoreSession,verifyStoreSession,sha256Hex,activeDeviceStore,allowedDeviceStore,listAllowedDeviceStores} from './store-auth.js';
const json=(x,status=200,extra={})=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra}});
const uid=()=>crypto.randomUUID();
const roles={pos:['pos','admin'],kitchen:['kitchen','admin'],admin:['admin'],scanner:['scanner','pos','admin']};
const encoder=new TextEncoder();
async function tokenFor(pin,secret){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(pin)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
async function identify(req,env){const header=req.headers.get('authorization')||'';const protocol=req.headers.get('sec-websocket-protocol')||'';const supplied=header.startsWith('Bearer ')?header.slice(7):protocol.startsWith('ckauth.')?protocol.slice(7):'';if(!supplied)return null;for(const role of ['admin']){if(!env[role.toUpperCase()+'_PIN'])continue;const expected=await tokenFor(env[role.toUpperCase()+'_PIN'],env.AUTH_SECRET);if(supplied.length===expected.length){let diff=0;for(let i=0;i<supplied.length;i++)diff|=supplied.charCodeAt(i)^expected.charCodeAt(i);if(!diff)return role;}}return null;}
// Each restaurant uses its own isolated WebSocket room.
function room(env,storeId){
 if(!storeId)throw Error('Store ID required for WebSocket room');
 return env.ROOM.get(env.ROOM.idFromName('store:'+storeId));
}
async function broadcast(env,type,data){
 try{
  const stores=(await env.DB.prepare('SELECT id FROM stores WHERE active=1').all()).results;
  await Promise.all(stores.map(store=>broadcastStore(env,store.id,type,data)));
 }catch(e){console.error('store broadcast fanout failed',e);}
}
async function disconnectDeviceStore(env,storeId,deviceId){try{await room(env,storeId).fetch('https://room.internal/disconnect-device',{method:'POST',headers:{'content-type':'application/json','x-room-secret':env.AUTH_SECRET},body:JSON.stringify({device_id:deviceId})});}catch(e){console.error('device disconnect failed',e);}}
async function broadcastStore(env,storeId,type,data){try{const headers={'content-type':'application/json','x-room-secret':env.AUTH_SECRET};const response=await room(env,storeId).fetch('https://room.internal/broadcast',{method:'POST',headers,body:JSON.stringify({type,data})});if(!response.ok)console.error('store broadcast failed',response.status);if(type==='orders'||type==='pickup'){await room(env,'__admin__').fetch('https://room.internal/broadcast',{method:'POST',headers,body:JSON.stringify({type:'store_event',store_id:storeId,event:type})});}}catch(e){console.error('store broadcast error',e);}}
async function parse(req){try{return await req.json();}catch{return null;}}
function allowed(role,action){return !!role&&roles[action].includes(role);}
async function event(env,orderId,type,actor,detail={}){const now=new Date().toISOString();await env.DB.batch([env.DB.prepare('INSERT INTO events(id,order_id,event,actor,detail,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),orderId,type,actor,JSON.stringify(detail),now),env.DB.prepare('INSERT INTO sync_outbox(id,order_id,event,payload,created_at) VALUES(?,?,?,?,?)').bind(uid(),orderId,type,JSON.stringify(detail),now)]);}
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
  const discount=item.discount_percent??0;
  if(![0,20,50].includes(discount))throw Error('Invalid discount');
  const m=lookup.get(item.menu_id),itemId=uid(),extra=selected.reduce((v,id)=>v+opts.get(id).price_cents,0);
  const originalPrice=m.price_cents+extra;
  const discountAmount=Math.round(originalPrice*discount/100);
  const finalPrice=originalPrice-discountAmount;
  statements.push(env.DB.prepare('INSERT INTO order_items(id,order_id,menu_id,name,quantity,note,created_at,price_cents,vat_rate,original_price_cents,discount_percent,discount_cents) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(itemId,orderId,m.id,m.name,item.quantity,String(item.note||'').slice(0,300),now,finalPrice,m.vat_rate??8,originalPrice,discount,discountAmount));
  for(const optionId of selected){const o=opts.get(optionId);statements.push(env.DB.prepare('INSERT INTO order_item_modifiers(id,order_item_id,option_id,name,price_cents) VALUES(?,?,?,?,?)').bind(uid(),itemId,o.id,o.name,o.price_cents));}
 }
 return statements;
}
export default {async fetch(req,env){const url=new URL(req.url);const path=url.pathname;if(path.startsWith('/images/')){if(req.method!=='GET')return new Response('Method not allowed',{status:405});const key=path.slice('/images/'.length);if(!/^[0-9a-f-]{36}\.(webp|png|jpg)$/.test(key))return new Response('Not found',{status:404});if(!env.MENU_IMAGES)return new Response('Image storage unavailable',{status:503});const object=await env.MENU_IMAGES.get(key);if(!object)return new Response('Not found',{status:404});return new Response(object.body,{headers:{'content-type':object.httpMetadata?.contentType||'image/webp','cache-control':'public, max-age=86400','x-content-type-options':'nosniff'}});}
if(!path.startsWith('/api/')&&path!=='/ws'){let assetPath=path;if(['/pos','/kitchen','/admin','/scanner','/'].includes(path))assetPath='/';return env.ASSETS.fetch(new Request(new URL(assetPath,url),req));}
if(!env.AUTH_SECRET||!env.ADMIN_PIN)return json({error:'Server secrets not configured'},503);
if(path==='/api/login'&&req.method==='POST'){const b=await parse(req);if(!b||typeof b.pin!=='string'||b.role!=='admin')return json({error:'Invalid login'},400);const expected=env[b.role.toUpperCase()+'_PIN'];if(b.pin!==expected)return json({error:'Incorrect PIN'},401);return json({token:await tokenFor(expected,env.AUTH_SECRET),role:b.role});}
// Pairing approval issues an HttpOnly device cookie used for scoped session renewal.
// Independent, HttpOnly role credentials prevent POS/Kitchen overwriting each other.
const deviceRoles=['pos','kitchen','scanner'];
const roleCookie=(role)=>'ck_device';
const rolePairCookie=(role)=>'ck_pair';
const cookieValue=(name)=>(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
const renewalCookie=(role,id,secret)=>roleCookie(role)+'='+id+'.'+secret+'; HttpOnly; Secure; SameSite=Strict; Path=/api/device; Max-Age=31536000';
const clearRenewalCookie=(role)=>roleCookie(role)+'=; HttpOnly; Secure; SameSite=Strict; Path=/api/device; Max-Age=0';
const pairCookie=(role,secret)=>rolePairCookie(role)+'='+secret+'; HttpOnly; Secure; SameSite=Strict; Path=/api/device/pair; Max-Age=600';
const clearPairCookie=(role)=>rolePairCookie(role)+'=; HttpOnly; Secure; SameSite=Strict; Path=/api/device/pair; Max-Age=0';
const legacyCookie=cookieValue('ck_device');
if(path==='/api/device/pair/start'&&req.method==='POST'){
 if(req.headers.get('origin')!==url.origin)return json({error:'Invalid origin'},403);
 const role=url.searchParams.get('role');if(!deviceRoles.includes(role))return json({error:'Invalid device role'},400);
 const secret=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
 const id=uid(),code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0');
 const now=new Date(),expiry=new Date(now.getTime()+10*60*1000);
 try{await env.DB.prepare("INSERT INTO device_pair_requests(id,code,secret_hash,created_at,expires_at) VALUES(?,?,?,?,?)").bind(id,code,await sha256Hex(secret),now.toISOString(),expiry.toISOString()).run();}
 catch{return json({error:'Please retry pairing'},409);}
 return json({code,expires_at:expiry.toISOString()},200,{'set-cookie':pairCookie(secret)});
}
if(path==='/api/device/pair/status'&&req.method==='GET'){
 if(req.headers.get('sec-fetch-site')==='cross-site')return json({error:'Forbidden'},403);
 const role=url.searchParams.get('role');if(!deviceRoles.includes(role))return json({error:'Invalid device role'},400);
 const pairSecret=cookieValue(rolePairCookie(role));
 if(!/^[0-9a-f]{64}$/.test(pairSecret))return json({error:'Pairing not started'},401);
 const request=await env.DB.prepare("SELECT id,status,device_id,expires_at FROM device_pair_requests WHERE secret_hash=? ORDER BY created_at DESC LIMIT 1").bind(await sha256Hex(pairSecret)).first();
 if(!request||pairingExpired(request.expires_at))return json({status:'expired'},410,{'set-cookie':clearPairCookie(role)});
 if(request.status!=='approved')return json({status:'pending'});
 const device=await env.DB.prepare("SELECT id,store_id,role,token_hash FROM pos_devices WHERE id=? AND active=1").bind(request.device_id).first();
 if(!device)return json({error:'Device unavailable'},403);
 if(role==='scanner'&&device.role!=='scanner'||role!=='scanner'&&device.role==='scanner')return json({error:'Device role mismatch'},403);
 const allowedStores=await listAllowedDeviceStores(env,device.id);
 if(!allowedStores.length)return json({error:'No authorized active stores'},403);
 const initialStore=allowedStores.find(s=>s.id===device.store_id)||allowedStores[0];
 // Rotate the pairing secret into a long-lived credential only after approval.
 const credential=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
 const updated=await env.DB.prepare('UPDATE pos_devices SET token_hash=? WHERE id=? AND token_hash=? AND active=1').bind(await sha256Hex(credential),device.id,'pending:'+device.id).run();
 if(!updated.meta.changes)return json({error:'Pairing already claimed'},409);
 await env.DB.prepare("UPDATE device_pair_requests SET status='expired' WHERE id=?").bind(request.id).run();
 const token=await issueStoreSession(env.AUTH_SECRET,{role,storeId:initialStore.id,deviceId:device.id});
 const response=json({status:'approved',token,role,store:initialStore,stores:allowedStores});response.headers.append('set-cookie',renewalCookie(role,device.id,credential));response.headers.append('set-cookie',clearPairCookie(role));return response;
}
if(path==='/api/device/renew'&&req.method==='POST'){
 const origin=req.headers.get('origin');
 if(origin!==url.origin)return json({error:'Invalid origin'},403);
 const body=req.headers.get('content-type')?.includes('application/json')?await parse(req):{};
 const role=body?.role;if(!deviceRoles.includes(role))return json({error:'Invalid device role'},400);
 const named=cookieValue(roleCookie(role));
 const match=parseDeviceCookie(named?roleCookie(role)+'='+named:legacyCookie?'ck_device='+legacyCookie:'');
 if(!match)return json({error:'Device enrollment required'},401);
 const digest=await sha256Hex(match.credential);
 const device=await env.DB.prepare('SELECT id,store_id,role FROM pos_devices WHERE id=? AND token_hash=? AND active=1').bind(match.deviceId,digest).first();
 if(!device||role==='scanner'&&device.role!=='scanner'||role!=='scanner'&&device.role==='scanner')return json({error:'Device revoked or role mismatch'},401);
 const stores=await listAllowedDeviceStores(env,device.id);
 if(!stores.length)return json({error:'No authorized active stores'},403);
 let selectedId=device.store_id,explicitStore=false;
 if(body?.store_id!==undefined){
   if(typeof body.store_id!=='string')return json({error:'Invalid store selection'},400);
   selectedId=body.store_id;explicitStore=true;
 }
 const store=stores.find(s=>s.id===selectedId)||(!explicitStore?stores[0]:null);
 if(!store)return json({error:'Store not authorized'},403);
 const token=await issueStoreSession(env.AUTH_SECRET,{role,storeId:store.id,deviceId:device.id});
 return json({token,role,store,stores,expires_in:28800},200,{'set-cookie':renewalCookie(role,device.id,match.credential)});
}
if(path==='/api/device/logout'&&req.method==='POST'){
 const origin=req.headers.get('origin');
 if(origin!==url.origin)return json({error:'Invalid origin'},403);
 const body=req.headers.get('content-type')?.includes('application/json')?await parse(req):{};
 const role=body?.role;if(!deviceRoles.includes(role))return json({error:'Invalid device role'},400);
 return json({ok:true},200,{'set-cookie':clearRenewalCookie(role)});
}
const bearer=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
const wsProtocol=req.headers.get('sec-websocket-protocol')||'';
const sessionToken=bearer.startsWith('cks1.')?bearer:wsProtocol.startsWith('ckauth.cks1.')?wsProtocol.slice('ckauth.'.length):'';
if(sessionToken){
 const session=await verifyStoreSession(env.AUTH_SECRET,sessionToken);
 if(!session)return json({error:'Invalid or expired device session'},401);
 const device=await allowedDeviceStore(env,session.deviceId,session.storeId);
 if(!device)return json({error:'Device revoked or store inactive'},403);
 const boundRole=await env.DB.prepare('SELECT role FROM pos_devices WHERE id=?').bind(session.deviceId).first();
 if(!boundRole||session.role==='scanner'&&boundRole.role!=='scanner'||session.role!=='scanner'&&boundRole.role==='scanner')return json({error:'Device role mismatch'},403);
 if(path==='/api/device/me'&&req.method==='GET')return json({role:session.role,store:{id:device.store_id,code:device.code,name:device.name},stores:await listAllowedDeviceStores(env,session.deviceId),expires_at:session.expiresAt,api_enabled:false});
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
  return room(env,session.storeId).fetch(new Request('https://room.internal/ws',{headers:{upgrade:'websocket','x-room-secret':env.AUTH_SECRET,'x-client-role':session.role,'x-device-id':session.deviceId,'sec-websocket-protocol':wsProtocol}}));
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

 const scopedTips=path.match(/^\/api\/store\/orders\/([^/]+)\/tips$/);
 if(scopedTips&&req.method==='GET'){
  if(session.role!=='pos')return json({error:'Forbidden'},403);
  const ownOrder=await env.DB.prepare('SELECT id FROM orders WHERE id=? AND store_id=?').bind(scopedTips[1],session.storeId).first();
  if(!ownOrder)return json({error:'Order not found'},404);
  const rows=(await env.DB.prepare('SELECT id,amount_cents,method,stage,created_at FROM order_tips WHERE order_id=? AND store_id=? ORDER BY created_at').bind(scopedTips[1],session.storeId).all()).results;
  return json({tips:rows,total_cents:rows.reduce((n,t)=>n+t.amount_cents,0)});
 }
 if(scopedTips&&req.method==='POST'){
  if(session.role!=='pos')return json({error:'Forbidden'},403);
  const b=await parse(req),amount=b?.amount_cents;
  if(!Number.isSafeInteger(amount)||amount<=0||amount>10000000||!['cash','card'].includes(b?.method)||!['checkout','release'].includes(b?.stage)||typeof b?.request_key!=='string'||b.request_key.length<16||b.request_key.length>128)return json({error:'Invalid tip'},400);
  const id=scopedTips[1],storeId=session.storeId;
  const order=await env.DB.prepare('SELECT id,paid_at,source FROM orders WHERE id=? AND store_id=? AND status!=\'cancelled\'').bind(id,storeId).first();
  if(!order||!order.paid_at)return json({error:'Order must be paid before recording tips'},409);
  if(b.stage==='release'){
   const occupancy=await env.DB.prepare('SELECT order_id FROM table_occupancy WHERE order_id=? AND store_id=?').bind(id,storeId).first();
   if(!occupancy||order.source!=='dinein')return json({error:'Table already released'},409);
  }
  const existing=await env.DB.prepare('SELECT id,order_id,store_id FROM order_tips WHERE request_key=?').bind(b.request_key).first();
  if(existing)return existing.order_id===id&&existing.store_id===storeId?json({ok:true,duplicate:true}):json({error:'Tip request key reused'},409);
  const now=new Date().toISOString();
  try{await env.DB.prepare('INSERT INTO order_tips(id,order_id,store_id,amount_cents,method,stage,created_at,actor,request_key) VALUES(?,?,?,?,?,?,?,?,?)').bind(uid(),id,storeId,amount,b.method,b.stage,now,session.role,b.request_key).run();}
  catch(e){return json({error:'Tip save failed: '+e.message},409)}
  return json({ok:true,amount_cents:amount});
 }
 const scopedCheckout=path.match(/^\/api\/store\/orders\/([^/]+)\/checkout$/);
 if(scopedCheckout&&req.method==='POST'){
  if(session.role!=='pos')return json({error:'Forbidden'},403);
  const b=await parse(req);
  if(!['cash','card','other'].includes(b?.method))return json({error:'Invalid payment method'},400);
  const tipAmount=b?.tip_amount_cents??0;
  if(!Number.isSafeInteger(tipAmount)||tipAmount<0||tipAmount>10000000||(tipAmount>0&&!['cash','card'].includes(b?.tip_method)))return json({error:'Invalid tip'},400);
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
  const statements=[
   env.DB.prepare("UPDATE orders SET paid_at=?,updated_at=? WHERE id=? AND store_id=? AND paid_at IS NULL AND status!='cancelled'").bind(now,now,id,storeId),
   env.DB.prepare("INSERT INTO payments(id,order_id,method,amount_cents,created_at,store_id) SELECT ?,?,?,?,?,? WHERE changes()=1 AND EXISTS(SELECT 1 FROM orders WHERE id=? AND store_id=? AND paid_at=?)").bind(paymentId,id,b.method,total,now,storeId,id,storeId,now),
   env.DB.prepare("INSERT INTO events(id,order_id,event,actor,detail,created_at) SELECT ?,?,'paid',?,?,? WHERE EXISTS(SELECT 1 FROM payments WHERE id=? AND store_id=?)").bind(uid(),id,session.role,JSON.stringify({method:b.method,amount_cents:total,store_id:storeId}),now,paymentId,storeId)
  ];
  if(tipAmount>0)statements.push(env.DB.prepare('INSERT INTO order_tips(id,order_id,store_id,amount_cents,method,stage,created_at,actor,request_key) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM payments WHERE id=? AND store_id=?)').bind(uid(),id,storeId,tipAmount,b.tip_method,'checkout',now,session.role,'checkout:'+paymentId,paymentId,storeId));
  const result=await env.DB.batch(statements);
  if(result[0].meta.changes!==1)return json({error:'Ticket already closed; refresh'},409);
  await broadcastStore(env,storeId,'orders',{id});
  return json({ok:true,amount_cents:total,tip_amount_cents:tipAmount});
 }
 const scopedRelease=path.match(/^\/api\/store\/orders\/([^/]+)\/release-table$/);
 if(scopedRelease&&req.method==='POST'){
  if(session.role!=='pos')return json({error:'Forbidden'},403);
  const body=await parse(req),tipAmount=body?.tip_amount_cents??0;
  if(!Number.isSafeInteger(tipAmount)||tipAmount<0||tipAmount>10000000||(tipAmount>0&&!['cash','card'].includes(body?.tip_method)))return json({error:'Invalid tip'},400);
  const id=scopedRelease[1],storeId=session.storeId;
  const order=await env.DB.prepare("SELECT id,table_no,paid_at FROM orders WHERE id=? AND store_id=? AND source='dinein'").bind(id,storeId).first();
  if(!order)return json({error:'Dine-in order not found'},404);
  if(tipAmount>0&&!order.paid_at)return json({error:'Checkout the order before adding a tip'},409);
  const now=new Date().toISOString(),statements=[
   env.DB.prepare('DELETE FROM table_occupancy WHERE order_id=? AND store_id=?').bind(id,storeId)
  ];
  if(tipAmount>0){
   const requestKey=body?.tip_request_key;
   if(typeof requestKey!=='string'||requestKey.length<16||requestKey.length>128)return json({error:'Invalid tip request key'},400);
   statements.push(env.DB.prepare("INSERT INTO order_tips(id,order_id,store_id,amount_cents,method,stage,created_at,actor,request_key) SELECT ?,?,?,?,?,?,?,?,? WHERE changes()=1 AND EXISTS(SELECT 1 FROM orders WHERE id=? AND store_id=? AND paid_at IS NOT NULL)").bind(uid(),id,storeId,tipAmount,body.tip_method,'release',now,session.role,requestKey,id,storeId));
  }
  const result=await env.DB.batch(statements);
  if(result[0].meta.changes!==1)return json({error:'Table already released'},409);
  await event(env,id,'table_released',session.role,{table_no:order.table_no,store_id:storeId});
  await broadcastStore(env,storeId,'orders',{id});
  return json({ok:true,tip_amount_cents:tipAmount});
 }

 const orderLookup=path.match(/^\/api\/store\/orders\/by-client-key\/([^/]+)$/);
 if(orderLookup&&req.method==='GET'){
  if(session.role!=='pos')return json({error:'Forbidden'},403);
  const key=decodeURIComponent(orderLookup[1]);
  if(key.length<16||key.length>128)return json({error:'Invalid client key'},400);
  const found=await env.DB.prepare('SELECT id,source,table_no,status,created_at FROM orders WHERE client_key=? AND store_id=?').bind(key,session.storeId).first();
  return json({found:!!found,order:found||null});
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
  if(old.status===b.status){
   const current=await env.DB.prepare('SELECT kitchen_completed_at FROM orders WHERE id=? AND store_id=?').bind(id,session.storeId).first();
   if(current?.kitchen_completed_at)return json({error:'Order already kitchen-completed; refresh'},409);
   return json({ok:true});
  }
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
  const order=await env.DB.prepare('SELECT status FROM orders WHERE id=? AND store_id=?').bind(id,session.storeId).first();
  if(!order)return json({error:'Order not found'},404);
  if(order.status==='cancelled')return json({error:'Order cancelled'},409);
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
   :"UPDATE orders SET kitchen_completed_at=NULL,status=CASE WHEN EXISTS(SELECT 1 FROM order_items WHERE order_id=orders.id AND is_done=0) THEN 'new' ELSE 'done' END,updated_at=? WHERE id=? AND store_id=? AND kitchen_completed_at IS NOT NULL AND status!='cancelled'"
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
if(path==='/api/store/reservations'&&req.method==='GET'){
 if(session.role!=='pos')return json({error:'Forbidden'},403);
 const changedSince=new URL(req.url).searchParams.get('changed_since');
 if(changedSince!==null){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(changedSince))return json({error:'Invalid change cursor'},400);
  const changes=(await env.DB.prepare('SELECT id,store_id,starts_at,party_size,guest_name,phone,note,status,created_at,updated_at FROM reservations WHERE store_id=? AND updated_at>? ORDER BY updated_at ASC,id ASC LIMIT 200').bind(session.storeId,changedSince).all()).results;
  return json({changes});
 }
 const q=new URL(req.url).searchParams,from=q.get('from')||'',to=q.get('to')||'';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)return json({error:'Invalid date range'},400);
 const rows=(await env.DB.prepare("SELECT id,starts_at,party_size,guest_name,phone,note,status FROM reservations WHERE store_id=? AND starts_at>=? AND starts_at<? ORDER BY starts_at DESC LIMIT 500").bind(session.storeId,from+'T00:00:00',to+'T23:59:59.999999').all()).results;
 return json({reservations:rows});
}
const storeReservation=path.match(/^\/api\/store\/reservations\/([^/]+)\/(arrived|no-show)$/);
if(storeReservation&&req.method==='POST'){
 if(session.role!=='pos')return json({error:'Forbidden'},403);
 const status=storeReservation[2]==='arrived'?'arrived':'no_show';
 const result=await env.DB.prepare("UPDATE reservations SET status=?,updated_at=? WHERE id=? AND store_id=? AND status='booked'").bind(status,new Date().toISOString(),storeReservation[1],session.storeId).run();
 if(!result.meta.changes)return json({error:'Reservation not found or already handled'},409);
 await broadcastStore(env,session.storeId,'reservations',{id:storeReservation[1]});
 return json({ok:true});
}
 // Unknown store API routes are not forwarded to admin endpoints.
 return json({error:'Unknown store-scoped API endpoint'},404);
}
const role=await identify(req,env);if(!role)return json({error:'Unauthorized'},401);
try{
if(path==='/ws'){
 if(role!=='admin')return json({error:'Forbidden'},403);
 if(req.headers.get('upgrade')!=='websocket'||req.headers.get('origin')!==url.origin)return json({error:'Invalid WebSocket request'},403);
 return room(env,'__admin__').fetch(new Request('https://room.internal/ws',{headers:{upgrade:'websocket','x-room-secret':env.AUTH_SECRET,'sec-websocket-protocol':wsProtocol}}));
}
// Super POS is admin-only and writes into the same store-scoped order pipeline as Front of House.
if(path==='/api/admin/super-pos/menu'&&req.method==='GET'){
 if(role!=='admin')return json({error:'Forbidden'},403);
 const storeId=url.searchParams.get('store_id')||'';
 const store=await env.DB.prepare('SELECT id FROM stores WHERE id=? AND active=1').bind(storeId).first();
 if(!store)return json({error:'Active restaurant not found'},404);
 const items=(await env.DB.prepare("SELECT m.id,m.name,m.category,COALESCE(o.price_cents,m.price_cents) AS price_cents,m.image_url,m.sort_order FROM menu m LEFT JOIN store_menu_overrides o ON o.menu_id=m.id AND o.store_id=? WHERE COALESCE(o.active,m.active)=1 AND COALESCE(o.sold_out,0)=0 ORDER BY m.sort_order,m.name").bind(storeId).all()).results;
 const links=(await env.DB.prepare('SELECT l.menu_id,g.id AS group_id,g.name,g.min_select,g.max_select FROM menu_modifier_groups l JOIN modifier_groups g ON g.id=l.group_id AND g.active=1').all()).results;
 const options=(await env.DB.prepare('SELECT o.id,o.group_id,o.name,o.price_cents FROM modifier_options o JOIN modifier_groups g ON g.id=o.group_id WHERE o.active=1 AND g.active=1').all()).results;
 return json({items,links,options});
}
if(path==='/api/admin/super-pos/orders'&&req.method==='POST'){
 if(role!=='admin')return json({error:'Forbidden'},403);
 const b=await parse(req);
 if(!b||typeof b.store_id!=='string'||!Array.isArray(b.items)||!b.items.length||b.items.length>100||typeof b.client_key!=='string'||b.client_key.length<16||!['dinein','takeaway','delivery'].includes(b.source))return json({error:'Invalid order'},400);
 if(b.items.some(x=>typeof x.menu_id!=='string'))return json({error:'Invalid menu IDs'},400);
 const storeId=b.store_id;
 const store=await env.DB.prepare('SELECT id FROM stores WHERE id=? AND active=1').bind(storeId).first();
 if(!store)return json({error:'Active restaurant not found'},404);
 const existing=await env.DB.prepare('SELECT id,store_id FROM orders WHERE client_key=?').bind(b.client_key).first();
 if(existing)return existing.store_id===storeId?json({id:existing.id,duplicate:true}):json({error:'Client key already used'},409);
 if(b.source==='dinein'){
  if(!/^(0[1-9]|1[0-9]|20)$/.test(String(b.table_no||'')))return json({error:'Choose a table from 01 to 20'},400);
  const occupied=await env.DB.prepare('SELECT order_id FROM table_occupancy WHERE store_id=? AND table_no=?').bind(storeId,b.table_no).first();
  if(occupied)return json({error:'Table occupied'},409);
 }
 const id=uid(),now=new Date().toISOString(),detail=[String(b.note||'').trim(),b.customer_name?'Customer: '+String(b.customer_name).slice(0,100):'',b.customer_phone?'Phone: '+String(b.customer_phone).slice(0,60):''].filter(Boolean).join(' | ').slice(0,500);
 const statements=[env.DB.prepare('INSERT INTO orders(id,source,table_no,status,note,created_at,updated_at,created_by,client_key,store_id) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,b.source,b.source==='dinein'?b.table_no:'','new',detail,now,now,'admin',b.client_key,storeId)];
 if(b.source==='dinein')statements.push(env.DB.prepare('INSERT INTO table_occupancy(store_id,table_no,order_id,created_at) VALUES(?,?,?,?)').bind(storeId,b.table_no,id,now));
 try{statements.push(...await prepareOrderItems(env,b.items,id,now,storeId));}catch(e){return json({error:e.message},400);}
 statements.push(env.DB.prepare('INSERT INTO events(id,order_id,event,actor,detail,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),id,'created','admin',JSON.stringify({store_id:storeId,origin:'super_pos'}),now));
 statements.push(env.DB.prepare('INSERT INTO sync_outbox(id,order_id,event,payload,created_at) VALUES(?,?,?,?,?)').bind(uid(),id,'created',JSON.stringify({store_id:storeId,origin:'super_pos'}),now));
 try{await env.DB.batch(statements);}catch(e){
  const duplicate=await env.DB.prepare('SELECT id,store_id FROM orders WHERE client_key=?').bind(b.client_key).first();
  if(duplicate)return duplicate.store_id===storeId?json({id:duplicate.id,duplicate:true}):json({error:'Client key already used'},409);
  if(b.source==='dinein'&&String(e).includes('UNIQUE'))return json({error:'Table already occupied'},409);
  throw e;
 }
 await broadcastStore(env,storeId,'orders',{id});
 return json({id},201);
}
if(path==='/api/admin/orders'&&req.method==='GET'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const params=new URL(req.url).searchParams,storeId=params.get('store_id')||'',status=params.get('status')||'',period=params.get('period')||'current';
 if(status&&!['new','cooking','done','cancelled'].includes(status))return json({error:'Invalid status'},400);
 if(!['current','today','yesterday','7days','custom'].includes(period))return json({error:'Invalid period'},400);
 if(storeId){const found=await env.DB.prepare('SELECT id FROM stores WHERE id=?').bind(storeId).first();if(!found)return json({error:'Store not found'},404);}
 const warsawParts=date=>{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);const val=k=>parts.find(p=>p.type===k).value;return val('year')+'-'+val('month')+'-'+val('day');};
 const midnight=date=>{const tentative=Date.parse(date+'T00:00:00Z');const offsetAt=ms=>{const p=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Warsaw',timeZoneName:'shortOffset'}).formatToParts(new Date(ms)).find(x=>x.type==='timeZoneName')?.value||'GMT';const m=p.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);return m?(m[1]==='-'?-1:1)*(Number(m[2])*60+Number(m[3]||0))*60000:0;};let result=tentative-offsetAt(tentative);return new Date(tentative-offsetAt(result)).toISOString();};
 const today=warsawParts(new Date()),shift=(date,days)=>new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
 let from='',to='';
 if(period==='current'||period==='today'){from=midnight(today);to=midnight(shift(today,1));}
 if(period==='yesterday'){from=midnight(shift(today,-1));to=midnight(today);}
 if(period==='7days'){from=midnight(shift(today,-6));to=midnight(shift(today,1));}
 if(period==='custom'){
  const a=params.get('from')||'',b=params.get('to')||'';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(a)||!/^\d{4}-\d{2}-\d{2}$/.test(b)||a>b||!Number.isFinite(Date.parse(a))||!Number.isFinite(Date.parse(b)))return json({error:'Invalid date range'},400);
  from=midnight(a);to=midnight(shift(b,1));
 }
 const limit=[50,100].includes(Number(params.get('limit')))?Number(params.get('limit')):50,offset=Math.min(100000,Math.max(0,Number.parseInt(params.get('offset')||'0',10)||0));
 const where=[],args=[];
 if(storeId){where.push('o.store_id=?');args.push(storeId);}
 if(status){where.push('o.status=?');args.push(status);}
 if(period==='current'){where.push("(o.created_at>=? AND o.created_at<? OR (o.created_at<? AND o.status IN ('new','cooking')))");args.push(from,to,from);}
 else{where.push('o.created_at>=? AND o.created_at<?');args.push(from,to);}
 const clause='WHERE '+where.join(' AND ');
 const orders=(await env.DB.prepare('SELECT o.*,s.name AS store_name,s.code AS store_code, EXISTS(SELECT 1 FROM table_occupancy t WHERE t.order_id=o.id AND t.store_id=o.store_id) AS table_occupied FROM orders o JOIN stores s ON s.id=o.store_id '+clause+' ORDER BY o.created_at DESC,o.id DESC LIMIT ? OFFSET ?').bind(...args,limit+1,offset).all()).results;
 const has_more=orders.length>limit,visible=orders.slice(0,limit);
 if(visible.length){
  const ids=visible.map(o=>o.id),marks=ids.map(()=>'?').join(',');
  const items=(await env.DB.prepare('SELECT i.* FROM order_items i WHERE i.order_id IN ('+marks+') ORDER BY i.created_at ASC').bind(...ids).all()).results;
  const itemIds=items.map(i=>i.id);
  const modifiers=[];
  for(let n=0;n<itemIds.length;n+=80){const chunk=itemIds.slice(n,n+80);modifiers.push(...(await env.DB.prepare('SELECT m.* FROM order_item_modifiers m WHERE m.order_item_id IN ('+chunk.map(()=>'?').join(',')+')').bind(...chunk).all()).results);}
  const byOrder=new Map(),byItem=new Map();
  for(const m of modifiers){if(!byItem.has(m.order_item_id))byItem.set(m.order_item_id,[]);byItem.get(m.order_item_id).push(m);}
  for(const i of items){if(!byOrder.has(i.order_id))byOrder.set(i.order_id,[]);byOrder.get(i.order_id).push({...i,modifiers:byItem.get(i.id)||[]});}
  for(const o of visible)o.items=byOrder.get(o.id)||[];
 }
 const summary=(await env.DB.prepare('SELECT o.store_id,o.status,COUNT(*) AS count FROM orders o '+clause+' GROUP BY o.store_id,o.status').bind(...args).all()).results;
 return json({orders:visible,summary,has_more,next_offset:has_more?offset+limit:null,limit,period});
}
// Reservations do not create orders or table occupancy.
if(path==='/api/admin/reservations'&&req.method==='GET'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const q=new URL(req.url).searchParams,storeId=q.get('store_id')||'',from=q.get('from')||'',to=q.get('to')||'';
 if((from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))||(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to))||(from&&to&&from>to))return json({error:'Invalid date'},400);
 const conditions=[],args=[];
 if(storeId){conditions.push('r.store_id=?');args.push(storeId)}
 if(from){conditions.push('r.starts_at>=?');args.push(from+'T00:00:00')}
 if(to){conditions.push('r.starts_at<?');args.push(to+'T23:59:59.999999')}
 const rows=(await env.DB.prepare('SELECT r.*,s.name AS store_name FROM reservations r JOIN stores s ON s.id=r.store_id '+(conditions.length?'WHERE '+conditions.join(' AND '):'')+' ORDER BY r.starts_at ASC LIMIT 500').bind(...args).all()).results;
 return json({reservations:rows});
}
if(path==='/api/admin/reservations'&&req.method==='POST'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const b=await parse(req);
 if(!b||typeof b.store_id!=='string'||typeof b.starts_at!=='string'||!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(b.starts_at)||!Number.isInteger(b.party_size)||b.party_size<1||b.party_size>50)return json({error:'Invalid reservation'},400);
 const store=await env.DB.prepare('SELECT id FROM stores WHERE id=? AND active=1').bind(b.store_id).first();
 if(!store)return json({error:'Restaurant unavailable'},404);
 const now=new Date().toISOString(),id=uid();
 await env.DB.prepare('INSERT INTO reservations(id,store_id,starts_at,party_size,guest_name,phone,note,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,b.store_id,b.starts_at,b.party_size,String(b.guest_name||'').slice(0,120),String(b.phone||'').slice(0,80),String(b.note||'').slice(0,500),'booked',now,now).run();
 await broadcastStore(env,b.store_id,'reservations',{action:'created',reservation:{id,store_id:b.store_id,starts_at:b.starts_at,party_size:b.party_size,guest_name:String(b.guest_name||'').slice(0,120),phone:String(b.phone||'').slice(0,80),note:String(b.note||'').slice(0,500),status:'booked'}});
 return json({ok:true,id},201);
}
const reservationMatch=path.match(/^\/api\/admin\/reservations\/([^/]+)$/);
if(reservationMatch&&req.method==='PATCH'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const b=await parse(req),id=reservationMatch[1];
 const existing=await env.DB.prepare('SELECT * FROM reservations WHERE id=?').bind(id).first();
 if(!existing)return json({error:'Reservation not found'},404);
 const storeId=b?.store_id??existing.store_id,startsAt=b?.starts_at??existing.starts_at,party=b?.party_size??existing.party_size,status=b?.status??existing.status;
 if(typeof storeId!=='string'||typeof startsAt!=='string'||!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(startsAt)||!Number.isInteger(party)||party<1||party>50||!['booked','arrived','cancelled','no_show'].includes(status))return json({error:'Invalid reservation'},400);
 const store=await env.DB.prepare('SELECT id FROM stores WHERE id=? AND active=1').bind(storeId).first();if(!store)return json({error:'Restaurant unavailable'},404);
 await env.DB.prepare('UPDATE reservations SET store_id=?,starts_at=?,party_size=?,guest_name=?,phone=?,note=?,status=?,updated_at=? WHERE id=?').bind(storeId,startsAt,party,String(b.guest_name??existing.guest_name).slice(0,120),String(b.phone??existing.phone).slice(0,80),String(b.note??existing.note).slice(0,500),status,new Date().toISOString(),id).run();
 const updatedReservation={id,store_id:storeId,starts_at:startsAt,party_size:party,guest_name:String(b.guest_name??existing.guest_name).slice(0,120),phone:String(b.phone??existing.phone).slice(0,80),note:String(b.note??existing.note).slice(0,500),status};
 if(storeId!==existing.store_id)await broadcastStore(env,existing.store_id,'reservations',{action:'cancelled',reservation:{...updatedReservation,store_id:existing.store_id,status:'cancelled'}});
 await broadcastStore(env,storeId,'reservations',{action:status==='cancelled'?'cancelled':existing.status==='cancelled'?'created':'updated',reservation:updatedReservation});
 return json({ok:true,id});
}
if(path==='/api/admin/stores'&&req.method==='GET'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 try{
  const rows=(await env.DB.prepare("SELECT s.id,s.code,s.name,s.active,COUNT(o.id) AS order_count FROM stores s LEFT JOIN orders o ON o.store_id=s.id GROUP BY s.id,s.code,s.name,s.active ORDER BY CASE WHEN s.code='TEST' THEN 0 ELSE 1 END,s.name").all()).results;
  return json({stores:rows,multistore_enabled:true});
 }catch(e){
  console.error('store inventory unavailable',e);
  return json({error:'Multi-store schema not installed',code:'MULTISTORE_SCHEMA_MISSING'},503);
 }
}

const storeConfigMatch=path.match(/^\/api\/admin\/stores\/([a-zA-Z0-9_-]{1,64})\/config$/);
if(storeConfigMatch&&req.method==='PATCH'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const id=storeConfigMatch[1],b=await parse(req);
 if(!b||typeof b.active!=='boolean')return json({error:'Expected active boolean'},400);
 const store=await env.DB.prepare('SELECT id,code,active FROM stores WHERE id=?').bind(id).first();
 if(!store)return json({error:'Store not found'},404);
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
 const storeId=storeMenuItemMatch[1],menuId=decodeURIComponent(storeMenuItemMatch[2]),b=await parse(req);
 if(!b||!Number.isInteger(b.price_cents)&&b.price_cents!==null||b.price_cents!==null&&(b.price_cents<0||b.price_cents>10000000)||![null,true,false].includes(b.active)||typeof b.sold_out!=='boolean')return json({error:'Invalid menu override'},400);
 const [store,item]=await Promise.all([env.DB.prepare('SELECT id FROM stores WHERE id=?').bind(storeId).first(),env.DB.prepare('SELECT id FROM menu WHERE id=?').bind(menuId).first()]);
 if(!store||!item)return json({error:'Store or menu item not found'},404);
 await env.DB.prepare('INSERT INTO store_menu_overrides(store_id,menu_id,price_cents,active,sold_out,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(store_id,menu_id) DO UPDATE SET price_cents=excluded.price_cents,active=excluded.active,sold_out=excluded.sold_out,updated_at=excluded.updated_at').bind(storeId,menuId,b.price_cents,b.active===null?null:b.active?1:0,b.sold_out?1:0,new Date().toISOString()).run();
 await broadcastStore(env,storeId,'menu',{menu_id:menuId});
 return json({ok:true});
}
// Cross-store paid sales report. TEST is excluded unless explicitly requested.
// Read-only Warsaw-local daily overview. Payment totals are sourced from payments;
 // unpaid is the outstanding balance on non-cancelled orders, never negative.
if(path==='/api/admin/overview'&&req.method==='GET'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const midnightUtc=d=>{
  const target=Date.parse(d+'T00:00:00Z');
  const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Warsaw',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  let t=target;
  for(let i=0;i<3;i++){const p=Object.fromEntries(fmt.formatToParts(new Date(t)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));t+=target-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);}
  return new Date(t).toISOString();
 };
 const next=new Date(day+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);
 const from=midnightUtc(day),to=midnightUtc(next.toISOString().slice(0,10));
 const stores=(await env.DB.prepare("SELECT id,code,name FROM stores WHERE code!='TEST' AND active=1 ORDER BY name").all()).results;
 const rows=(await env.DB.prepare(`SELECT o.store_id,o.id,o.status,o.paid_at,
 COALESCE((SELECT SUM(i.quantity*i.price_cents) FROM order_items i WHERE i.order_id=o.id),0) AS order_cents,
 COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.order_id=o.id AND p.store_id=o.store_id),0) AS paid_cents,
 (SELECT COUNT(*) FROM order_items i WHERE i.order_id=o.id AND i.price_cents IS NULL) AS unpriced
 FROM orders o JOIN stores s ON s.id=o.store_id
 WHERE s.code!='TEST' AND s.active=1 AND o.created_at>=? AND o.created_at<? AND o.status!='cancelled'`).bind(from,to).all()).results;
 const discountRows=(await env.DB.prepare("SELECT o.store_id,COALESCE(SUM(i.quantity*i.discount_cents),0) AS discount_cents FROM orders o JOIN stores s ON s.id=o.store_id JOIN order_items i ON i.order_id=o.id WHERE s.code!='TEST' AND s.active=1 AND o.created_at>=? AND o.created_at<? AND o.status!='cancelled' GROUP BY o.store_id").bind(from,to).all()).results;
 const tipRows=(await env.DB.prepare("SELECT t.store_id,t.method,COALESCE(SUM(t.amount_cents),0) AS amount_cents FROM order_tips t JOIN stores s ON s.id=t.store_id WHERE s.code!='TEST' AND s.active=1 AND t.created_at>=? AND t.created_at<? GROUP BY t.store_id,t.method").bind(from,to).all()).results;
 const paymentRows=(await env.DB.prepare("SELECT o.store_id,LOWER(TRIM(COALESCE(p.method,''))) AS method,COALESCE(SUM(p.amount_cents),0) AS amount_cents FROM payments p JOIN orders o ON o.id=p.order_id AND o.store_id=p.store_id JOIN stores s ON s.id=o.store_id WHERE s.code!='TEST' AND s.active=1 AND o.created_at>=? AND o.created_at<? AND o.status!='cancelled' GROUP BY o.store_id,LOWER(TRIM(COALESCE(p.method,'')))").bind(from,to).all()).results;
 const paymentSplit=storeId=>{const items=paymentRows.filter(p=>p.store_id===storeId);return {cash_cents:items.filter(p=>p.method==='cash').reduce((n,p)=>n+Number(p.amount_cents),0),card_cents:items.filter(p=>p.method==='card').reduce((n,p)=>n+Number(p.amount_cents),0),others_cents:items.filter(p=>p.method!=='cash'&&p.method!=='card').reduce((n,p)=>n+Number(p.amount_cents),0)}};
 const result=stores.map(store=>{
  const subset=rows.filter(o=>o.store_id===store.id);
  let paid=0,unpaid=0,unpriced=0;
  for(const o of subset){const received=Math.max(0,Number(o.paid_cents)||0),total=Math.max(0,Number(o.order_cents)||0);paid+=received;unpaid+=Math.max(0,total-received);if(Number(o.unpriced))unpriced++;}
  const discount_cents=Number(discountRows.find(d=>d.store_id===store.id)?.discount_cents||0);const tips=tipRows.filter(t=>t.store_id===store.id);const cash_tips_cents=tips.filter(t=>t.method==='cash').reduce((n,t)=>n+Number(t.amount_cents),0),card_tips_cents=tips.filter(t=>t.method==='card').reduce((n,t)=>n+Number(t.amount_cents),0);
  return {...paymentSplit(store.id),store_id:store.id,code:store.code,name:store.name,orders:subset.length,paid_cents:paid,unpaid_cents:unpaid,total_cents:paid+unpaid,unpriced_orders:unpriced,cash_tips_cents,card_tips_cents,tip_cents:cash_tips_cents+card_tips_cents,discount_cents};
 });
 const total=result.reduce((a,x)=>({orders:a.orders+x.orders,cash_cents:a.cash_cents+x.cash_cents,card_cents:a.card_cents+x.card_cents,others_cents:a.others_cents+x.others_cents,paid_cents:a.paid_cents+x.paid_cents,unpaid_cents:a.unpaid_cents+x.unpaid_cents,total_cents:a.total_cents+x.total_cents,unpriced_orders:a.unpriced_orders+x.unpriced_orders,cash_tips_cents:a.cash_tips_cents+x.cash_tips_cents,card_tips_cents:a.card_tips_cents+x.card_tips_cents,tip_cents:a.tip_cents+x.tip_cents,discount_cents:a.discount_cents+x.discount_cents}),{orders:0,cash_cents:0,card_cents:0,others_cents:0,paid_cents:0,unpaid_cents:0,total_cents:0,unpriced_orders:0,cash_tips_cents:0,card_tips_cents:0,tip_cents:0,discount_cents:0});
 return json({date:day,timezone:'Europe/Warsaw',currency:'PLN',stores:result,total});
}
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
// V3.1 device store permissions. Requires migration 0012 before deployment.
if(/^\/api\/admin\/devices\/[^/]+\/stores$/.test(path)&&['GET','PUT'].includes(req.method)){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const deviceId=decodeURIComponent(path.split('/')[4]);
 const device=await env.DB.prepare('SELECT id,store_id,active FROM pos_devices WHERE id=?').bind(deviceId).first();
 if(!device)return json({error:'Device not found'},404);
 if(req.method==='GET'){
  const stores=(await env.DB.prepare('SELECT s.id,s.code,s.name,s.active FROM device_store_access a JOIN stores s ON s.id=a.store_id WHERE a.device_id=? ORDER BY s.name').bind(deviceId).all()).results;
  return json({device_id:deviceId,stores});
 }
 if(req.headers.get('origin')!==url.origin)return json({error:'Invalid origin'},403);
 const body=await parse(req);
 if(!env.DEVICE_APPROVAL_PIN||env.DEVICE_APPROVAL_PIN.length<8)return json({error:'Secondary approval password not configured'},503);
 const attemptScope='grants:'+deviceId,nowMs=Date.now();
 const attempt=await env.DB.prepare('SELECT attempts,window_started_at,blocked_until FROM device_approval_attempts WHERE scope=?').bind(attemptScope).first();
 if(attempt?.blocked_until&&Date.parse(attempt.blocked_until)>nowMs)return json({error:'Too many attempts. Try again later.'},429);
 if(typeof body?.secondary_pin!=='string'||await sha256Hex(body.secondary_pin)!==await sha256Hex(env.DEVICE_APPROVAL_PIN)){
  const policy=approvalAttemptPolicy(attempt,nowMs);
  await env.DB.prepare('INSERT INTO device_approval_attempts(scope,attempts,window_started_at,blocked_until) VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET attempts=excluded.attempts,window_started_at=excluded.window_started_at,blocked_until=excluded.blocked_until').bind(attemptScope,policy.attempts,policy.windowStartedAt,policy.blockedUntil).run();
  return json({error:'Incorrect secondary password'},403);
 }
 const ids=body?.store_ids;
 if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'||id.length>64)||new Set(ids).size!==ids.length)return json({error:'Select one or more distinct stores'},400);
 const activeStores=(await env.DB.prepare('SELECT id FROM stores WHERE active=1').all()).results;
 const activeIds=new Set(activeStores.map(x=>x.id));
 if(ids.some(id=>!activeIds.has(id)))return json({error:'Unknown or inactive store'},400);
 const previous=(await env.DB.prepare('SELECT store_id FROM device_store_access WHERE device_id=?').bind(deviceId).all()).results.map(x=>x.store_id);
 const now=new Date().toISOString();
 await env.DB.batch([
  env.DB.prepare('DELETE FROM device_store_access WHERE device_id=?').bind(deviceId),
  ...ids.map(id=>env.DB.prepare('INSERT INTO device_store_access(device_id,store_id,granted_at) VALUES(?,?,?)').bind(deviceId,id,now)),
  env.DB.prepare('UPDATE pos_devices SET store_id=? WHERE id=?').bind(ids.includes(device.store_id)?device.store_id:ids[0],deviceId)
 ]);
 await Promise.all(previous.filter(id=>!ids.includes(id)).map(id=>disconnectDeviceStore(env,id,deviceId)));
 return json({ok:true,device_id:deviceId,store_ids:ids});
}
if(path==='/api/admin/device-pairings'&&req.method==='GET'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const rows=(await env.DB.prepare("SELECT code,created_at,expires_at FROM device_pair_requests WHERE status='pending' AND expires_at>? ORDER BY created_at DESC LIMIT 30").bind(new Date().toISOString()).all()).results;
 return json({requests:rows});
}
if(path==='/api/admin/device-pairings/approve'&&req.method==='POST'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 if(req.headers.get('origin')!==url.origin)return json({error:'Invalid origin'},403);
 const b=await parse(req);
 if(!b||!isPairingCode(b.code)||(b.role!==undefined&&!['pos','kitchen','scanner'].includes(b.role))||typeof b.label!=='string'||!b.label.trim()||b.label.length>100||typeof b.secondary_pin!=='string')return json({error:'Invalid approval'},400);
 if(!env.DEVICE_APPROVAL_PIN||env.DEVICE_APPROVAL_PIN.length<8)return json({error:'Secondary approval password not configured'},503);
 const attemptScope='pair:'+b.code,nowMs=Date.now();
 const attempt=await env.DB.prepare('SELECT attempts,window_started_at,blocked_until FROM device_approval_attempts WHERE scope=?').bind(attemptScope).first();
 if(attempt?.blocked_until&&Date.parse(attempt.blocked_until)>nowMs)return json({error:'Too many attempts. Request a new pairing code later.'},429);
 if(await sha256Hex(b.secondary_pin)!==await sha256Hex(env.DEVICE_APPROVAL_PIN)){
  const policy=approvalAttemptPolicy(attempt,nowMs);
  await env.DB.prepare('INSERT INTO device_approval_attempts(scope,attempts,window_started_at,blocked_until) VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET attempts=excluded.attempts,window_started_at=excluded.window_started_at,blocked_until=excluded.blocked_until').bind(attemptScope,policy.attempts,policy.windowStartedAt,policy.blockedUntil).run();
  return json({error:'Incorrect secondary password'},403);
 }
 const requestedStores=Array.isArray(b.store_ids)?b.store_ids:[b.store_id];
 if(!requestedStores.length||requestedStores.length>100||requestedStores.some(id=>typeof id!=='string')||new Set(requestedStores).size!==requestedStores.length)return json({error:'Select valid stores'},400);
 const activeStores=(await env.DB.prepare('SELECT id FROM stores WHERE active=1').all()).results;
 if(requestedStores.some(id=>!activeStores.some(s=>s.id===id)))return json({error:'Active store not found'},404);
 const store={id:requestedStores[0]};
 const now=new Date().toISOString(),deviceId=uid();
 // Transactional, single-use claim: only one administrator can approve a code.
 const pairing=await env.DB.prepare("SELECT id FROM device_pair_requests WHERE code=? AND status='pending' AND expires_at>?").bind(b.code,now).first();
 if(!pairing)return json({error:'Code expired or already used'},409);
 const result=await env.DB.batch([
  env.DB.prepare("INSERT INTO pos_devices(id,store_id,label,token_hash,role,active,created_at) SELECT ?,?,?,?,?,1,? WHERE EXISTS(SELECT 1 FROM device_pair_requests WHERE id=? AND status='pending' AND expires_at>?)").bind(deviceId,store.id,b.label.trim(),'pending:'+deviceId,b.role==='scanner'?'scanner':'pos',now,pairing.id,now),
  env.DB.prepare("UPDATE device_pair_requests SET status='approved',device_id=? WHERE id=? AND status='pending' AND expires_at>?").bind(deviceId,pairing.id,now),
  ...requestedStores.map(id=>env.DB.prepare('INSERT INTO device_store_access(device_id,store_id,granted_at) VALUES(?,?,?)').bind(deviceId,id,now))
 ]);
 if(!result[0].meta.changes||!result[1].meta.changes)return json({error:'Pairing already claimed'},409);
 return json({ok:true,device_id:deviceId});
}
if(path==='/api/admin/devices'&&req.method==='GET'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const devices=(await env.DB.prepare("SELECT d.id,d.store_id,s.code AS store_code,s.name AS store_name,d.label,d.active,d.created_at,d.revoked_at FROM pos_devices d JOIN stores s ON s.id=d.store_id ORDER BY d.created_at DESC LIMIT 200").all()).results;
 return json({devices});
}
const revokeDeviceMatch=path.match(/^\/api\/admin\/devices\/([0-9a-f-]{36})\/revoke$/);
if(revokeDeviceMatch&&req.method==='POST'){
 if(!allowed(role,'admin'))return json({error:'Forbidden'},403);
 const assigned=(await env.DB.prepare('SELECT store_id FROM device_store_access WHERE device_id=?').bind(revokeDeviceMatch[1]).all()).results.map(x=>x.store_id);
 const result=await env.DB.prepare("UPDATE pos_devices SET active=0,revoked_at=? WHERE id=? AND active=1").bind(new Date().toISOString(),revokeDeviceMatch[1]).run();
 if(!result.meta.changes)return json({error:'Active device not found'},404);
 await Promise.all(assigned.map(id=>disconnectDeviceStore(env,id,revokeDeviceMatch[1])));
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
if(path==='/api/health'&&req.method==='GET')return json({ok:true,time:new Date().toISOString()});

return json({error:'Not found'},404);
}catch(e){console.error(e);return json({error:'Server error'},500);}
}};
export class OrderRoom {constructor(state,env){this.state=state;this.env=env;}async fetch(req){if(req.headers.get('x-room-secret')!==this.env.AUTH_SECRET)return new Response('Forbidden',{status:403});const path=new URL(req.url).pathname;if(path==='/ws'){const pair=new WebSocketPair();const [client,server]=Object.values(pair);const deviceId=req.headers.get('x-device-id');this.state.acceptWebSocket(server,deviceId?['device:'+deviceId]:[]);server.send(JSON.stringify({type:'connected',time:Date.now()}));return new Response(null,{status:101,webSocket:client,headers:{'Sec-WebSocket-Protocol':req.headers.get('sec-websocket-protocol')||''}});}if(path==='/disconnect-device'&&req.method==='POST'){const body=await req.json().catch(()=>null);if(!body||typeof body.device_id!=='string')return json({error:'Invalid device'},400);let disconnected=0;for(const socket of this.state.getWebSockets()){if(this.state.getTags(socket).includes('device:'+body.device_id)){try{socket.close(1008,'Device store access changed');disconnected++;}catch{}}}return json({disconnected});}if(path==='/broadcast'){const message=await req.text();let delivered=0,failed=0;for(const socket of this.state.getWebSockets()){try{socket.send(message);delivered++;}catch{failed++;try{socket.close();}catch{}}}console.log('KDS_BROADCAST',JSON.stringify({delivered,failed,event:JSON.parse(message).type}));return json({delivered,failed});}if(path==='/diagnostics'){return json({connected_sockets:this.state.getWebSockets().length,time:new Date().toISOString()});}return new Response('Not found',{status:404});}webSocketMessage(ws,message){if(message==='ping')ws.send('pong');}webSocketError(ws){try{ws.close();}catch{}}}
