const page=location.pathname.replace('/','')||'home';const labels={pos:'Front of House',kitchen:'Kitchen Display',admin:'Back Office',scanner:'Delivery Scanner'};const app=document.querySelector('#app');let token=sessionStorage.getItem('ck_token_'+page)||'',menu=[],orders=[],cart={},ws=null,connected=false,category='All',type='dinein',table='01',note='',lastIds=new Set(),lastItemIds=new Set(),audio=null,beepEnabled=false,editingOrder='',pendingKey=crypto.randomUUID(),busy=false,modifierCatalog={groups:[],options:[],links:[]},configuredCart=[],itemDialog=null,fohTab='order',orderReturnTab='tickets',tableState=[],checkoutId='',checkoutMethod='card',lastRealtimeMessage=0;const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const statusName={new:'Pending',cooking:'In progress',done:'Done',cancelled:'Cancelled'};const sourceName={dinein:'Dine-in',takeaway:'Takeaway',delivery:'Delivery'};
const deviceMode=()=>token.startsWith('cks1.');
function scopedApiPath(path){
 if(!deviceMode())return path;
 if(!['pos','kitchen'].includes(page))return path;
 if(path==='/pos/pickups'||path.startsWith('/pos/pickups/'))return '/store'+path.slice('/pos'.length);
 if(path==='/menu'||path==='/orders'||path==='/tables'||path==='/menu/modifiers'||path==='/kitchen/categories')return '/store'+path;
 if(/^\/(?:orders|order-items|pos\/pickups|kitchen\/orders)\//.test(path))return '/store'+path;
 if(path.startsWith('/pos/history')||path.startsWith('/kitchen/history'))return '/store'+path;
 throw Error('Device mode does not permit this endpoint: '+path);
}
let deviceStores=[],currentDeviceStore=null,renewalPending=null,storeSelectionPending=false,storeEpoch=0;
const lastStoreKey='ck_last_store_'+page;
async function renewDeviceSession(){
 if(!['pos','kitchen'].includes(page))return false;
 if(renewalPending)return renewalPending;
 renewalPending=(async()=>{
  try{
   const preferredStore=localStorage.getItem(lastStoreKey);
   const request=storeId=>fetch('/api/device/renew',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(storeId?{store_id:storeId}:{})});
   let r=await request(preferredStore);
   // A previously selected store may have been revoked. Retry without a
   // selection so the server chooses a currently authorized active store.
   if(r.status===403&&preferredStore){
    localStorage.removeItem(lastStoreKey);
    r=await request(null);
   }
   if(!r.ok)return false;
   const result=await r.json();
   if(result.role!==page)return false;
   const oldStoreId=currentDeviceStore?.id;
   deviceStores=result.stores||[];currentDeviceStore=result.store||null;
   storeSelectionPending=!localStorage.getItem(lastStoreKey)&&deviceStores.length>1;
   if(oldStoreId&&currentDeviceStore?.id!==oldStoreId){
    storeEpoch++;kitchenRefreshSerial++;
    // Server changed the active store: invalidate the old socket and UI.
    disconnect();
    sessionStorage.removeItem('ck_token_'+page);
    localStorage.setItem(lastStoreKey,currentDeviceStore.id);
    location.reload();
    return false;
   }
   if(currentDeviceStore&&!storeSelectionPending)localStorage.setItem(lastStoreKey,currentDeviceStore.id);
   token=result.token;sessionStorage.setItem('ck_token_'+page,token);
   return true;
  }catch{return false;}
 })();
 try{return await renewalPending}finally{renewalPending=null;}
}
async function api(path,method='GET',data){
 const epoch=storeEpoch,store=currentDeviceStore?.id;
 const valid=()=>epoch===storeEpoch&&store===currentDeviceStore?.id;
 const request=()=>fetch('/api'+scopedApiPath(path),{method,headers:{'authorization':'Bearer '+token,'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
 let r=await request();
 if(!valid())throw Error('Store changed; request discarded');
 // Only GET requests are safe to replay automatically. A write may have
 // reached the server before a network/auth failure; replaying could duplicate it.
 if((r.status===401||r.status===403)&&deviceMode()){
  const renewed=await renewDeviceSession();
  if(!valid())throw Error('Store changed; request discarded');
  if(renewed&&method==='GET')r=await request();
 }
 if(!valid())throw Error('Store changed; request discarded');
 const out=await r.json();if(!valid())throw Error('Store changed; request discarded');
 if(!r.ok)throw Error(out.error||'Request failed');return out;
}
function notify(msg){const el=document.createElement('div');el.className='notice';el.style.cssText='position:fixed;bottom:15px;right:15px;z-index:99;box-shadow:0 8px 30px #0002;max-width:350px';el.textContent=msg;document.body.append(el);setTimeout(()=>el.remove(),3800)}
function sound(){if(!beepEnabled||!audio)return;try{const t=audio.currentTime;const osc=audio.createOscillator(),gain=audio.createGain();osc.type='sine';osc.frequency.setValueAtTime(880,t);osc.frequency.setValueAtTime(660,t+.17);gain.gain.setValueAtTime(.15,t);gain.gain.exponentialRampToValueAtTime(.001,t+.4);osc.connect(gain).connect(audio.destination);osc.start(t);osc.stop(t+.4)}catch{}}
let pickupItems=[],pickupInitialized=false,pickupSerial=0,pickupSoundReady=false,pickupBellAt=0;
function pickupLabel(i){return i.source==='dinein'?'Table '+i.table_no:(sourceName[i.source]||i.source||'Takeaway')}
async function enablePickupSound(){try{audio=audio||new(window.AudioContext||window.webkitAudioContext)();await audio.resume();pickupSoundReady=audio.state==='running';const b=document.querySelector('#pickup-sound');if(b)b.textContent=pickupSoundReady?'🔊 Alerts enabled':'🔔 Enable pickup sound'}catch(e){notify(e.message)}}
function pickupChime(){
 if(!pickupSoundReady||!audio)return;
 try{const t=audio.currentTime;for(const [dt,hz] of [[0,1047],[.16,1319],[.32,1568]]){const o=audio.createOscillator(),g=audio.createGain();o.frequency.value=hz;g.gain.setValueAtTime(.001,t+dt);g.gain.exponentialRampToValueAtTime(.12,t+dt+.025);g.gain.exponentialRampToValueAtTime(.001,t+dt+.15);o.connect(g);g.connect(audio.destination);o.start(t+dt);o.stop(t+dt+.16)}}catch(e){console.warn(e)}
}
function openPickupQueue(){
 if(configuredCart.length&&!confirm('Discard unsent items?'))return;
 saveFields();editingOrder='';configuredCart=[];note='';itemDialog=null;fohTab='tickets';pos();
 document.querySelector('#pickup-queue')?.scrollIntoView({behavior:'smooth',block:'start'});
}
function pickupToast(items){
 if(!items.length)return;
 const first=items[0],el=document.createElement('div');el.className='pickup-toast';el.id='pickup-toast';
 el.innerHTML='<strong>🔔 Food Ready · '+esc(pickupLabel(first))+'</strong><p>'+Number(first.quantity)+' × '+esc(first.name)+(items.length>1?' · +'+(items.length-1)+' more':'')+'</p><div><button type="button" id="pickup-toast-view">View Pickup Queue</button><button type="button" class="alt" id="pickup-toast-dismiss">Dismiss</button></div>';
 document.querySelector('#pickup-toast')?.remove();document.body.append(el);
 el.querySelector('#pickup-toast-view').onclick=()=>{el.remove();openPickupQueue()};
 el.querySelector('#pickup-toast-dismiss').onclick=()=>el.remove();
 setTimeout(()=>{if(el.isConnected)el.remove()},8500);
}
function pickupQueueHtml(){
 const groups=new Map();
 for(const i of pickupItems){if(!groups.has(i.order_id))groups.set(i.order_id,[]);groups.get(i.order_id).push(i)}
 return '<aside class="pickup-panel" id="pickup-queue"><div class="pickup-panel-head"><h2>🔔 Pickup Queue</h2><span>'+pickupItems.length+' dishes</span></div>'+
 (groups.size?[...groups.entries()].map(([id,items])=>'<section class="pickup-order-card"><div class="pickup-order-head"><strong>'+esc(pickupLabel(items[0]))+'</strong><span>'+items.length+' Ready</span></div>'+
 '<div class="pickup-order-items">'+items.map(i=>'<div class="pickup-mini-card"><div><strong>'+Number(i.quantity)+' × '+esc(i.name)+'</strong><small>Ready '+(i.done_at?warsawClock(i.done_at):'now')+'</small></div><button type="button" data-pickup-ack="'+esc(i.item_id)+'" aria-label="Pick up '+esc(i.name)+'">✓</button></div>').join('')+'</div>'+
 '<button type="button" class="pickup-all" data-pickup-all="'+esc(id)+'">✓ Pick Up All · '+items.length+' dishes</button></section>').join(''):'<p class="muted">No dishes waiting for pickup.</p>')+'</aside>';
}
async function loadPickups(announce=false){
 if(page!=='pos'||!token)return;
 const serial=++pickupSerial;
 try{
  const data=await api('/pos/pickups');
  if(serial!==pickupSerial)return;
  const old=new Set(pickupItems.map(i=>i.item_id)),fresh=(data.items||[]).filter(i=>!old.has(i.item_id));
  const alert=pickupInitialized&&announce&&fresh.length>0;
  pickupItems=data.items||[];pickupInitialized=true;
  const count=document.querySelector('#pickup-count');if(count)count.textContent=String(pickupItems.length);
  if(alert){if(Date.now()-pickupBellAt>1000){pickupChime();pickupBellAt=Date.now()}pickupToast(fresh)}
  if(fohTab==='tickets'&&!itemDialog&&!document.querySelector('#foh-checkout-modal')&&!document.querySelector('#foh-release-modal'))pos();
 }catch(e){console.warn('Pickup sync failed',e)}
}
async function acknowledgePickup(id){
 const b=[...document.querySelectorAll('[data-pickup-ack]')].find(x=>x.dataset.pickupAck===id);
 if(b)b.disabled=true;
 try{await api('/pos/pickups/'+encodeURIComponent(id)+'/ack','POST',{});pickupItems=pickupItems.filter(i=>i.item_id!==id);pos();await loadPickups(false)}
 catch(e){notify('Pickup: '+e.message);await loadPickups(false)}
}
async function acknowledgePickupAll(orderId){
 const btn=[...document.querySelectorAll('[data-pickup-all]')].find(x=>x.dataset.pickupAll===orderId);
 if(btn){btn.disabled=true;btn.textContent='Confirming…'}
 try{
  await api('/pos/pickups/orders/'+encodeURIComponent(orderId)+'/ack-all','POST',{});
  pickupItems=pickupItems.filter(i=>i.order_id!==orderId);
  pos();await loadPickups(false);
 }catch(e){notify('Pick Up All: '+e.message);await loadPickups(false)}
}
function shell(content){document.body.className=page==='kitchen'?'kitchen':'';app.innerHTML=`<header><div><strong>Chicken i Kimchi</strong> · ${esc(labels[page]||'POS')}</div><nav>${Object.keys(labels).map(p=>`<a class="${page===p?'active':''}" href="/${p}">${labels[p]}</a>`).join('')}</nav><div class="toolbar"><span class="status ${connected?'online':'offline'}">● ${connected?'Live':'Connecting / Offline'}</span><button class="alt" id="logout">Log out</button></div></header><main>${content}</main>`;document.querySelector('#logout').onclick=async()=>{if(deviceMode())await fetch('/api/device/logout',{method:'POST',credentials:'same-origin'}).catch(()=>{});sessionStorage.removeItem('ck_token_'+page);token='';disconnect();render()};}
let pairPoll=null;
async function beginPairing(){
 const r=await fetch('/api/device/pair/start',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'}});
 const b=await r.json();if(!r.ok)throw Error(b.error||'Pairing unavailable');
 const box=document.querySelector('#pairing-box');if(!box)return;
 box.innerHTML='<strong>Device pairing code: '+esc(b.code)+'</strong><p>Ask a Back Office administrator to approve this code. Expires in 10 minutes.</p>';
 clearInterval(pairPoll);
 pairPoll=setInterval(async()=>{
  try{
   const response=await fetch('/api/device/pair/status',{credentials:'same-origin'});
   if(response.status===410){clearInterval(pairPoll);box.textContent='Pairing expired. Click Pair this device to try again.';return;}
   if(!response.ok){if(response.status===409||response.status===403){clearInterval(pairPoll);box.textContent='Pairing unavailable. Please request a new code.';}return;}
   const data=await response.json();if(data.status!=='approved')return;
   clearInterval(pairPoll);
   if(data.role!==page){box.textContent='Approved for '+data.role+'. Open the corresponding role page.';return;}
   token=data.token;sessionStorage.setItem('ck_token_'+page,token);await renewDeviceSession();await start();
  }catch(e){console.warn('Pairing check failed',e)}
 },2500);
}
function login(){
 const choices=[{id:'pos',icon:'🧾',name:'Front of House POS',desc:'Sales and open tickets'},{id:'kitchen',icon:'👨‍🍳',name:'Kitchen Display',desc:'Orders and completed dishes'},{id:'admin',icon:'📊',name:'Back Office',desc:'Reports and menu'},{id:'scanner',icon:'📷',name:'Delivery Scanner',desc:'Coming soon'}];
 const selected=choices.find(x=>x.id===page);document.body.className='role-login-body';
 app.innerHTML=`<div class="role-login-screen"><section class="role-login-box"><div class="role-brand"><div class="role-brand-mark">C<span>&</span>K</div><h1>Chicken i Kimchi</h1><p>RESTAURANT MANAGEMENT SYSTEM</p></div><h2>${selected?selected.name:'Select your role'}</h2><p class="role-subtitle">${selected?'Enter your PIN to continue':'Select a role to sign in'}</p><div class="role-selection">${choices.map(r=>`<a class="role-choice ${selected?.id===r.id?'role-selected':''}" href="/${r.id}"><span class="role-icon">${r.icon}</span><span class="role-info"><strong>${r.name}</strong><small>${r.desc}</small></span></a>`).join('')}</div>${selected?`<form id="role-login-form" class="role-pin-section"><label for="pin">PIN</label><input id="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="Enter PIN" required>${['pos','kitchen'].includes(page)?'<label for="device-id">Device ID (optional for existing system)</label><input id="device-id" autocomplete="off" placeholder="Registered device ID"><label for="device-secret">Enrollment secret</label><input id="device-secret" type="password" autocomplete="off" placeholder="Device enrollment secret">':''}<button id="enter" type="submit">Sign in</button><p id="loginerr" class="role-login-error" role="alert"></p></form>`:'<p class="role-login-hint">Each role has its own PIN.</p>'}<div class="role-login-footer">Chicken i Kimchi · Staff Access</div></section></div>`;
 if(['pos','kitchen'].includes(page)){
  const formBox=document.querySelector('#role-login-form');
  formBox.insertAdjacentHTML('beforebegin','<div class="panel"><button type="button" class="alt" id="pair-start">Pair this device via Back Office</button><div id="pairing-box" aria-live="polite"></div></div>');
  document.querySelector('#pair-start').onclick=()=>beginPairing().catch(e=>notify(e.message));
 }
 if(!selected)return;const form=document.querySelector('#role-login-form');form.onsubmit=async e=>{e.preventDefault();const btn=document.querySelector('#enter');btn.disabled=true;btn.textContent='Signing in…';try{const deviceId=document.querySelector('#device-id')?.value.trim()||'',deviceSecret=document.querySelector('#device-secret')?.value.trim()||'';if(Boolean(deviceId)!==Boolean(deviceSecret))throw Error('Enter both device ID and enrollment secret');const deviceLogin=Boolean(deviceId);const r=await fetch(deviceLogin?'/api/device/session':'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:page,pin:document.querySelector('#pin').value,...(deviceLogin?{device_id:deviceId,enrollment_secret:deviceSecret}:{})})});const b=await r.json();if(!r.ok)throw Error(b.error||'Sign-in failed');token=b.token;sessionStorage.setItem('ck_token_'+page,token);await start()}catch(err){document.querySelector('#loginerr').textContent=err.message}finally{btn.disabled=false;btn.textContent='Sign in'}};
}
async function refresh(initial=false){const serial=++kitchenRefreshSerial,epoch=storeEpoch,store=currentDeviceStore?.id;const stale=()=>epoch!==storeEpoch||store!==currentDeviceStore?.id||serial!==kitchenRefreshSerial;try{const previousPosSnapshot=page==='pos'?JSON.stringify([menu,orders,modifierCatalog,tableState]):null;const [m,o,mods]=await Promise.all([api('/menu'),api('/orders'),...(page==='pos'?[api('/menu/modifiers')]:[])]);if(stale())return;menu=m;if(mods)modifierCatalog=mods;if(page==='kitchen'){try{kitchenCategories=await api('/kitchen/categories')}catch(e){console.warn('Kitchen categories unavailable',e)}}if(page==='admin'){try{await loadAdminMenu()}catch(e){console.warn('Menu management sync failed',e)}}if(stale())return;if(page==='kitchen'){
  // Ignore stale overlapping responses and preserve optimistic dish states until save settles.
  if(stale())return;
  for(const order of o)for(const item of order.items||[]){
   if(kitchenPending.has(item.id))item.is_done=kitchenPending.get(item.id)?1:0;
  }
 }
 const current=new Set(o.filter(x=>x.status==='new').map(x=>x.id));const currentItemIds=new Set(o.flatMap(order=>(order.items||[]).map(item=>item.id)));if(page==='kitchen'&&!initial&&o.some(order=>order.status!=='cancelled'&&(order.items||[]).some(item=>!item.is_done&&!lastItemIds.has(item.id))))sound();lastIds=current;lastItemIds=currentItemIds;orders=o;if(page==='pos'){try{const nextTables=await api('/tables');if(stale())return;tableState=nextTables}catch(e){console.warn('Table sync failed',e)}await loadPickups(!initial);if(stale())return}if(page==='pos'&&itemDialog)return;if(page==='pos'&&!initial&&previousPosSnapshot===JSON.stringify([menu,orders,modifierCatalog,tableState]))return;if(page==='admin'&&(document.querySelector('#menu-editor-backdrop:not([hidden])')||document.querySelector('#category-form:not([hidden])')||document.querySelector('#mod-group-form:not([hidden])')||document.querySelector('#mod-option-form:not([hidden])')))return;render()}catch(e){if(stale())return;if(['Unauthorized','Invalid or expired device session','Device revoked or store inactive','Legacy role sessions disabled'].includes(e.message)){token='';disconnect();sessionStorage.removeItem('ck_token_'+page);login()}else notify('Sync failed: '+e.message)}}
let reconnectTimer=null,wsGeneration=0;
function disconnect(){storeEpoch++;kitchenRefreshSerial++;pickupInitialized=false;pickupItems=[];pickupSerial++;document.querySelector('#pickup-toast')?.remove();wsGeneration++;clearTimeout(reconnectTimer);reconnectTimer=null;const old=ws;ws=null;connected=false;if(old){old.onclose=null;old.onerror=null;old.onopen=null;old.onmessage=null;try{old.close()}catch{}}}
function connect(){
 if(!token)return;
 if(ws&&(ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING))return;
 clearTimeout(reconnectTimer);
 const generation=++wsGeneration;
 const proto=location.protocol==='https:'?'wss:':'ws:';
 const socket=new WebSocket(`${proto}//${location.host}/ws`,['ckauth.'+token]);
 ws=socket;
 const current=()=>generation===wsGeneration&&ws===socket;
 socket.onopen=()=>{if(!current())return;connected=true;if(page==='pos'){const status=document.querySelector('header .status');if(status){status.className='status online';status.textContent='● Live'}else render()}else render();refresh();};
 socket.onmessage=e=>{if(!current())return;if(e.data==='pong')return;try{const m=JSON.parse(e.data);if(m.type==='orders'||m.type==='menu'){lastRealtimeMessage=Date.now();refresh()}else if(m.type==='pickup'){lastRealtimeMessage=Date.now();if(page==='pos')loadPickups(true)}else if(m.type==='connected'){lastRealtimeMessage=Date.now()}}catch(err){console.warn('WebSocket message error',err)}};
 socket.onclose=async event=>{if(!current())return;ws=null;connected=false;
 if(event.code===1008&&deviceMode()){
  const recovered=await renewDeviceSession();
  // Renewal can intentionally reload the page after an access change.
  if(generation!==wsGeneration)return;
  if(!recovered){disconnect();token='';sessionStorage.removeItem('ck_token_'+page);menu=[];orders=[];tableState=[];render();return;}
 }
 if(page==='pos'){const status=document.querySelector('header .status');if(status){status.className='status offline';status.textContent='● Connecting / Offline'}else render()}else render();
 reconnectTimer=setTimeout(()=>{if(token&&generation===wsGeneration)connect()},2500)};
 socket.onerror=()=>{if(!current())return;console.warn('Kitchen WebSocket connection error');};
}

function storeBanner(){
 document.querySelector('#v3-current-store')?.remove();
 if(!deviceMode()||!currentDeviceStore||!['pos','kitchen'].includes(page))return;
 const banner=document.createElement('div');
 banner.id='v3-current-store';banner.className='v3-current-store '+(page==='kitchen'?'v3-current-store-kitchen':'');
 banner.innerHTML='<div><small>CURRENT STORE</small><strong>'+esc(currentDeviceStore.name)+'</strong></div><button type="button" id="v3-switch-store" '+(deviceStores.length<2?'disabled':'')+'>Switch store</button>';
 app.prepend(banner);
 banner.querySelector('#v3-switch-store').onclick=()=>{
  const overlay=document.createElement('div');overlay.className='v3-grants-overlay';
  overlay.innerHTML='<section class="v3-grants-dialog" role="dialog" aria-modal="true"><h2>Switch store</h2><p class="muted">Select an authorized restaurant.</p><form id="v3-store-switch-form"><select name="store_id">'+deviceStores.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===currentDeviceStore.id?'selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select><div class="toolbar"><button type="button" id="v3-switch-cancel" class="alt">Cancel</button><button type="submit">Switch store</button></div></form></section>';
  document.body.append(overlay);
  overlay.querySelector('#v3-switch-cancel').onclick=()=>overlay.remove();
  overlay.querySelector('#v3-store-switch-form').onsubmit=e=>{
   e.preventDefault();const selected=new FormData(e.currentTarget).get('store_id');
   if(!deviceStores.some(x=>x.id===selected))return;
   if(selected===currentDeviceStore?.id){overlay.remove();return}
   if(busy){notify('Wait for the current order submission to finish.');return}
   if(page==='pos'&&configuredCart.length&&!confirm('Switching stores will discard the unsent order draft. Continue?'))return;
   // Reload closes the old WebSocket, clears all in-memory order/menu state,
   // and obtains a fresh server-authorized session for the selected store.
   sessionStorage.removeItem('ck_token_'+page);
   localStorage.setItem(lastStoreKey,selected);
   location.reload();
  };
 };
}
function render(){if(!token){login();return}if(page==='pos')pos();else if(page==='kitchen')kitchen();else if(page==='admin')admin();else scanner();storeBanner();}
function categoryButtons(){return `<div class="chips">${['All',...new Set(menu.map(x=>x.category))].map(x=>`<button data-cat="${esc(x)}" class="${category===x?'selected':''}">${esc(x)}</button>`).join('')}</div>`;}

function money(c){return (c/100).toFixed(2)+' zł'}
function itemGroups(id){return modifierCatalog.groups.filter(g=>modifierCatalog.links.some(l=>l.menu_id===id&&l.group_id===g.id))}
function cartUnitPrice(line){const m=menu.find(x=>x.id===line.menu_id);return (m?.price_cents||0)+line.option_ids.reduce((n,id)=>n+(modifierCatalog.options.find(o=>o.id===id)?.price_cents||0),0)}
function openItem(id){saveFields();itemDialog={menu_id:id,quantity:1,option_ids:[],note:''};showItemDialog()}
function itemModal(){if(!itemDialog)return '';const m=menu.find(x=>x.id===itemDialog.menu_id);if(!m)return '';return '<div class="item-dialog-backdrop"><section class="item-dialog" role="dialog" aria-modal="true"><div class="row"><h2>'+esc(m.name)+'</h2><button class="alt" id="item-close">✕</button></div><p class="muted">Base price '+money(m.price_cents)+'</p>'+itemGroups(m.id).map(g=>{const selected=itemDialog.option_ids.filter(id=>modifierCatalog.options.some(o=>o.id===id&&o.group_id===g.id));return '<fieldset class="modifier-fieldset"><legend>'+esc(g.name)+' <small class="muted">'+(g.min_select?'Required':'Optional')+' · '+g.min_select+'–'+g.max_select+'</small></legend>'+modifierCatalog.options.filter(o=>o.group_id===g.id).map(o=>'<label class="modifier-choice"><input type="'+(g.max_select===1?'radio':'checkbox')+'" name="group-'+esc(g.id)+'" value="'+esc(o.id)+'" '+(selected.includes(o.id)?'checked':'')+'><span>'+esc(o.name)+'</span><b>'+(o.price_cents?'+'+money(o.price_cents):'Included')+'</b></label>').join('')+'</fieldset>'}).join('')+'<label>Item note<textarea id="item-note" rows="2" placeholder="Special instructions">'+esc(itemDialog.note)+'</textarea></label><div class="row"><span>Quantity</span><div class="toolbar"><button class="alt" id="item-dec">−</button><b>'+itemDialog.quantity+'</b><button class="alt" id="item-inc">+</button></div></div><button id="item-confirm">Add to order · '+money(((m.price_cents||0)+itemDialog.option_ids.reduce((n,id)=>n+(modifierCatalog.options.find(o=>o.id===id)?.price_cents||0),0))*itemDialog.quantity)+'</button></section></div>'}

function ticketTotal(o){return (o.items||[]).reduce((n,i)=>n+(Number(i.price_cents)||0)*i.quantity,0)}
function activeTickets(){return orders.filter(o=>o.status!=='cancelled'&&(!o.paid_at||!o.kitchen_completed_at||(o.source==='dinein'&&o.table_occupied)))}
function tableTicket(no){return activeTickets().find(o=>o.source==='dinein'&&o.table_no===no&&o.table_occupied)}
function selectTable(no){orderReturnTab='tables';if(configuredCart.length&&!confirm('Discard the current unsent items?'))return;const o=tableTicket(no);table=no;type='dinein';editingOrder=o?.id||'';configuredCart=[];note='';itemDialog=null;pendingKey=crypto.randomUUID();fohTab='order';pos()}
function selectTicket(id){orderReturnTab='tickets';const o=activeTickets().find(o=>o.id===id);if(!o)return notify('Ticket is no longer open');if(o.paid_at)return notify('Already paid · use Release Table');if(configuredCart.length&&!confirm('Discard the current unsent items?'))return;editingOrder=id;type=o.source;table=o.table_no||'01';configuredCart=[];note='';itemDialog=null;pendingKey=crypto.randomUUID();fohTab='order';pos()}
function updateCartView(){const root=document.querySelector('#pos-cart');if(!root)return;root.innerHTML=configuredCart.map((line,i)=>{const m=menu.find(x=>x.id===line.menu_id);return '<div class="foh-cart-line"><div><strong>'+esc(m?.name||'Item')+' × '+line.quantity+'</strong><small>'+esc(line.option_ids.map(id=>modifierCatalog.options.find(o=>o.id===id)?.name||'').filter(Boolean).join(', '))+(line.note?' · '+esc(line.note):'')+'</small></div><div><b>'+money(cartUnitPrice(line)*line.quantity)+'</b><button class="alt" data-remove-line="'+i+'">Remove</button></div></div>'}).join('')||'<p class="muted">Choose a dish to start the order.</p>';root.querySelectorAll('[data-remove-line]').forEach(b=>b.onclick=()=>{configuredCart.splice(Number(b.dataset.removeLine),1);updateCartView()});document.querySelector('#pos-total').textContent=money(configuredCart.reduce((n,line)=>n+cartUnitPrice(line)*line.quantity,0));document.querySelector('#submit').disabled=!configuredCart.length||busy}
function showItemDialog(){document.querySelector('.item-dialog-backdrop')?.remove();if(!itemDialog)return;document.body.insertAdjacentHTML('beforeend',itemModal());const close=()=>{itemDialog=null;document.querySelector('.item-dialog-backdrop')?.remove()};const rerender=()=>{itemDialog.note=document.querySelector('#item-note')?.value||'';showItemDialog()};document.querySelector('#item-close').onclick=close;document.querySelector('.item-dialog-backdrop').addEventListener('click',e=>{if(e.target.classList.contains('item-dialog-backdrop'))close()});document.querySelector('#item-dec').onclick=()=>{itemDialog.quantity=Math.max(1,itemDialog.quantity-1);rerender()};document.querySelector('#item-inc').onclick=()=>{itemDialog.quantity=Math.min(99,itemDialog.quantity+1);rerender()};document.querySelectorAll('.modifier-choice input').forEach(input=>input.onchange=()=>{itemDialog.note=document.querySelector('#item-note').value;const o=modifierCatalog.options.find(x=>x.id===input.value),g=itemGroups(itemDialog.menu_id).find(x=>x.id===o?.group_id);if(!g)return;const ids=itemDialog.option_ids.filter(id=>modifierCatalog.options.find(x=>x.id===id)?.group_id!==g.id);const current=itemDialog.option_ids.filter(id=>modifierCatalog.options.find(x=>x.id===id)?.group_id===g.id);if(g.max_select===1)itemDialog.option_ids=[...ids,...(input.checked?[input.value]:[])];else{const next=input.checked?[...current,input.value]:current.filter(id=>id!==input.value);if(next.length>g.max_select){notify('Maximum '+g.max_select+' selections');input.checked=false;return}itemDialog.option_ids=[...ids,...next]}showItemDialog()});document.querySelector('#item-confirm').onclick=()=>{const groups=itemGroups(itemDialog.menu_id);if(groups.some(g=>{const n=itemDialog.option_ids.filter(id=>modifierCatalog.options.find(o=>o.id===id&&o.group_id===g.id)).length;return n<g.min_select||n>g.max_select})){notify('Please complete required selections');return}itemDialog.note=document.querySelector('#item-note').value;configuredCart.push({...itemDialog});close();updateCartView()}}
function pos(){const active=activeTickets(),selected=active.find(o=>o.id===editingOrder),occupied=new Set(tableState.filter(t=>t.occupied).map(t=>t.number));const tabs='<div class="foh-tabs">'+[['order','New Order'],['tickets','Open Tickets ('+active.length+')'],['tables','Tables'],['history','History']].map(([id,label])=>'<button class="'+(fohTab===id?'active':'')+'" data-foh-tab="'+id+'">'+label+'</button>').join('')+'</div>';
const history='<section class="panel foh-workspace"><h2>Payment History</h2>'+
'<div class="foh-history-filters"><label>Period<select id="pos-history-range">'+[['today','Today'],['yesterday','Yesterday'],['last_three','Last 3 Days']].map(([v,n])=>'<option value="'+v+'" '+(posHistoryRange===v?'selected':'')+'>'+n+'</option>').join('')+'</select></label>'+

'<label>Payment method<select id="pos-history-method">'+[['all','All methods'],['card','Card'],['cash','Cash'],['other','Other']].map(([v,n])=>'<option value="'+v+'" '+(posHistoryMethod===v?'selected':'')+'>'+n+'</option>').join('')+'</select></label>'+
'<label>Search<input id="pos-history-search" placeholder="Table / order ID" value="'+esc(posHistoryQuery)+'"></label><button id="pos-history-find">Apply filters</button></div>'+
'<div class="foh-history-summary"><div><small>Paid orders</small><strong>'+Number(posHistoryResult.total||0)+'</strong></div><div><small>Total sales</small><strong>'+money(posHistoryResult.summary?.total_cents||0)+'</strong></div><div><small>Card</small><strong>'+money(posHistoryResult.summary?.card_cents||0)+'</strong></div><div><small>Cash</small><strong>'+money(posHistoryResult.summary?.cash_cents||0)+'</strong></div><div><small>Other</small><strong>'+money(posHistoryResult.summary?.other_cents||0)+'</strong></div></div>'+

(posHistoryResult.orders.length?posHistoryResult.orders.map(o=>'<button type="button" class="foh-history-row" data-pos-history-detail="'+esc(o.id)+'"><b>'+(o.source==='dinein'?'Table '+esc(o.table_no):esc(sourceName[o.source]||o.source))+'</b> #'+esc(o.id.slice(0,8))+' · '+money(o.amount_cents||0)+' · '+esc(o.method||'Unknown')+'<small>Paid '+posDetailTime(o.paid_at)+' · Kitchen '+(o.kitchen_completed_at?posDetailTime(o.kitchen_completed_at):'Pending')+'</small><span class="foh-history-open">View order details →</span></button>').join(''):'<p class="muted">No payments match these filters.</p>')+
'<div class="toolbar"><button id="pos-history-prev" '+(posHistoryPage<=1?'disabled':'')+'>Previous</button><span>Page '+posHistoryPage+' / '+Math.max(1,Math.ceil(posHistoryResult.total/15))+'</span><button id="pos-history-next" '+(posHistoryPage*15>=posHistoryResult.total?'disabled':'')+'>Next</button></div></section>';
const tables='<section class="panel foh-workspace"><div class="foh-title"><div><h2>Tables</h2><p>Tap an available table to start an order, or an occupied table to continue.</p></div><span class="foh-count">'+occupied.size+' / 20 occupied</span></div><div class="foh-table-grid">'+Array.from({length:20},(_,i)=>{const no=String(i+1).padStart(2,'0'),o=tableTicket(no),conflict=tableState.find(t=>t.number===no)?.conflict;return '<button class="foh-table '+(o?'occupied':'available')+'" data-table-no="'+no+'"><small>TABLE</small><strong>'+no+'</strong><span>'+(conflict?'Check duplicates':o?(o.paid_at?'PAID · ':'Open · ')+money(ticketTotal(o)):'Available')+'</span></button>'+(o&&o.paid_at?'<button class="foh-table-release" data-release-table="'+esc(o.id)+'">Release Table '+no+'</button>':'')}).join('')+'</div></section>';
const tickets='<section class="panel foh-workspace"><div class="foh-title"><div><h2>Open Tickets</h2><p>Live kitchen progress · payment and table release are separate.</p></div></div><div class="foh-ticket-grid">'+active.map(o=>'<article class="foh-ticket"><div class="foh-ticket-top"><strong>'+(o.source==='dinein'?'Table '+esc(o.table_no):esc(sourceName[o.source]||o.source))+'</strong><span class="foh-kitchen-state '+(o.kitchen_completed_at?'ready':o.items.some(i=>i.is_done)?'cooking':Date.now()-Date.parse(o.created_at)>900000?'waiting':'new')+'">'+(o.kitchen_completed_at?'READY':o.items.some(i=>i.is_done)?'COOKING':Date.now()-Date.parse(o.created_at)>900000?'WAITING LONG':'NEW')+'</span></div><small>#'+esc(o.id.slice(0,8))+' · '+(o.items||[]).length+' items</small><div class="foh-progress"><span style="width:'+Math.round(100*(o.items||[]).filter(i=>i.is_done).length/Math.max(1,(o.items||[]).length))+'%"></span></div><small>'+(o.items||[]).filter(i=>i.is_done).length+'/'+(o.items||[]).length+' done</small><details><summary>Dish status</summary><div class="foh-ticket-items">'+(o.items||[]).map(i=>'<div class="foh-ticket-item"><span><strong>'+Number(i.quantity)+' × '+esc(i.name)+'</strong>'+(i.modifiers?.length?'<small>'+esc(i.modifiers.map(m=>m.name).join(', '))+'</small>':'')+(i.note?'<small>'+esc(i.note)+'</small>':'')+'</span><span class="foh-item-status">'+(i.is_done?'✓ Done':'Pending')+'</span></div>').join('')+'</div></details>'+(o.note?'<p class="foh-ticket-note">Note: '+esc(o.note)+'</p>':'')+'<h3>'+money(ticketTotal(o))+'</h3><p class="foh-payment">'+(o.paid_at?'✓ PAID · '+({cash:'💵 Cash',card:'💳 Card',other:'▣ Other'}[o.payment?.method]||'Paid')+' · '+money(o.payment?.amount_cents??ticketTotal(o)):'UNPAID')+'</p><div class="foh-ticket-actions">'+(!o.paid_at?'<button class="alt" data-open-ticket="'+esc(o.id)+'">Add items</button><button data-checkout="'+esc(o.id)+'">Checkout</button>':'')+(o.source==='dinein'&&o.table_occupied?'<button class="alt" data-release-table="'+esc(o.id)+'">Release Table</button>':'')+'</div></article>').join('')+'</div>'+(active.length?'':'<p class="muted">No open tickets.</p>')+pickupQueueHtml()+'</section>';
const order='<div class="layout foh-order"><section><div class="panel"><div class="foh-title"><div><h2>'+(selected?'Add items · '+(selected.source==='dinein'?'Table '+esc(selected.table_no):esc(sourceName[selected.source])):type==='dinein'?'New order · Table '+esc(table):'New '+esc(sourceName[type])+' order')+'</h2><p>'+(selected?'New dishes are sent to the existing kitchen ticket.':'Select dishes and send to kitchen.')+'</p></div>'+(selected?'<button class="alt foh-back-top" id="back-from-add">← Back to '+(orderReturnTab==='tables'?'Tables':'Open Tickets')+'</button>':'')+'</div><div class="toolbar"><select id="type" '+(selected?'disabled':'')+'><option value="dinein" '+(type==='dinein'?'selected':'')+'>Dine-in</option><option value="takeaway" '+(type==='takeaway'?'selected':'')+'>Takeaway</option><option value="delivery" '+(type==='delivery'?'selected':'')+'>Delivery (manual)</option></select>'+(type==='dinein'?'<select id="table" '+(selected?'disabled':'')+'>'+Array.from({length:20},(_,i)=>{const no=String(i+1).padStart(2,'0');return '<option value="'+no+'" '+(table===no?'selected':'')+' '+(occupied.has(no)&&!selected?'disabled':'')+'>Table '+no+(occupied.has(no)&&!selected?' · Occupied':'')+'</option>'}).join('')+'</select>':'')+'</div>'+categoryButtons()+'<div class="menu">'+menu.filter(m=>category==='All'||m.category===category).map(m=>'<button data-configure="'+esc(m.id)+'">'+(m.image_url?'<img class="dish-photo" src="'+esc(m.image_url)+'" alt="" loading="lazy">':'')+'<strong>'+esc(m.name)+'</strong><span class="muted">'+money(m.price_cents)+'</span></button>').join('')+'</div></div></section><aside><div class="panel foh-cart-panel"><h3>'+ (selected?'Additional items':'Current order')+'</h3><div id="pos-cart"></div><label>Order note</label><textarea id="note" rows="3">'+esc(note)+'</textarea><div class="row"><b>New items total</b><b id="pos-total">0.00 zł</b></div><button id="submit"> '+(selected?'Send additional items':'Send to kitchen')+'</button>'+(selected?'<button class="alt" id="checkout-selected">Checkout · '+money(ticketTotal(selected))+'</button>':'')+'<button class="alt" id="clear">Cancel / Back</button></div></aside></div>';
shell('<div class="foh-head"><div><small>FRONT OF HOUSE</small><h1>Restaurant POS</h1><p>Table management, tickets and kitchen orders</p></div><div class="pickup-top-actions"><button type="button" id="pickup-sound">'+(pickupSoundReady?'🔊 Alerts enabled':'🔔 Enable pickup sound')+'</button><button type="button" id="pickup-nav">🔔 Pickup Queue <span id="pickup-count">'+pickupItems.length+'</span></button><span class="foh-count">'+active.length+' open tickets</span></div></div>'+tabs+(fohTab==='tables'?tables:fohTab==='tickets'?tickets:fohTab==='history'?history:order));
document.querySelector('#pickup-sound').onclick=enablePickupSound;
document.querySelector('#pickup-nav').onclick=openPickupQueue;
document.querySelectorAll('[data-pickup-ack]').forEach(b=>b.onclick=()=>acknowledgePickup(b.dataset.pickupAck));
document.querySelectorAll('[data-pickup-all]').forEach(b=>b.onclick=()=>acknowledgePickupAll(b.dataset.pickupAll));
document.querySelectorAll('[data-foh-tab]').forEach(b=>b.onclick=()=>{saveFields();const next=b.dataset.fohTab;if(next===fohTab&&!(next==='order'&&editingOrder))return;if(configuredCart.length&&!confirm('Discard the current unsent items?'))return;editingOrder='';configuredCart=[];note='';itemDialog=null;pendingKey=crypto.randomUUID();fohTab=next;pos();if(next==='history')loadPosHistory()});
if(fohTab==='history'){
 document.querySelectorAll('[data-pos-history-detail]').forEach(btn=>btn.onclick=()=>openPosHistoryDetail(btn.dataset.posHistoryDetail));
 const apply=()=>{
  posHistoryRange=document.querySelector('#pos-history-range').value;
  posHistoryMethod=document.querySelector('#pos-history-method').value;
  posHistoryQuery=document.querySelector('#pos-history-search').value.trim();
  posHistoryPage=1;loadPosHistory();
 };
 document.querySelector('#pos-history-range').onchange=apply;
 document.querySelector('#pos-history-method').onchange=apply;
 document.querySelector('#pos-history-find').onclick=apply;
 document.querySelector('#pos-history-search').onkeydown=e=>{if(e.key==='Enter')apply()};
 document.querySelector('#pos-history-prev').onclick=()=>{posHistoryPage=Math.max(1,posHistoryPage-1);loadPosHistory()};
 document.querySelector('#pos-history-next').onclick=()=>{posHistoryPage++;loadPosHistory()};
}
document.querySelectorAll('[data-release-table]').forEach(btn=>btn.onclick=()=>showReleaseTable(btn.dataset.releaseTable));
document.querySelectorAll('[data-table-no]').forEach(b=>b.onclick=()=>{const o=tableTicket(b.dataset.tableNo);if(o?.paid_at){fohTab='tickets';pos();return}selectTable(b.dataset.tableNo)});
document.querySelectorAll('[data-open-ticket]').forEach(b=>b.onclick=()=>selectTicket(b.dataset.openTicket));
document.querySelectorAll('[data-checkout]').forEach(b=>b.onclick=()=>showCheckout(b.dataset.checkout));
if(fohTab!=='order')return;
document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{category=b.dataset.cat;saveFields();pos()});
document.querySelectorAll('[data-configure]').forEach(b=>b.onclick=()=>openItem(b.dataset.configure));
document.querySelector('#type').onchange=e=>{type=e.target.value;editingOrder='';saveFields();pos()};
document.querySelector('#table')?.addEventListener('change',e=>{table=e.target.value});
document.querySelector('#note').oninput=e=>note=e.target.value;
const leaveOrder=()=>{if(configuredCart.length&&!confirm('Discard the current unsent items?'))return;configuredCart=[];note='';editingOrder='';itemDialog=null;pendingKey=crypto.randomUUID();fohTab=orderReturnTab;pos()};document.querySelector('#clear').onclick=leaveOrder;document.querySelector('#back-from-add')?.addEventListener('click',leaveOrder);
document.querySelector('#submit').onclick=submit;
document.querySelector('#checkout-selected')?.addEventListener('click',()=>showCheckout(editingOrder));
updateCartView();if(itemDialog)showItemDialog();
}
function showReleaseTable(id){
 const o=activeTickets().find(x=>x.id===id&&x.source==='dinein'&&x.table_occupied);
 if(!o)return notify('Table is no longer occupied. Refresh the page.');
 document.querySelector('#foh-release-modal')?.remove();
 const paid=!!o.paid_at,ready=!!o.kitchen_completed_at;
 const modal=document.createElement('div');
 modal.id='foh-release-modal';
 modal.className='foh-release-backdrop';
 modal.innerHTML='<section class="foh-release-dialog" role="dialog" aria-modal="true" aria-labelledby="foh-release-title">'+
  '<div class="foh-release-header"><div class="foh-release-symbol" aria-hidden="true">✓</div><div><h2 id="foh-release-title">Release Table '+esc(o.table_no)+'?</h2><p>Confirm this table is ready for the next guest.</p></div></div>'+
  '<div class="foh-release-details"><div><span>Payment status</span><strong class="'+(paid?'foh-release-paid':'foh-release-unpaid')+'">'+(paid?'PAID':'UNPAID')+'</strong></div>'+
  '<div><span>Order total</span><strong>'+money(ticketTotal(o))+'</strong></div>'+
  '<div><span>Kitchen status</span><strong>'+(ready?'READY':(o.items||[]).some(i=>i.is_done)?'COOKING':'NOT READY')+'</strong></div></div>'+
  (!paid?'<div class="foh-release-warning">⚠ This order has not been paid. Releasing the table does not collect payment or close the order.</div>':'')+
  '<p class="foh-release-note">The table will become available. The order and payment history will be preserved.</p>'+
  '<p class="foh-release-error" id="foh-release-error" role="alert" hidden></p>'+
  '<div class="foh-release-actions"><button type="button" class="foh-release-cancel" id="foh-release-cancel">Cancel</button><button type="button" class="foh-release-confirm" id="foh-release-confirm">✓ Release Table</button></div>'+
  '</section>';
 document.body.appendChild(modal);
 const cancel=modal.querySelector('#foh-release-cancel'),confirmButton=modal.querySelector('#foh-release-confirm'),error=modal.querySelector('#foh-release-error');
 const close=()=>{modal.remove();document.removeEventListener('keydown',onKey)};
 const onKey=e=>{if(e.key==='Escape'&&!confirmButton.disabled)close()};
 document.addEventListener('keydown',onKey);
 cancel.onclick=close;
 modal.onclick=e=>{if(e.target===modal&&!confirmButton.disabled)close()};
 confirmButton.onclick=async()=>{
  if(confirmButton.disabled)return;
  confirmButton.disabled=true;cancel.disabled=true;confirmButton.textContent='Releasing…';error.hidden=true;
  try{
   await api('/orders/'+id+'/release-table','POST',{});
   close();
   notify('Table '+o.table_no+' released · Now available');
   await refresh();
  }catch(e){
   error.textContent='Unable to release table: '+e.message;error.hidden=false;
   confirmButton.disabled=false;cancel.disabled=false;confirmButton.textContent='✓ Release Table';
  }
 };
 cancel.focus();
}
function showCheckout(id){const o=activeTickets().find(x=>x.id===id);if(!o)return notify('Ticket already closed');checkoutId=id;document.querySelector('#foh-checkout-modal')?.remove();const modal=document.createElement('div');modal.id='foh-checkout-modal';modal.className='item-dialog-backdrop';modal.innerHTML='<section class="item-dialog foh-checkout" role="dialog" aria-modal="true"><div class="row"><h2>Checkout</h2><button class="alt" id="checkout-cancel">✕</button></div><p>'+(o.source==='dinein'?'Table '+esc(o.table_no):esc(sourceName[o.source]))+'</p><h1>'+money(ticketTotal(o))+'</h1><p class="muted">Confirm payment received. Table remains occupied until Release Table is clicked.</p><label>Payment method</label><select id="checkout-method"><option value="card">Card</option><option value="cash">Cash</option><option value="other">Other</option></select><button id="checkout-confirm">Confirm payment</button></section>';document.body.append(modal);document.querySelector('#checkout-cancel').onclick=()=>modal.remove();document.querySelector('#checkout-confirm').onclick=async()=>{const btn=document.querySelector('#checkout-confirm');btn.disabled=true;try{await api('/orders/'+id+'/checkout','POST',{method:document.querySelector('#checkout-method').value});modal.remove();notify('Payment recorded · Table not released');if(editingOrder===id){editingOrder='';configuredCart=[];fohTab='tickets'}await refresh()}catch(e){notify('Checkout failed: '+e.message);btn.disabled=false}}}

function saveFields(){const a=document.querySelector('#note'),b=document.querySelector('#table');if(a)note=a.value;if(b)table=b.value;}
async function submit(){
 if(busy)return;
 saveFields();
 const items=configuredCart.map(x=>({menu_id:x.menu_id,quantity:x.quantity,option_ids:x.option_ids,note:x.note}));
 if(!items.length)return;
 const originalStore=currentDeviceStore?.id,epoch=storeEpoch,key=pendingKey,additional=!!editingOrder;
 busy=true;
 try{
  if(additional){await api('/orders/'+editingOrder+'/items','POST',{items});notify('Additional items sent')}
  else{await api('/orders','POST',{source:type,table_no:type==='dinein'?table:'',note,items,client_key:key});notify('Order sent to kitchen')}
  if(epoch!==storeEpoch||originalStore!==currentDeviceStore?.id)return;
  configuredCart=[];note='';editingOrder='';pendingKey=crypto.randomUUID();fohTab='tickets';await refresh();
 }catch(e){
  if(epoch!==storeEpoch||originalStore!==currentDeviceStore?.id)return;
  if(!additional){
   try{
    const check=await api('/orders/by-client-key/'+encodeURIComponent(key));
    if(epoch!==storeEpoch||originalStore!==currentDeviceStore?.id)return;
    if(check.found){
     notify('Order confirmed in this store · #'+check.order.id.slice(0,8));
     configuredCart=[];note='';editingOrder='';pendingKey=crypto.randomUUID();fohTab='tickets';await refresh();return;
    }
    notify('Order not found. Draft preserved; retry uses the same order key.');
   }catch(checkError){notify('Order status unknown. Draft preserved; check tickets before retrying.')}
  }else notify('Additional items status unknown. Check the ticket before retrying.');
 }finally{busy=false}
}
function ticket(o,controls=false){const age=Math.max(0,Math.floor((Date.now()-Date.parse(o.created_at))/60000));return `<article class="ticket ${o.status}"><div class="row"><h3>${esc(o.table_no||sourceName[o.source]||o.source)}</h3><span class="tag ${o.status}">${statusName[o.status]}</span></div><p class="muted small">#${esc(o.id.slice(0,8))} · ${new Date(o.created_at).toLocaleTimeString('pl-PL',{timeZone:'Europe/Warsaw',hour:'2-digit',minute:'2-digit'})} · ${age} min</p><hr>${o.items.map(i=>`<p class="items">${i.quantity} × ${esc(i.name)} ${(i.modifiers||[]).length?`<small> · ${esc(i.modifiers.map(m=>m.name).join(', '))}</small>`:''}${i.note?`<small>(${esc(i.note)})</small>`:''}</p>`).join('')} ${o.note?`<p class="warning">Note: ${esc(o.note)}</p>`:''}${controls&&o.status!=='done'&&o.status!=='cancelled'&&page==='admin'?`<button class="danger" data-status="${o.id}" data-next="cancelled">Admin cancel</button>`:''}</article>`;}
function stats(){return `<div class="stats">${['new','cooking','done'].map(s=>`<div class="stat"><b>${orders.filter(o=>o.status===s).length}</b>${statusName[s]}</div>`).join('')}</div>`;}

function posDetailTime(value){return value?new Date(value).toLocaleString('en-GB',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—'}
function posDetailHtml(data){
 const o=data.order,paid=(data.payments||[]).reduce((sum,p)=>sum+Number(p.amount_cents||0),0);
 const itemRows=data.items.map(i=>'<div class="foh-detail-item"><div><strong>'+Number(i.quantity)+' × '+esc(i.name)+'</strong>'+(i.modifiers.length?'<small>'+esc(i.modifiers.map(m=>m.name).join(', '))+'</small>':'')+(i.note?'<small>Note: '+esc(i.note)+'</small>':'')+'<small>'+(i.is_done?'✓ Done':'Pending')+'</small></div><b>'+(i.price_cents==null?'—':money(Number(i.price_cents)*Number(i.quantity)))+'</b></div>').join('');
 const eventLabels={created:'Order created',paid:'Payment received',kitchen_completed:'Kitchen completed',kitchen_reopened:'Kitchen reopened',table_released:'Table released'};
 const events=[{event:'created',created_at:o.created_at},...(data.events||[])].filter((e,i,arr)=>i===0||e.event!=='created').filter(e=>['created','paid','kitchen_completed','kitchen_reopened','table_released'].includes(e.event));
 return '<div class="foh-detail-backdrop" id="pos-detail-backdrop"><aside class="foh-detail-panel" role="dialog" aria-modal="true" aria-label="Order details"><div class="foh-detail-head"><div><small>PAYMENT HISTORY · ORDER DETAILS</small><h2>'+(o.source==='dinein'?'Table '+esc(o.table_no):esc(sourceName[o.source]||o.source))+'</h2><small>Order #'+esc(o.id)+'</small></div><button class="alt" id="pos-detail-close" aria-label="Close details">✕</button></div><div class="foh-detail-summary"><div><small>Payment</small><strong>'+esc((data.payments||[]).map(p=>({cash:'Cash',card:'Card',other:'Other'}[p.method]||p.method)).join(', ')||'Unknown')+'</strong></div><div><small>Paid total</small><strong>'+money(paid)+'</strong></div></div><h3>Order items</h3>'+itemRows+(o.note?'<p>Order note: '+esc(o.note)+'</p>':'')+'<h3>Payments</h3>'+(data.payments||[]).map(p=>'<div class="foh-detail-line"><span>'+esc(p.method)+' · '+posDetailTime(p.created_at)+'</span><strong>'+money(p.amount_cents)+'</strong></div>').join('')+'<h3>Order timeline</h3>'+events.map(e=>'<div class="foh-detail-line"><span>'+esc(eventLabels[e.event])+'</span><span>'+posDetailTime(e.created_at)+'</span></div>').join('')+'<h3>Current status</h3><p>Kitchen: '+(o.kitchen_completed_at?'Completed '+posDetailTime(o.kitchen_completed_at):'Pending')+'</p><p>Table: '+(o.source!=='dinein'?'Not applicable':o.table_occupied?'Occupied':'Released / not occupied')+'</p><p class="muted small">Read-only history. No changes to payments or dishes.</p></aside></div>';
}
async function openPosHistoryDetail(id){
 if(!posHistoryResult.orders.some(o=>o.id===id))return notify('Order is outside the current history selection.');

 const old=document.querySelector('#pos-detail-backdrop');if(old)old.remove();
 const overlay=document.createElement('div');overlay.id='pos-detail-backdrop';overlay.className='foh-detail-backdrop';overlay.innerHTML='<aside class="foh-detail-panel" role="dialog" aria-modal="true"><p>Loading order details…</p><button class="alt" id="pos-detail-close">Close</button></aside>';
 document.body.appendChild(overlay);
 const close=()=>overlay.remove();
 overlay.onclick=e=>{if(e.target===overlay)close()};
 overlay.querySelector('#pos-detail-close').onclick=close;
 try{
  const data=await api('/pos/history/'+encodeURIComponent(id));
  if(!overlay.isConnected)return;
  const wrap=document.createElement('div');wrap.innerHTML=posDetailHtml(data);
  overlay.replaceWith(wrap.firstElementChild);
  const panel=document.querySelector('#pos-detail-backdrop');
  panel.onclick=e=>{if(e.target===panel)panel.remove()};
  panel.querySelector('#pos-detail-close').onclick=()=>panel.remove();
 }catch(e){if(overlay.isConnected){overlay.querySelector('p').textContent='Unable to load order: '+e.message}}
}
let posHistoryRange='today',posHistoryMethod='all',posHistoryQuery='',posHistoryPage=1,posHistoryResult={orders:[],total:0,summary:{}},posHistoryRequest=0;
function posWarsawDateDaysAgo(days){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 const date=new Date(Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day)-days,12));
 return date.toISOString().slice(0,10);
}
async function loadPosHistory(){
 const request=++posHistoryRequest;
 const params=new URLSearchParams({range:posHistoryRange,method:posHistoryMethod,q:posHistoryQuery,page:String(posHistoryPage)});
 if(posHistoryRange==='last_three'){
  params.set('range','custom');params.set('from',posWarsawDateDaysAgo(2));params.set('to',posWarsawDateDaysAgo(0));
 }
 try{
  const result=await api('/pos/history?'+params.toString());
  if(request!==posHistoryRequest)return;
  posHistoryResult=result;
  if(page==='pos'&&fohTab==='history')pos();
 }catch(e){if(request===posHistoryRequest)notify('History: '+e.message)}
}
let kitchenCategories=[],historyOpen=false,historyRange='today',historyQuery='',historyPage=1,historyResult={orders:[],total:0,page:1,size:15},historyBusy=false,kitchenClock=null,kitchenBusy=new Set(),kitchenPending=new Map(),kitchenCompleting=new Set(),kitchenRefreshSerial=0;
const warsawClock=iso=>new Date(iso).toLocaleTimeString('en-GB',{timeZone:'Europe/Warsaw',hour:'2-digit',minute:'2-digit',second:'2-digit'});
function kitchenAge(iso){return Math.max(0,Math.floor((Date.now()-new Date(iso).getTime())/1000)||0)}
function kitchenDuration(seconds){return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')}
function kitchenAgeBand(seconds){return seconds<120?'blue':seconds<600?'green':seconds<900?'yellow':'red'}
function kitchenSortItems(items){
 const normalized=s=>String(s||'').trim().toLocaleLowerCase();
 const categories=new Map(kitchenCategories.map(c=>[normalized(c.name),Number(c.sort_order)]));
 const dishes=new Map(menu.map(m=>[m.id,m]));
 // Category order is controlled by Back Office; keep a stable fallback for legacy items.
 const fallback=new Map(['sałatki','salatki','przystawki','bokkeum'].map((name,i)=>[name,i]));
 const rank=m=>{
  const category=normalized(m?.category);
  const configured=categories.get(category);
  return Number.isFinite(configured)?configured:100000+(fallback.get(category)??1000);
 };
 const order=m=>Number.isFinite(Number(m?.sort_order))?Number(m.sort_order):999999;
 return [...items].sort((a,b)=>{
  const am=dishes.get(a.menu_id),bm=dishes.get(b.menu_id);
  return rank(am)-rank(bm)||order(am)-order(bm)||
   String(a.created_at).localeCompare(String(b.created_at))||String(a.id).localeCompare(String(b.id));
 });
}
async function loadKitchenHistory(){
 if(!historyOpen||historyBusy)return;
 historyBusy=true;
 try{historyResult=await api('/kitchen/history?range='+encodeURIComponent(historyRange)+'&page='+historyPage+'&q='+encodeURIComponent(historyQuery));}
 catch(e){notify('History: '+e.message)}finally{historyBusy=false}
 kitchen();
}
function updateKitchenClock(){
 document.querySelectorAll('[data-kitchen-age]').forEach(el=>{
  const age=kitchenAge(el.dataset.kitchenAge);
  el.textContent=kitchenDuration(age);
  const head=el.closest('.kds-order-head');if(head)head.dataset.ageBand=kitchenAgeBand(age);
 });
}
function kitchen(){
 const active=orders.filter(o=>o.status!=='cancelled'&&!o.kitchen_completed_at&&!kitchenCompleting.has(o.id)&&o.items.length).sort((a,b)=>a.created_at.localeCompare(b.created_at));
 const card=o=>{
  const done=o.items.filter(i=>i.is_done).length,ready=done===o.items.length;
  const items=kitchenSortItems(o.items);
  return '<article class="ticket kds-order" data-order-id="'+esc(o.id)+'">'+
   '<div class="kds-order-head" data-age-band="'+kitchenAgeBand(kitchenAge(o.created_at))+'">'+
    '<div class="kds-head-row"><h3>'+esc(o.table_no||sourceName[o.source])+'</h3><strong class="kds-age" data-kitchen-age="'+esc(o.created_at)+'">'+kitchenDuration(kitchenAge(o.created_at))+'</strong></div>'+
    '<div class="kds-head-row"><span>Received '+warsawClock(o.created_at)+'</span><span>'+done+'/'+o.items.length+' Done</span></div>'+
    '<div class="kds-head-id">#'+esc(o.id.slice(0,8))+(o.paid_at?' · Paid':'')+'</div>'+
   '</div>'+
   '<button class="kds-complete" data-kitchen-complete="'+esc(o.id)+'" '+(ready?'':'disabled')+'>'+(ready?'✓ COMPLETE ORDER':'COMPLETE ORDER · '+done+'/'+o.items.length)+'</button>'+
   items.map((i,index)=>{const dish=menu.find(m=>m.id===i.menu_id);
    const category=String(dish?.category||'Other').trim()||'Other';
    const previous=index?menu.find(m=>m.id===items[index-1].menu_id):null;
    const previousCategory=String(previous?.category||'Other').trim()||'Other';
    const categoryHeading=index===0||category!==previousCategory?'<div class="kds-category">'+esc(category)+'</div>':'';
    return categoryHeading+'<button class="kds-dish '+(i.is_done?'is-done':'')+'" data-item-done="'+esc(i.id)+'"><span><span class="kds-dish-name">'+i.quantity+' × '+esc(i.name)+'</span>'+
     ((i.modifiers||[]).length?'<small>'+esc(i.modifiers.map(m=>m.name).join(', '))+'</small>':'')+
     (i.note?'<small>'+esc(i.note)+'</small>':'')+
     (new Date(i.created_at).getTime()>new Date(o.created_at).getTime()+30000?'<small class="kds-added">ADDED '+warsawClock(i.created_at)+'</small>':'')+
    '</span><span class="kds-check">'+(i.is_done?'✓':'○')+'</span></button>';
   }).join('')+
   (o.note?'<p class="warning">Note: '+esc(o.note)+'</p>':'')+'</article>';
 };
 shell('<div class="panel toolbar"><button id="sound">'+(beepEnabled?'🔊 Sound enabled':'🔇 Enable new-order sound')+'</button><button class="alt" id="sync">Refresh</button><span class="muted small">Tap anywhere on a dish to toggle Done.</span></div>'+
 '<h2>Active Orders · <span class="kds-active-count">'+active.length+'</span></h2><div class="grid kds-active-grid">'+active.map(card).join('')+'</div>'+(active.length?'':'<div class="empty">No active kitchen orders</div>')+
 '<section class="panel completed-section kds-history"><div class="row"><h3>Completed Orders</h3><button class="alt" id="kds-history-toggle">'+(historyOpen?'Hide history':'View history')+'</button></div>'+
 (historyOpen?'<div class="toolbar"><select id="kds-history-range"><option value="today" '+(historyRange==='today'?'selected':'')+'>Today</option><option value="yesterday" '+(historyRange==='yesterday'?'selected':'')+'>Yesterday</option><option value="all" '+(historyRange==='all'?'selected':'')+'>All</option></select><input id="kds-history-search" placeholder="Table / order ID" value="'+esc(historyQuery)+'"><button class="alt" id="kds-history-search-button">Search</button></div>'+
 '<p class="muted small">'+historyResult.total+' completed'+(historyResult.limited?' (recent history limit)':'')+'</p>'+
 '<div class="kds-history-list">'+historyResult.orders.map(o=>'<div class="kds-history-row"><div><strong>'+esc(o.table_no||sourceName[o.source])+'</strong><small>#'+esc(o.id.slice(0,8))+' · '+warsawClock(o.kitchen_completed_at)+' · '+o.items.length+' dishes</small><details><summary>View dishes</summary>'+o.items.map(i=>'<div>'+i.quantity+' × '+esc(i.name)+'</div>').join('')+'</details></div><button class="alt" data-kitchen-reopen="'+esc(o.id)+'">Reopen</button></div>').join('')+
 (historyResult.orders.length?'':'<p class="muted">No completed orders found</p>')+'</div>'+
 '<div class="toolbar"><button class="alt" id="kds-history-prev" '+(historyPage<=1?'disabled':'')+'>Previous</button><span>Page '+historyPage+'</span><button class="alt" id="kds-history-next" '+(!historyResult.has_more?'disabled':'')+'>Next</button></div>':'<p class="muted small">Completed orders are archived here. Open only when needed.</p>')+'</section>');
 if(kitchenClock)clearInterval(kitchenClock);kitchenClock=setInterval(updateKitchenClock,1000);
 document.querySelector('#sound').onclick=async()=>{audio=audio||new(window.AudioContext||window.webkitAudioContext)();await audio.resume();beepEnabled=true;sound();kitchen()};
 document.querySelector('#sync').onclick=()=>refresh();
 document.querySelectorAll('[data-item-done]').forEach(btn=>btn.onclick=async()=>{
  const id=btn.dataset.itemDone;
  if(kitchenBusy.has(id))return;
  const order=orders.find(o=>(o.items||[]).some(i=>i.id===id));
  const item=order?.items.find(i=>i.id===id);
  if(!item)return;
  kitchenBusy.add(id);
  const previous=!!item.is_done, next=!previous;
  kitchenPending.set(id,next);
  item.is_done=next?1:0;
  btn.classList.toggle('is-done',next);
  const check=btn.querySelector('.kds-check');
  if(check)check.textContent=next?'✓':'○';
  const head=btn.closest('.kds-order')?.querySelector('.kds-head-row:nth-child(2) span:last-child');
  const count=order.items.filter(i=>i.is_done).length;
  if(head)head.textContent=count+'/'+order.items.length+' Done';
  const complete=btn.closest('.kds-order')?.querySelector('[data-kitchen-complete]');
  if(complete){const ready=count===order.items.length;complete.disabled=!ready;complete.textContent=ready?'✓ COMPLETE ORDER':'COMPLETE ORDER · '+count+'/'+order.items.length}
  btn.blur();
  try{
   await api('/order-items/'+id+'/done','PATCH',{});
   // Fetch confirmed server state before releasing the optimistic override.
   const confirmed=await api('/orders');
   const saved=confirmed.flatMap(o=>o.items||[]).find(i=>i.id===id);
   if(saved&&!!saved.is_done===next){
    kitchenPending.delete(id);
    // A later refresh uses the server value, never an older in-flight response.
    await refresh();
   }else{await refresh();}
  }catch(e){
   kitchenPending.delete(id);
   item.is_done=previous?1:0;
   notify('Could not save dish: '+e.message);
   await refresh();
  }finally{kitchenBusy.delete(id)}
 });
 document.querySelectorAll('[data-kitchen-complete]').forEach(btn=>btn.onclick=async()=>{
  const id=btn.dataset.kitchenComplete;
  if(btn.disabled||kitchenCompleting.has(id))return;
  const order=orders.find(o=>o.id===id);
  if(!order||order.kitchen_completed_at||!(order.items||[]).length||order.items.some(i=>!i.is_done))return;
  kitchenCompleting.add(id);
  btn.blur();
  // Immediate tactile feedback; hide only this ticket, not the whole kitchen.
  const card=btn.closest('.kds-order');
  if(card){card.classList.add('kds-completing');card.setAttribute('aria-busy','true')}
  btn.disabled=true;
  btn.textContent='✓ COMPLETING…';
  try{
   await api('/kitchen/orders/'+id+'/complete','POST',{});
   order.kitchen_completed_at=new Date().toISOString();
   card?.remove();
   const count=document.querySelector('.kds-active-count');
   if(count)count.textContent=String(Math.max(0,Number(count.textContent)-1));
   await refresh();
   if(historyOpen)await loadKitchenHistory();
  }catch(e){
   notify('Complete order failed: '+e.message);
   if(card){card.classList.remove('kds-completing');card.removeAttribute('aria-busy')}
   btn.disabled=false;btn.textContent='✓ COMPLETE ORDER';
  }finally{kitchenCompleting.delete(id)}
 });
 document.querySelector('#kds-history-toggle').onclick=()=>{historyOpen=!historyOpen;kitchen();if(historyOpen)loadKitchenHistory()};
 if(historyOpen){
  document.querySelector('#kds-history-range').onchange=e=>{historyRange=e.target.value;historyPage=1;loadKitchenHistory()};
  document.querySelector('#kds-history-search-button').onclick=()=>{historyQuery=document.querySelector('#kds-history-search').value.trim();historyPage=1;loadKitchenHistory()};
  document.querySelector('#kds-history-search').onkeydown=e=>{if(e.key==='Enter')document.querySelector('#kds-history-search-button').click()};
  document.querySelector('#kds-history-prev').onclick=()=>{historyPage=Math.max(1,historyPage-1);loadKitchenHistory()};
  document.querySelector('#kds-history-next').onclick=()=>{historyPage++;loadKitchenHistory()};
  document.querySelectorAll('[data-kitchen-reopen]').forEach(btn=>btn.onclick=async()=>{
   if(!confirm('Reopen this completed order in the kitchen?'))return;
   btn.disabled=true;
   try{await api('/kitchen/orders/'+btn.dataset.kitchenReopen+'/reopen','POST',{});await refresh();await loadKitchenHistory()}
   catch(e){notify(e.message);btn.disabled=false}
  });
 }
}
function bindStatus(){document.querySelectorAll('[data-status]').forEach(b=>b.onclick=async()=>{const id=b.dataset.status,next=b.dataset.next;if(next==='cancelled'&&!confirm('Cancel this order?'))return;try{await api('/orders/'+id+'/status','PATCH',{status:next});await refresh()}catch(e){notify(e.message)}});}
let adminModifiers={groups:[],options:[],links:[]},adminMenu=[],adminCategories=[],adminEditing=null,adminImage='',adminTab='menu',adminFilter='',adminUploadBusy=false;
async function loadAdminMenu(){const [items,cats,mods]=await Promise.all([api('/menu/all'),api('/categories'),api('/modifiers')]);adminMenu=items;adminCategories=cats;adminModifiers=mods;}
async function uploadAdminImage(file){
 if(!file)return;
 if(!file.type.startsWith('image/')&&!/\.(heic|heif|avif|jpe?g|png|webp|gif|bmp|tiff?)$/i.test(file.name))throw Error('Select an image file');
 let image;
 try{image=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{throw Error('This browser cannot decode this image. Try JPG, PNG or AVIF.');}
 try{
  const scale=Math.min(1,1200/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image processing unavailable');
  ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.8));
  if(!blob||blob.type!=='image/webp')throw Error('WebP conversion is not supported by this browser');
  if(blob.size>5*1024*1024)throw Error('Converted WebP exceeds 5 MB');
  const r=await fetch('/api/menu/images',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'image/webp'},body:blob});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Upload failed');return data.image_url;
 }finally{image.close();}
}
let v3Stores=[],v3SelectedStore='',v3StoreMenu=[],v3Devices=[],v3StoreError='',v3Loaded=false;
async function loadV3Stores(){
 try{const [stores,devices]=await Promise.all([api('/admin/stores'),api('/admin/devices')]);v3Stores=stores.stores||[];v3Devices=devices.devices||[];v3StoreError='';v3Loaded=true;if(!v3Stores.some(x=>x.id===v3SelectedStore))v3SelectedStore=v3Stores[0]?.id||'';if(v3SelectedStore)await loadV3StoreMenu();}
 catch(e){v3StoreError=e.message;v3Loaded=true;}
}
async function loadV3StoreMenu(){if(!v3SelectedStore)return;const data=await api('/admin/stores/'+encodeURIComponent(v3SelectedStore)+'/menu');v3StoreMenu=data.items||[];}
function v3StorePanel(){
 return '<section class="admin-workspace"><h2>V3 · Store Management</h2><p class="muted">Store configuration is locked until staging verification. TEST orders are excluded from real-store reporting by default.</p>'+
 (v3StoreError?'<p class="warning">'+esc(v3StoreError)+'</p>':'')+
 '<button type="button" class="alt" id="v3-load-stores">Refresh stores</button>'+
 '<label>Store <select id="v3-store-select">'+v3Stores.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===v3SelectedStore?'selected':'')+'>'+esc(x.name)+' ('+esc(x.code)+') · '+(x.active?'Active':'Inactive')+'</option>').join('')+'</select></label>'+
 '<div class="admin-dish-list">'+v3StoreMenu.map(m=>'<div class="admin-dish"><div class="admin-dish-info"><strong>'+esc(m.name)+'</strong><small>'+esc(m.category)+' · Base '+money(m.base_price_cents)+' · '+(m.sold_out?'Sold out':'Available')+'</small></div><label>Store price (PLN)<input type="number" min="0" max="100000" step=".01" data-v3-price="'+esc(m.id)+'" value="'+(m.override_price_cents===null?'':(m.override_price_cents/100).toFixed(2))+'" placeholder="Use base price"></label><label>Status<select data-v3-active="'+esc(m.id)+'"><option value="inherit" '+(m.override_active===null?'selected':'')+'>Inherit</option><option value="true" '+(m.override_active===1?'selected':'')+'>Active</option><option value="false" '+(m.override_active===0?'selected':'')+'>Inactive</option></select></label><label>Sold out<input type="checkbox" data-v3-sold="'+esc(m.id)+'" '+(m.sold_out?'checked':'')+'></label><button type="button" class="alt" data-v3-save="'+esc(m.id)+'">Save</button></div>').join('')+'</div>'+
 '<div class="toolbar"><button type="button" class="alt" id="v3-toggle-store" '+(!v3SelectedStore?'disabled':'')+'>'+((v3Stores.find(x=>x.id===v3SelectedStore)?.active)?'Deactivate store':'Activate store')+'</button></div>'+
 '<h3>Approve a restaurant device</h3><p class="muted">On the restaurant tablet choose Pair this device. Enter its six-digit code and your secondary approval password here.</p><form id="v3-pair-approve" class="admin-inline-form"><label>Pairing code<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required placeholder="6-digit code"></label><label>Device name<input name="label" required maxlength="100" placeholder="Kitchen tablet 1"></label><label>Role<select name="role"><option value="pos">POS</option><option value="kitchen">Kitchen</option></select></label><fieldset class="v3-store-grants"><legend>Allowed stores</legend>'+v3Stores.filter(x=>x.active).map(x=>'<label><input type="checkbox" name="store_ids" value="'+esc(x.id)+'" '+(x.id===v3SelectedStore?'checked':'')+'> '+esc(x.name)+'</label>').join('')+'</fieldset><label>Secondary password<input name="secondary_pin" type="password" autocomplete="off" required></label><button type="submit">Approve device</button></form>'+'<h3>Registered devices</h3><form id="v3-device-form" class="admin-inline-form"><label>New device label<input id="v3-device-label" maxlength="100" required placeholder="e.g. Kitchen tablet 1"></label><button type="submit" '+(!v3SelectedStore?'disabled':'')+'>Register device</button></form><div id="v3-device-credential" class="admin-inline-form" hidden></div><div class="admin-dish-list">'+v3Devices.map(d=>'<div class="admin-dish"><div><strong>'+esc(d.label)+'</strong><small>'+esc(d.id)+' · '+(d.active?'Active':'Revoked')+'</small></div>'+(d.active?'<button type="button" class="alt" data-v3-grants="'+esc(d.id)+'">Allowed stores</button><button type="button" class="alt" data-v3-revoke="'+esc(d.id)+'">Revoke</button>':'')+'</div>').join('')+'</div></section>';
}
function admin(){
 const filtered=adminMenu.filter(m=>!adminFilter||m.category===adminFilter);
 const cats=adminCategories.map(c=>'<option value="'+esc(c.name)+'">'+esc(c.name)+'</option>').join('');
 const categoryCards=adminCategories.map(c=>'<div class="category-card"><div><strong>'+esc(c.name)+'</strong><small>'+c.item_count+' dishes · Position '+c.sort_order+'</small></div><div class="toolbar"><button type="button" class="alt" data-cat-edit="'+esc(c.id)+'">Edit</button><button type="button" class="alt" data-cat-delete="'+esc(c.id)+'" '+(c.item_count?'disabled title="Move dishes before deleting"':'')+'>Delete</button></div></div>').join('');
 const menuRows=filtered.map(m=>'<div class="admin-dish"><div class="admin-dish-media">'+(m.image_url?'<img src="'+esc(m.image_url)+'" loading="lazy" alt="">':'🍽️')+'</div><div class="admin-dish-info"><strong>'+esc(m.name)+'</strong><small>'+esc(m.category)+' · VAT '+m.vat_rate+'% · Sort '+m.sort_order+'</small><span class="admin-pill '+(m.active?'':'inactive')+'">'+(m.active?'Active':'Inactive')+'</span></div><b>'+((m.price_cents||0)/100).toFixed(2)+' zł</b><button type="button" class="alt" data-menu-edit="'+esc(m.id)+'">Edit</button><button type="button" class="alt admin-delete-dish" data-menu-delete="'+esc(m.id)+'">Delete</button></div>').join('');
 shell('<div class="admin-head"><div><span class="admin-eyebrow">RESTAURANT CONTROL CENTER</span><h1>Back Office</h1><p>Manage your dishes, categories and orders.</p></div><button class="alt" id="sync">Refresh data</button></div>'+
 '<div class="admin-overview">'+['new','cooking','done'].map(k=>'<div class="admin-metric"><strong>'+orders.filter(o=>o.status===k).length+'</strong><span>'+statusName[k]+' orders</span></div>').join('')+'<div class="admin-metric"><strong>'+adminMenu.length+'</strong><span>Menu items</span></div></div>'+
 '<div class="admin-tabs"><button data-admin-tab="menu" class="'+(adminTab==='menu'?'selected':'')+'">Menu items</button><button data-admin-tab="categories" class="'+(adminTab==='categories'?'selected':'')+'">Categories</button><button data-admin-tab="modifiers" class="'+(adminTab==='modifiers'?'selected':'')+'">Modifiers</button><button data-admin-tab="orders" class="'+(adminTab==='orders'?'selected':'')+'">Orders</button><button data-admin-tab="stores" class="'+(adminTab==='stores'?'selected':'')+'">Stores (V3)</button></div>'+
 '<section class="admin-workspace" '+(adminTab==='menu'?'':'hidden')+'><div class="admin-section-head"><div><h2>Menu items</h2><p>Edit dishes, photos, prices and availability.</p></div><button id="addmenu">+ Add dish</button></div><div class="admin-filter"><label>Filter by category <select id="admin-category-filter"><option value="">All categories</option>'+cats+'</select></label><span>'+filtered.length+' dishes</span></div><div class="admin-dish-list">'+(menuRows||'<div class="admin-empty">No dishes in this category.</div>')+'</div></section>'+
 '<section class="admin-workspace" '+(adminTab==='categories'?'':'hidden')+'><div class="admin-section-head"><div><h2>Categories</h2><p>Changes to a category name update its dishes automatically.</p></div><button id="addcategory">+ Add category</button></div><div class="admin-category-list">'+(categoryCards||'<div class="admin-empty">No categories yet.</div>')+'</div><form id="category-form" class="admin-inline-form" hidden><h3 id="category-title">New category</h3><div class="menu-form-grid"><label>Category name<input id="category-name" maxlength="50" required></label><label>Display position<input id="category-sort" type="number" value="0" step="1" required></label></div><div class="toolbar"><button type="submit" id="category-save">Save category</button><button type="button" class="alt" id="category-cancel">Cancel</button></div></form></section>'+
 '<section class="admin-workspace" '+(adminTab==='modifiers'?'':'hidden')+'><div class="admin-section-head"><div><h2>Modifiers</h2><p>Manage groups, options and dish assignments.</p></div><button id="mod-new-group">+ Add group</button></div><div id="mod-group-list">'+adminModifiers.groups.map(g=>'<div class="modifier-group-card"><div class="row"><strong>'+esc(g.name)+'</strong><button class="alt" data-mod-edit-group="'+esc(g.id)+'">Edit</button></div><p class="muted small">Choose '+g.min_select+' to '+g.max_select+' · '+(g.active?'Active':'Inactive')+'</p>'+adminModifiers.options.filter(o=>o.group_id===g.id).map(o=>'<div class="row"><span>'+esc(o.name)+' · +'+(o.price_cents/100).toFixed(2)+' zł '+(o.active?'':'(Inactive)')+'</span><button class="alt" data-mod-edit-option="'+esc(o.id)+'">Edit</button></div>').join('')+'<button class="alt" data-mod-new-option="'+esc(g.id)+'">+ Add option</button></div>').join('')+'</div><div class="admin-inline-form"><h3>Apply modifier group to dishes</h3><p class="muted">Choose a modifier group, then select all applicable dishes. Saving changes only this group.</p><label>Modifier group<select id="mod-assign-group"><option value="">Choose a group</option>'+adminModifiers.groups.map(g=>'<option value="'+esc(g.id)+'">'+esc(g.name)+'</option>').join('')+'</select></label><div class="toolbar"><input id="mod-search" placeholder="Search dishes" aria-label="Search dishes"><select id="mod-category-filter"><option value="">All categories</option>'+adminCategories.map(c=>'<option value="'+esc(c.name)+'">'+esc(c.name)+'</option>').join('')+'</select></div><div class="row"><span id="mod-selected-count" class="muted">Choose a group</span><div class="toolbar"><button class="alt" type="button" id="mod-select-all" disabled>Select all visible</button><button class="alt" type="button" id="mod-clear-visible" disabled>Clear visible</button></div></div><div id="mod-dish-list" class="modifier-dish-list"></div><button id="mod-save-links" disabled>Save dish assignments</button></div><form id="mod-group-form" class="admin-inline-form" hidden><h3>Modifier group</h3><div class="menu-form-grid"><label>Name<input id="mod-group-name" required maxlength="100"></label><label>Minimum selections<input id="mod-group-min" type="number" min="0" max="20" required></label><label>Maximum selections<input id="mod-group-max" type="number" min="1" max="20" required></label><label>Status<select id="mod-group-active"><option value="1">Active</option><option value="0">Inactive</option></select></label></div><button type="submit">Save group</button><button type="button" class="alt" id="mod-cancel-group">Cancel</button></form><form id="mod-option-form" class="admin-inline-form" hidden><h3>Modifier option</h3><div class="menu-form-grid"><label>Name<input id="mod-option-name" required maxlength="100"></label><label>Extra price PLN<input id="mod-option-price" type="number" min="0" step=".01" required></label><label>Status<select id="mod-option-active"><option value="1">Active</option><option value="0">Inactive</option></select></label></div><button type="submit">Save option</button><button type="button" class="alt" id="mod-cancel-option">Cancel</button></form></section>'+'<section class="admin-workspace" '+(adminTab==='orders'?'':'hidden')+'><div class="admin-section-head"><div><h2>Orders</h2><p>Monitor active and recent kitchen tickets.</p></div></div><h3>Open tickets</h3><div class="grid">'+orders.filter(o=>o.status==='new'||o.status==='cooking').map(o=>ticket(o)).join('')+'</div><details><summary>Recent completed orders</summary><div class="grid">'+orders.filter(o=>!['new','cooking'].includes(o.status)).map(o=>ticket(o)).join('')+'</div></details></section>'+
 '<div '+(adminTab==='stores'?'':'hidden')+'>'+v3StorePanel()+'</div>'+'<div id="menu-editor-backdrop" class="admin-modal-backdrop" hidden><section id="menu-editor" class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title"><div class="admin-modal-head"><div><span class="admin-eyebrow">MENU EDITOR</span><h2 id="editor-title">Add dish</h2></div><button type="button" class="alt" id="menu-cancel">Close</button></div><form id="menu-form"><div class="menu-form-grid"><label>Dish name<input id="menu-name" required maxlength="100"></label><label>Category<select id="menu-category" required><option value="">Select category</option>'+cats+'</select></label><label>Gross price (PLN)<input id="menu-price" required type="number" min="0" max="100000" step=".01"></label><label>VAT rate<select id="menu-vat"><option value="8">8%</option><option value="23">23%</option><option value="5">5%</option><option value="0">0%</option></select></label><label>Sort order<input id="menu-sort" type="number" step="1" value="0"></label><label>Availability<select id="menu-active"><option value="1">Active</option><option value="0">Inactive</option></select></label></div><div class="menu-upload"><label>Dish photo · converted to WebP<input id="menu-image-file" type="file" accept="image/*,.heic,.heif,.avif"></label><img id="menu-image-preview" class="admin-preview" hidden alt="Dish preview"><button type="button" class="alt" id="menu-image-remove">Remove photo</button><p class="muted small" id="menu-upload-status"></p></div><div class="admin-modal-actions"><button id="menu-save" type="submit">Save dish</button><button type="button" class="alt" id="menu-cancel-bottom">Cancel</button></div></form></section></div>');
 document.querySelector('#sync').onclick=()=>refresh();
 document.querySelectorAll('[data-admin-tab]').forEach(el=>el.onclick=()=>{adminTab=el.dataset.adminTab;if(adminTab==='stores'&&!v3Loaded){loadV3Stores().then(()=>admin());}admin()});
 document.querySelector('#v3-toggle-store').onclick=async()=>{
  const store=v3Stores.find(x=>x.id===v3SelectedStore);if(!store||store.code==='TEST'&&store.active){notify('TEST store must remain active');return;}
  if(!confirm((store.active?'Deactivate ':'Activate ')+store.name+'?'))return;
  try{await api('/admin/stores/'+encodeURIComponent(store.id)+'/config','PATCH',{active:!store.active});await loadV3Stores();admin();notify('Store status updated')}catch(err){notify(err.message)}
 };
 document.querySelector('#v3-pair-approve').onsubmit=async e=>{
  e.preventDefault();const f=e.currentTarget,btn=f.querySelector('button[type=submit]');btn.disabled=true;
  try{
   const formData=new FormData(f);
   const store_ids=formData.getAll('store_ids').map(String);
   if(!store_ids.length)throw Error('Select at least one active store');
   const data=Object.fromEntries(formData);
   await api('/admin/device-pairings/approve','POST',{...data,store_ids});
   f.reset();v3Devices=(await api('/admin/devices')).devices||[];
   notify('Device approved. Tablet will sign in automatically.');
  }catch(err){notify('Approval failed: '+err.message)}finally{btn.disabled=false}
 };
 document.querySelectorAll('[data-v3-grants]').forEach(button=>button.onclick=async()=>{
  const id=button.dataset.v3Grants;
  try{
   const current=await api('/admin/devices/'+encodeURIComponent(id)+'/stores');
   const granted=new Set((current.stores||[]).map(x=>x.id));
   const overlay=document.createElement('div');
   overlay.className='v3-grants-overlay';
   overlay.innerHTML='<section class="v3-grants-dialog" role="dialog" aria-modal="true"><h2>Allowed stores</h2><p class="muted">Choose the stores this device can access.</p><form id="v3-grants-editor">'+v3Stores.filter(x=>x.active).map(x=>'<label><input type="checkbox" name="store_ids" value="'+esc(x.id)+'" '+(granted.has(x.id)?'checked':'')+'> '+esc(x.name)+'</label>').join('')+'<label>Secondary password<input type="password" name="secondary_pin" autocomplete="off" required></label><div class="toolbar"><button type="button" id="v3-grants-cancel" class="alt">Cancel</button><button type="submit">Save access</button></div></form></section>';
   document.body.append(overlay);
   overlay.querySelector('#v3-grants-cancel').onclick=()=>overlay.remove();
   overlay.querySelector('#v3-grants-editor').onsubmit=async e=>{
    e.preventDefault();const ids=new FormData(e.currentTarget).getAll('store_ids').map(String);
    if(!ids.length){notify('Select at least one store');return;}
    const save=e.currentTarget.querySelector('[type=submit]');save.disabled=true;
    try{const secondary_pin=String(new FormData(e.currentTarget).get('secondary_pin')||'');await api('/admin/devices/'+encodeURIComponent(id)+'/stores','PUT',{store_ids:ids,secondary_pin});overlay.remove();notify('Device store access updated.');}
    catch(err){notify('Update failed: '+err.message)}finally{save.disabled=false;}
   };
  }catch(err){notify('Unable to load access: '+err.message)}
 });
 document.querySelector('#v3-device-form').onsubmit=async e=>{
  e.preventDefault();const label=document.querySelector('#v3-device-label').value.trim();if(!label||!v3SelectedStore)return;
  const btn=e.currentTarget.querySelector('[type=submit]');btn.disabled=true;
  try{
   const result=await api('/admin/devices','POST',{store_id:v3SelectedStore,label});
   const target=document.querySelector('#v3-device-credential');target.hidden=false;target.replaceChildren();
   const title=document.createElement('strong');title.textContent='Copy these credentials now; the secret is shown only once.';
   const field=document.createElement('textarea');field.readOnly=true;field.rows=4;field.value='Device ID: '+result.id+String.fromCharCode(10)+'Enrollment secret: '+result.enrollment_secret;
   const copy=document.createElement('button');copy.type='button';copy.textContent='Copy credentials';copy.onclick=()=>navigator.clipboard.writeText(field.value).then(()=>notify('Copied')).catch(()=>notify('Copy failed'));
   target.append(title,field,copy);v3Devices=(await api('/admin/devices')).devices||[];
   notify('Device registered. Save the secret before leaving this page.');
  }catch(err){notify(err.message)}finally{btn.disabled=false}
 };
 document.querySelectorAll('[data-v3-revoke]').forEach(btn=>btn.onclick=async()=>{
  if(!confirm('Revoke this device? Existing sessions will stop working.'))return;
  btn.disabled=true;try{await api('/admin/devices/'+encodeURIComponent(btn.dataset.v3Revoke)+'/revoke','POST');v3Devices=(await api('/admin/devices')).devices||[];admin();notify('Device revoked')}catch(err){notify(err.message);btn.disabled=false}
 });
 document.querySelector('#v3-load-stores').onclick=async()=>{await loadV3Stores();admin()};
 document.querySelector('#v3-store-select').onchange=async e=>{v3SelectedStore=e.target.value;try{await loadV3StoreMenu();admin()}catch(err){notify(err.message)}};
 document.querySelectorAll('[data-v3-save]').forEach(btn=>btn.onclick=async()=>{
  const id=btn.dataset.v3Save,price=document.querySelector('[data-v3-price="'+id+'"]').value.trim(),active=document.querySelector('[data-v3-active="'+id+'"]').value,sold=document.querySelector('[data-v3-sold="'+id+'"]').checked;
  const cents=price===''?null:Math.round(Number(price)*100);
  if(cents!==null&&(!Number.isSafeInteger(cents)||cents<0||cents>10000000)){notify('Invalid price');return;}
  btn.disabled=true;
  try{await api('/admin/stores/'+encodeURIComponent(v3SelectedStore)+'/menu/'+encodeURIComponent(id),'PUT',{price_cents:cents,active:active==='inherit'?null:active==='true',sold_out:sold});await loadV3StoreMenu();admin();notify('Store menu updated')}
  catch(err){notify(err.message);btn.disabled=false}
 });
 const filter=document.querySelector('#admin-category-filter');filter.value=adminFilter;filter.onchange=()=>{adminFilter=filter.value;admin()};
 
 let selectedGroup=null,selectedOption=null,selectedOptionGroup=null;
 const mg=document.querySelector('#mod-group-form'),mo=document.querySelector('#mod-option-form');
 function groupEditor(g){selectedGroup=g?.id||null;mg.hidden=false;mo.hidden=true;document.querySelector('#mod-group-name').value=g?.name||'';document.querySelector('#mod-group-min').value=g?.min_select??0;document.querySelector('#mod-group-max').value=g?.max_select??1;document.querySelector('#mod-group-active').value=String(g?.active??1);mg.scrollIntoView({block:'nearest'})}
 document.querySelector('#mod-new-group').onclick=()=>groupEditor(null);
 document.querySelectorAll('[data-mod-edit-group]').forEach(b=>b.onclick=()=>groupEditor(adminModifiers.groups.find(g=>g.id===b.dataset.modEditGroup)));
 document.querySelector('#mod-cancel-group').onclick=()=>mg.hidden=true;
 mg.onsubmit=async e=>{e.preventDefault();const btn=mg.querySelector('[type=submit]');btn.disabled=true;try{const data={name:document.querySelector('#mod-group-name').value.trim(),min_select:Number(document.querySelector('#mod-group-min').value),max_select:Number(document.querySelector('#mod-group-max').value),active:Number(document.querySelector('#mod-group-active').value)};await api(selectedGroup?'/modifiers/groups/'+selectedGroup:'/modifiers/groups',selectedGroup?'PATCH':'POST',data);await loadAdminMenu();admin();notify('Group saved')}catch(err){notify(err.message)}finally{btn.disabled=false}};
 function optionEditor(o,g){selectedOption=o?.id||null;selectedOptionGroup=g||o?.group_id;mo.hidden=false;mg.hidden=true;document.querySelector('#mod-option-name').value=o?.name||'';document.querySelector('#mod-option-price').value=o?(o.price_cents/100).toFixed(2):'0';document.querySelector('#mod-option-active').value=String(o?.active??1);mo.scrollIntoView({block:'nearest'})}
 document.querySelectorAll('[data-mod-new-option]').forEach(b=>b.onclick=()=>optionEditor(null,b.dataset.modNewOption));
 document.querySelectorAll('[data-mod-edit-option]').forEach(b=>b.onclick=()=>optionEditor(adminModifiers.options.find(o=>o.id===b.dataset.modEditOption)));
 document.querySelector('#mod-cancel-option').onclick=()=>mo.hidden=true;
 mo.onsubmit=async e=>{e.preventDefault();const btn=mo.querySelector('[type=submit]');btn.disabled=true;try{const data={group_id:selectedOptionGroup,name:document.querySelector('#mod-option-name').value.trim(),price_cents:Math.round(Number(document.querySelector('#mod-option-price').value)*100),active:Number(document.querySelector('#mod-option-active').value)};await api(selectedOption?'/modifiers/options/'+selectedOption:'/modifiers/options',selectedOption?'PATCH':'POST',data);await loadAdminMenu();admin();notify('Option saved')}catch(err){notify(err.message)}finally{btn.disabled=false}};

 const assignGroup=document.querySelector('#mod-assign-group'),assignList=document.querySelector('#mod-dish-list'),assignSave=document.querySelector('#mod-save-links'),assignSearch=document.querySelector('#mod-search'),assignCategory=document.querySelector('#mod-category-filter'),assignCount=document.querySelector('#mod-selected-count'),assignAll=document.querySelector('#mod-select-all'),assignClear=document.querySelector('#mod-clear-visible');
 let assignedIds=new Set(),assignDirty=false;
 function visibleDishes(){const term=assignSearch.value.trim().toLocaleLowerCase();return adminMenu.filter(m=>(!assignCategory.value||m.category===assignCategory.value)&&(!term||m.name.toLocaleLowerCase().includes(term))).sort((a,b)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name))}
 function renderAssignments(){const groupId=assignGroup.value,visible=visibleDishes();assignSave.disabled=!groupId||!assignDirty;assignAll.disabled=assignClear.disabled=!groupId;assignCount.textContent=groupId?assignedIds.size+' of '+adminMenu.length+' dishes selected'+(assignDirty?' · Unsaved changes':''):'Choose a group';assignList.innerHTML=groupId?visible.map(m=>'<label class="modifier-link"><input type="checkbox" data-assigned-dish="'+esc(m.id)+'" '+(assignedIds.has(m.id)?'checked':'')+'><span>'+esc(m.name)+'</span><small class="muted">'+esc(m.category)+'</small></label>').join('')||'<p class="muted">No dishes match the filter.</p>':'<p class="muted">Select a group to manage its dishes.</p>';assignList.querySelectorAll('[data-assigned-dish]').forEach(el=>el.onchange=()=>{if(el.checked)assignedIds.add(el.dataset.assignedDish);else assignedIds.delete(el.dataset.assignedDish);assignDirty=true;renderAssignments()})}
 assignGroup.onchange=()=>{assignedIds=new Set(adminModifiers.links.filter(l=>l.group_id===assignGroup.value).map(l=>l.menu_id));assignDirty=false;renderAssignments()};
 assignSearch.oninput=renderAssignments;assignCategory.onchange=renderAssignments;
 assignAll.onclick=()=>{visibleDishes().forEach(m=>assignedIds.add(m.id));assignDirty=true;renderAssignments()};
 assignClear.onclick=()=>{visibleDishes().forEach(m=>assignedIds.delete(m.id));assignDirty=true;renderAssignments()};
 assignSave.onclick=async()=>{assignSave.disabled=true;try{await api('/modifiers/assign','PUT',{group_id:assignGroup.value,menu_ids:[...assignedIds]});await loadAdminMenu();assignedIds=new Set(adminModifiers.links.filter(l=>l.group_id===assignGroup.value).map(l=>l.menu_id));assignDirty=false;renderAssignments();notify('Dish assignments saved')}catch(err){notify('Save failed: '+err.message);renderAssignments()}};
 renderAssignments();
 let editingCategory=null;
 const catForm=document.querySelector('#category-form');
 function openCategory(c){editingCategory=c?.id||null;catForm.hidden=false;document.querySelector('#category-title').textContent=c?'Edit category':'New category';document.querySelector('#category-name').value=c?.name||'';document.querySelector('#category-sort').value=c?.sort_order??adminCategories.length*10;document.querySelector('#category-name').focus()}
 document.querySelector('#addcategory').onclick=()=>openCategory(null);
 document.querySelectorAll('[data-cat-edit]').forEach(el=>el.onclick=()=>openCategory(adminCategories.find(c=>c.id===el.dataset.catEdit)));
 document.querySelector('#category-cancel').onclick=()=>{catForm.hidden=true};
 document.querySelectorAll('[data-cat-delete]').forEach(el=>el.onclick=async()=>{const c=adminCategories.find(x=>x.id===el.dataset.catDelete);if(!c||!confirm('Delete empty category "'+c.name+'"?'))return;try{await api('/categories/'+c.id,'DELETE');await loadAdminMenu();admin()}catch(e){notify(e.message)}});
 catForm.onsubmit=async e=>{e.preventDefault();const btn=document.querySelector('#category-save');btn.disabled=true;try{const data={name:document.querySelector('#category-name').value.trim(),sort_order:Number(document.querySelector('#category-sort').value)};await api(editingCategory?'/categories/'+editingCategory:'/categories',editingCategory?'PATCH':'POST',data);await loadAdminMenu();admin();notify('Category saved')}catch(err){notify(err.message)}finally{btn.disabled=false}};
 function closeEditor(){document.querySelector('#menu-editor-backdrop').hidden=true;adminEditing=null;adminImage='';adminUploadBusy=false;admin()}
 function openEditor(m){adminEditing=m?.id||null;adminImage=m?.image_url||'';document.querySelector('#menu-editor-backdrop').hidden=false;document.querySelector('#editor-title').textContent=m?'Edit dish':'Add dish';document.querySelector('#menu-name').value=m?.name||'';document.querySelector('#menu-category').value=m?.category||adminCategories[0]?.name||'';document.querySelector('#menu-price').value=m?(m.price_cents/100).toFixed(2):'';document.querySelector('#menu-vat').value=String(m?.vat_rate??8);document.querySelector('#menu-sort').value=m?.sort_order??0;document.querySelector('#menu-active').value=String(m?.active??1);const preview=document.querySelector('#menu-image-preview');preview.hidden=!adminImage;preview.src=adminImage||'';document.querySelector('#menu-image-file').value='';document.querySelector('#menu-upload-status').textContent='';document.querySelector('#menu-name').focus()}
 document.querySelector('#addmenu').onclick=()=>{if(!adminCategories.length){adminTab='categories';admin();notify('Create a category first');return}openEditor(null)};
 document.querySelectorAll('[data-menu-edit]').forEach(el=>el.onclick=()=>openEditor(adminMenu.find(m=>m.id===el.dataset.menuEdit)));
 document.querySelectorAll('[data-menu-delete]').forEach(el=>el.onclick=async()=>{const dish=adminMenu.find(m=>m.id===el.dataset.menuDelete);if(!dish)return;if(!confirm('Delete "'+dish.name+'"?\\n\\nDishes with historical orders will be archived (hidden from POS) to preserve order records. This cannot be undone for dishes without order history.'))return;el.disabled=true;try{const result=await api('/menu/'+dish.id,'DELETE');await loadAdminMenu();admin();notify(result.archived?'Dish archived and hidden from POS':'Dish deleted')}catch(err){notify('Delete failed: '+err.message);el.disabled=false}});
 document.querySelector('#menu-cancel').onclick=closeEditor;
 document.querySelector('#menu-cancel-bottom').onclick=closeEditor;
 document.querySelector('#menu-image-remove').onclick=()=>{adminImage='';document.querySelector('#menu-image-preview').hidden=true;document.querySelector('#menu-image-file').value=''};
 document.querySelector('#menu-image-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;adminUploadBusy=true;const save=document.querySelector('#menu-save');save.disabled=true;const label=document.querySelector('#menu-upload-status');label.textContent='Uploading photo…';try{const url=await uploadAdminImage(file);adminImage=url;const preview=document.querySelector('#menu-image-preview');preview.src=url;preview.hidden=false;label.textContent='Photo uploaded'}catch(err){label.textContent='Upload failed: '+err.message;notify(err.message)}finally{adminUploadBusy=false;save.disabled=false}};
 document.querySelector('#menu-form').onsubmit=async e=>{e.preventDefault();if(adminUploadBusy)return;const btn=document.querySelector('#menu-save');btn.disabled=true;try{const price=Number(document.querySelector('#menu-price').value),sort=Number(document.querySelector('#menu-sort').value);if(!Number.isFinite(price)||price<0||!Number.isInteger(sort))throw Error('Invalid price or sort order');const data={name:document.querySelector('#menu-name').value.trim(),category:document.querySelector('#menu-category').value,price_cents:Math.round(price*100),vat_rate:Number(document.querySelector('#menu-vat').value),sort_order:sort,active:Number(document.querySelector('#menu-active').value),image_url:adminImage};if(!data.name||!data.category)throw Error('Name and category are required');await api(adminEditing?'/menu/'+adminEditing:'/menu',adminEditing?'PATCH':'POST',data);await loadAdminMenu();adminEditing=null;adminImage='';admin();notify('Dish saved')}catch(err){notify('Save failed: '+err.message)}finally{btn.disabled=false}};
}
function scanner(){shell(`<div class="panel"><h2>Delivery Scanner (coming soon)</h2><p>Future support for delivery-platform order scanning.</p><div class="warning"><strong>Not available: </strong>Scanning and AI recognition are not enabled in this version.</div><p class="muted">Enter delivery orders manually in the POS for now.</p><a href="/pos">Go to POS</a></div>`);}
function chooseInitialStore(){
 if(!storeSelectionPending||deviceStores.length<2)return false;
 disconnect();
 document.body.className='role-login-body';
 app.innerHTML='<div class="role-login-screen"><section class="role-login-box"><div class="role-brand"><div class="role-brand-mark">C<span>&</span>K</div><h1>Chicken i Kimchi</h1></div><h2>Choose your store</h2><p class="role-subtitle">Select the restaurant for this device. You can switch later.</p><form id="v3-first-store-form"><label>Authorized store<select name="store_id" required><option value="">Select a store</option>'+deviceStores.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('')+'</select></label><button type="submit">Continue</button></form></section></div>';
 app.querySelector('#v3-first-store-form').onsubmit=e=>{
  e.preventDefault();const selected=String(new FormData(e.currentTarget).get('store_id')||'');
  if(!deviceStores.some(x=>x.id===selected))return;
  localStorage.setItem(lastStoreKey,selected);
  sessionStorage.removeItem('ck_token_'+page);
  location.reload();
 };
 return true;
}
async function start(){if(chooseInitialStore())return;try{await refresh(true);connect()}catch(e){notify(e.message)}}
(async()=>{if(['pos','kitchen'].includes(page))await renewDeviceSession();if(token)start();else login()})();
setInterval(async()=>{if(deviceMode())await renewDeviceSession()},15*60*1000);setInterval(()=>{if(token&&connected&&ws?.readyState===1)ws.send('ping')},25000);// Kitchen must never depend solely on WebSocket delivery.
// Poll every 5s as a fallback; WebSocket still refreshes immediately.
let kitchenSyncBusy=false;
setInterval(async()=>{if(!token||page!=='kitchen'||document.hidden||kitchenSyncBusy)return;kitchenSyncBusy=true;try{await refresh()}finally{kitchenSyncBusy=false}},5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&token&&page==='kitchen')refresh()});
window.addEventListener('focus',()=>{if(token&&page==='kitchen')refresh()});
setInterval(()=>{if(token&&page!=='kitchen')refresh()},60000);
