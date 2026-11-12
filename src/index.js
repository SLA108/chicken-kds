const json=(x,status=200,extra={})=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra}});
const uid=()=>crypto.randomUUID();
const roles={pos:['pos','admin'],kitchen:['kitchen','admin'],admin:['admin'],scanner:['scanner','pos','admin']};
const encoder=new TextEncoder();
async function tokenFor(pin,secret){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(pin)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
async function identify(req,env){const header=req.headers.get('authorization')||'';const protocol=req.headers.get('sec-websocket-protocol')||'';const supplied=header.startsWith('Bearer ')?header.slice(7):protocol.startsWith('ckauth.')?protocol.slice(7):'';if(!supplied)return null;for(const role of ['admin','pos','kitchen','scanner']){if(!env[role.toUpperCase()+'_PIN'])continue;const expected=await tokenFor(env[role.toUpperCase()+'_PIN'],env.AUTH_SECRET);if(supplied.length===expected.length){let diff=0;for(let i=0;i<supplied.length;i++)diff|=supplied.charCodeAt(i)^expected.charCodeAt(i);if(!diff)return role;}}return null;}
function room(env){return env.ROOM.get(env.ROOM.idFromName('main'));}
async function broadcast(env,type,data){try{await room(env).fetch('https://room.internal/broadcast',{method:'POST',headers:{'content-type':'application/json','x-room-secret':env.AUTH_SECRET},body:JSON.stringify({type,data})});}catch(e){console.error('broadcast error',e);}}
async function parse(req){try{return await req.json();}catch{return null;}}
function allowed(role,action){return !!role&&roles[action].includes(role);}
async function event(env,orderId,type,actor,detail={}){const now=new Date().toISOString();await env.DB.batch([env.DB.prepare('INSERT INTO events(id,order_id,event,actor,detail,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),orderId,type,actor,JSON.stringify(detail),now),env.DB.prepare('INSERT INTO sync_outbox(id,order_id,event,payload,created_at) VALUES(?,?,?,?,?)').bind(uid(),orderId,type,JSON.stringify(detail),now)]);}
async function getOrders(env,limit=120){const orders=(await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?').bind(limit).all()).results;const ids=orders.map(o=>o.id);if(!ids.length)return [];const items=(await env.DB.prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(()=>'?').join(',')}) ORDER BY created_at ASC`).bind(...ids).all()).results;return orders.map(o=>({...o,items:items.filter(i=>i.order_id===o.id)}));}
export default {async fetch(req,env){const url=new URL(req.url);const path=url.pathname;if(path.startsWith('/images/')){if(req.method!=='GET')return new Response('Method not allowed',{status:405});const key=path.slice('/images/'.length);if(!/^[0-9a-f-]{36}\.(webp|png|jpg)$/.test(key))return new Response('Not found',{status:404});if(!env.MENU_IMAGES)return new Response('Image storage unavailable',{status:503});const object=await env.MENU_IMAGES.get(key);if(!object)return new Response('Not found',{status:404});return new Response(object.body,{headers:{'content-type':object.httpMetadata?.contentType||'image/webp','cache-control':'public, max-age=86400','x-content-type-options':'nosniff'}});}
if(!path.startsWith('/api/')&&path!=='/ws'){let assetPath=path;if(['/pos','/kitchen','/admin','/scanner','/'].includes(path))assetPath='/';return env.ASSETS.fetch(new Request(new URL(assetPath,url),req));}
if(!env.AUTH_SECRET||!env.POS_PIN||!env.KITCHEN_PIN||!env.ADMIN_PIN||!env.SCANNER_PIN)return json({error:'Server secrets not configured'},503);
if(path==='/api/login'&&req.method==='POST'){const b=await parse(req);if(!b||typeof b.pin!=='string'||!['pos','kitchen','admin','scanner'].includes(b.role))return json({error:'Invalid login'},400);const expected=env[b.role.toUpperCase()+'_PIN'];if(b.pin!==expected)return json({error:'Incorrect PIN'},401);return json({token:await tokenFor(expected,env.AUTH_SECRET),role:b.role});}
const role=await identify(req,env);if(!role)return json({error:'Unauthorized'},401);
try{
if(path==='/ws'){if(req.headers.get('upgrade')!=='websocket')return json({error:'WebSocket required'},426);return room(env).fetch(new Request('https://room.internal/ws',{headers:{upgrade:'websocket','x-room-secret':env.AUTH_SECRET,'x-client-role':role,'sec-websocket-protocol':req.headers.get('sec-websocket-protocol')||''}}));}
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
if(path==='/api/orders'&&req.method==='GET')return json(await getOrders(env));
if(path==='/api/orders'&&req.method==='POST'){if(!allowed(role,'pos'))return json({error:'Forbidden'},403);const b=await parse(req);if(!b||!Array.isArray(b.items)||!b.items.length||b.items.length>100||typeof b.client_key!=='string'||b.client_key.length<16||!['dinein','takeaway','delivery'].includes(b.source))return json({error:'Invalid order'},400);const existing=await env.DB.prepare('SELECT id FROM orders WHERE client_key=?').bind(b.client_key).first();if(existing)return json({id:existing.id,duplicate:true});const ids=b.items.map(x=>x.menu_id);if(ids.some(x=>typeof x!=='string'))return json({error:'Invalid menu IDs'},400);const unique=[...new Set(ids)];const rows=(await env.DB.prepare(`SELECT * FROM menu WHERE active=1 AND id IN (${unique.map(()=>'?').join(',')})`).bind(...unique).all()).results;const lookup=new Map(rows.map(x=>[x.id,x]));if(unique.some(id=>!lookup.has(id))||b.items.some(x=>!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>99))return json({error:'Invalid items'},400);const id=uid(),now=new Date().toISOString();const statements=[env.DB.prepare('INSERT INTO orders(id,source,table_no,status,note,created_at,updated_at,created_by,client_key) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,b.source,String(b.table_no||'').slice(0,30),'new',String(b.note||'').slice(0,500),now,now,role,b.client_key)];for(const item of b.items){const m=lookup.get(item.menu_id);statements.push(env.DB.prepare('INSERT INTO order_items(id,order_id,menu_id,name,quantity,note,created_at,price_cents,vat_rate) VALUES(?,?,?,?,?,?,?,?,?)').bind(uid(),id,m.id,m.name,item.quantity,String(item.note||'').slice(0,300),now,m.price_cents,m.vat_rate??8));}statements.push(env.DB.prepare('INSERT INTO events(id,order_id,event,actor,detail,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),id,'created',role,'{}',now));statements.push(env.DB.prepare('INSERT INTO sync_outbox(id,order_id,event,payload,created_at) VALUES(?,?,?,?,?)').bind(uid(),id,'created','{}',now));try{await env.DB.batch(statements);}catch(e){console.error('ORDER_CREATE_D1_ERROR:',e?.message,e?.stack);const dup=await env.DB.prepare('SELECT id FROM orders WHERE client_key=?').bind(b.client_key).first();if(dup)return json({id:dup.id,duplicate:true});throw e;}await broadcast(env,'orders',{id});return json({id},201);}
const itemMatch=path.match(/^\/api\/order-items\/([^/]+)\/done$/);
if(itemMatch&&req.method==='PATCH'){
 if(!allowed(role,'kitchen'))return json({error:'Forbidden'},403);
   const item=await env.DB.prepare('SELECT oi.id,oi.order_id,o.status FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.id=?').bind(itemMatch[1]).first();
  if(!item)return json({error:'Item not found'},404);
  if(item.status==='cancelled')return json({error:'Order cancelled'},409);
  const now=new Date().toISOString();
  const updated=await env.DB.prepare('UPDATE order_items SET is_done=CASE WHEN is_done=1 THEN 0 ELSE 1 END,done_at=CASE WHEN is_done=1 THEN NULL ELSE ? END WHERE id=? RETURNING is_done').bind(now,item.id).first();
  if(!updated)return json({error:'Item not found'},404);
  const next=updated.is_done;
  await env.DB.prepare('INSERT INTO events(id,order_id,event,actor,detail,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),item.order_id,next?'item_done':'item_undone',role,JSON.stringify({item_id:item.id}),now).run();
  const summary=await env.DB.prepare('SELECT COUNT(*) total,SUM(CASE WHEN is_done=1 THEN 1 ELSE 0 END) done FROM order_items WHERE order_id=?').bind(item.order_id).first();
  const newStatus=summary.total===summary.done?'done':'new';
  await env.DB.prepare("UPDATE orders SET status=?,updated_at=? WHERE id=? AND status!='cancelled'").bind(newStatus,now,item.order_id).run();
  await broadcast(env,'orders',{id:item.order_id,item_id:item.id});return json({ok:true,is_done:next,order_status:newStatus});
}
const statusMatch=path.match(/^\/api\/orders\/([^/]+)\/status$/);
if(statusMatch&&req.method==='PATCH'){if(!allowed(role,'kitchen'))return json({error:'Forbidden'},403);const b=await parse(req);if(!b||!['cooking','done','cancelled'].includes(b.status))return json({error:'Invalid status'},400);if(b.status==='cancelled'&&role!=='admin')return json({error:'Admin only'},403);const id=statusMatch[1],old=await env.DB.prepare('SELECT status FROM orders WHERE id=?').bind(id).first();if(!old)return json({error:'Not found'},404);if(old.status===b.status)return json({ok:true});const transitions={new:['cooking','cancelled'],cooking:['done','cancelled'],done:[],cancelled:[]};if(!transitions[old.status]?.includes(b.status))return json({error:'Invalid transition'},409);const now=new Date().toISOString();const result=await env.DB.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=? AND status=?').bind(b.status,now,id,old.status).run();if(result.meta.changes!==1)return json({error:'Order changed, refresh'},409);await event(env,id,'status',role,{from:old.status,to:b.status});await broadcast(env,'orders',{id});return json({ok:true});}
const addMatch=path.match(/^\/api\/orders\/([^/]+)\/items$/);
if(addMatch&&req.method==='POST'){if(!allowed(role,'pos'))return json({error:'Forbidden'},403);const b=await parse(req);if(!b||!Array.isArray(b.items)||!b.items.length||b.items.length>30)return json({error:'Invalid items'},400);const o=await env.DB.prepare('SELECT status FROM orders WHERE id=?').bind(addMatch[1]).first();if(!o||o.status==='cancelled')return json({error:'Order closed'},409);const keys=[...new Set(b.items.map(x=>x.menu_id))];if(keys.some(x=>typeof x!=='string'))return json({error:'Invalid menu'},400);const rows=(await env.DB.prepare(`SELECT * FROM menu WHERE active=1 AND id IN (${keys.map(()=>'?').join(',')})`).bind(...keys).all()).results;const map=new Map(rows.map(x=>[x.id,x]));if(keys.some(x=>!map.has(x))||b.items.some(x=>!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>99))return json({error:'Invalid items'},400);const now=new Date().toISOString();const stmts=b.items.map(x=>env.DB.prepare('INSERT INTO order_items(id,order_id,menu_id,name,quantity,note,created_at,price_cents,vat_rate) VALUES(?,?,?,?,?,?,?,?,?)').bind(uid(),addMatch[1],x.menu_id,map.get(x.menu_id).name,x.quantity,String(x.note||'').slice(0,300),now,map.get(x.menu_id).price_cents,map.get(x.menu_id).vat_rate??8));stmts.push(env.DB.prepare("UPDATE orders SET status='new',updated_at=? WHERE id=?").bind(now,addMatch[1]));stmts.push(env.DB.prepare('INSERT INTO events(id,order_id,event,actor,detail,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),addMatch[1],'items_added',role,JSON.stringify({count:b.items.length}),now));await env.DB.batch(stmts);await broadcast(env,'orders',{id:addMatch[1]});return json({ok:true});}
if(path==='/api/events'&&req.method==='GET'){if(!allowed(role,'admin'))return json({error:'Forbidden'},403);return json((await env.DB.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 200').all()).results);}
if(path==='/api/health'&&req.method==='GET')return json({ok:true,time:new Date().toISOString()});
if(path==='/api/scanner/reserve'&&req.method==='GET')return json({ready:false,message:'Scanner OCR is reserved for a later release; no external orders are imported.'});
return json({error:'Not found'},404);
}catch(e){console.error(e);return json({error:'Server error'},500);}
}};
export class OrderRoom {constructor(state,env){this.state=state;this.env=env;}async fetch(req){if(req.headers.get('x-room-secret')!==this.env.AUTH_SECRET)return new Response('Forbidden',{status:403});const path=new URL(req.url).pathname;if(path==='/ws'){const pair=new WebSocketPair();const [client,server]=Object.values(pair);this.state.acceptWebSocket(server);server.send(JSON.stringify({type:'connected',time:Date.now()}));return new Response(null,{status:101,webSocket:client,headers:{'Sec-WebSocket-Protocol':req.headers.get('sec-websocket-protocol')||''}});}if(path==='/broadcast'){const message=await req.text();for(const socket of this.state.getWebSockets()){try{socket.send(message);}catch{try{socket.close();}catch{}}}return new Response('ok');}return new Response('Not found',{status:404});}webSocketMessage(ws,message){if(message==='ping')ws.send('pong');}webSocketError(ws){try{ws.close();}catch{}}}
