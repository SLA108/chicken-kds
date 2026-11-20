const page=location.pathname.replace('/','')||'home';const labels={pos:'Front of House',kitchen:'Kitchen Display',admin:'Back Office'};const app=document.querySelector('#app');let token=sessionStorage.getItem('ck_token_'+page)||'',menu=[],orders=[],cart={},ws=null,connected=false,category='All',type='dinein',table='01',note='',lastIds=new Set(),lastItemIds=new Set(),audio=null,beepEnabled=false,editingOrder='',pendingKey=crypto.randomUUID(),busy=false,modifierCatalog={groups:[],options:[],links:[]},configuredCart=[],itemDialog=null,fohTab='order',orderReturnTab='tickets',tableState=[],followupPaidOrderId='',checkoutId='',checkoutMethod='card',lastRealtimeMessage=0;const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const statusName={new:'Pending',cooking:'In progress',done:'Done',cancelled:'Cancelled'};const sourceName={dinein:'Dine-in',takeaway:'Takeaway',delivery:'Delivery'};
const deviceMode=()=>token.startsWith('cks1.');
function scopedApiPath(path){
 if(!deviceMode())return path;
 if(!['pos','kitchen'].includes(page))return path;
 if(path==='/kitchen/assembly-checks'||path.startsWith('/kitchen/assembly-checks/'))return '/store'+path;
 if(path==='/pos/pickups'||path.startsWith('/pos/pickups/'))return '/store'+path.slice('/pos'.length);
 if(/^\/platform-orders\/[^/]+\/edit$/.test(path)||(path==='/platform-orders/history'||path.startsWith('/platform-orders/history?'))||path==='/platform-orders/collection'||/^\/platform-orders\/[^/]+\/collect$/.test(path)||path==='/quick-orders'||path==='/kitchen/dag'||path==='/quick-order/menu'||path.startsWith('/quick-order/menu?'))return '/store'+path;
 if(path.startsWith('/platform-orders/history/')||path==='/menu'||path==='/orders'||path==='/tables'||path==='/menu/modifiers'||path==='/kitchen/categories'||path==='/reservations'||path.startsWith('/reservations?'))return '/store'+path;
 if(/^\/(?:orders|order-items|reservations|pos\/pickups|kitchen\/orders)\//.test(path))return '/store'+path;
 if(path.startsWith('/pos/history')||path.startsWith('/kitchen/history'))return '/store'+path;
 throw Error('Device mode does not permit this endpoint: '+path);
}
let deviceStores=[],currentDeviceStore=null,renewalPending=null,storeSelectionPending=false,storeEpoch=0;
const pendingCheckoutIds=new Set();
const lastStoreKey='ck_last_store_'+page;
async function renewDeviceSession(){
 if(!['pos','kitchen'].includes(page))return false;
 if(renewalPending)return renewalPending;
 renewalPending=(async()=>{
  try{
   const preferredStore=localStorage.getItem(lastStoreKey);
   const request=storeId=>fetch('/api/device/renew',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(storeId?{role:page,store_id:storeId}:{role:page})});
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
   deviceStores=result.stores||[];currentDeviceStore=result.store||null;window.__attendanceStoreId=currentDeviceStore?.id||'';
   storeSelectionPending=!localStorage.getItem(lastStoreKey)&&deviceStores.length>1;
   if(oldStoreId&&currentDeviceStore?.id!==oldStoreId){
    // Never silently enter another restaurant when the old grant is revoked.
    disconnect();
    token='';sessionStorage.removeItem('ck_token_'+page);
    if(deviceStores.length>1){
     localStorage.removeItem(lastStoreKey);
     storeSelectionPending=true;
     chooseInitialStore();
     return false;
    }
    if(!currentDeviceStore){login();return false}
    localStorage.setItem(lastStoreKey,currentDeviceStore.id);
    location.reload();
    return false;
   }
   if(storeSelectionPending){
    // Do not expose a default-store bearer token until the employee chooses.
    token='';sessionStorage.removeItem('ck_token_'+page);
    return true;
   }
   if(currentDeviceStore)localStorage.setItem(lastStoreKey,currentDeviceStore.id);
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
const toastStyle=document.createElement('style');
toastStyle.textContent='.ck-toast-stack{position:fixed;right:16px;bottom:16px;z-index:3200;width:min(370px,calc(100vw - 32px));display:flex;flex-direction:column;gap:9px;pointer-events:none}.ck-toast{pointer-events:auto;position:relative;display:grid;grid-template-columns:4px minmax(0,1fr) 26px;gap:12px;align-items:start;background:#1e293b!important;color:#f8fafc!important;border:1px solid #475569;border-radius:12px;padding:12px 12px 12px 0;box-shadow:0 12px 32px #0006;animation:ck-toast-in .2s ease-out;min-width:0}.ck-toast:focus-visible{outline:2px solid #93c5fd}.ck-toast-accent{height:100%;min-height:38px;border-radius:6px;background:var(--toast-accent,#60a5fa)}.ck-toast-body{display:grid;gap:4px;min-width:0}.ck-toast-title{font-weight:750;font-size:14px;color:#fff;line-height:1.3}.ck-toast-message{font-size:13px;color:#cbd5e1;overflow-wrap:anywhere;line-height:1.4}.ck-toast-close{background:transparent!important;border:0!important;color:#cbd5e1!important;padding:2px!important;min-width:0!important;min-height:24px!important;cursor:pointer}.ck-toast-brand{display:inline-block;padding:3px 7px;border-radius:5px;font-size:11px;font-weight:800;margin-bottom:4px;background:var(--toast-brand,#64748b);color:var(--toast-ink,#fff)}@keyframes ck-toast-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}@media(max-width:600px){.ck-toast-stack{right:10px;left:10px;bottom:10px;width:auto}.ck-toast{padding:10px 10px 10px 0}}@media(prefers-reduced-motion:reduce){.ck-toast{animation:none}}';
document.head.append(toastStyle);
function notify(message,options={}){
 const text=String(message??'');
 const kind=options.kind||(/failed|error|unavailable|invalid|blocked|unauthorized/i.test(text)?'error':/warning|changed|refresh|overdue/i.test(text)?'warning':/success|created|updated|recorded|saved/i.test(text)?'success':'info');
 const colors={success:'#34d399',warning:'#fbbf24',error:'#fb7185',info:'#60a5fa'};
 let stack=document.querySelector('#ck-toast-stack');
 if(!stack){stack=document.createElement('div');stack.id='ck-toast-stack';stack.className='ck-toast-stack';stack.setAttribute('aria-live','polite');document.body.append(stack);}
 const el=document.createElement('div');el.className='ck-toast';el.style.setProperty('--toast-accent',colors[kind]||colors.info);
 const brand=options.platform&&typeof platformBrand==='function'?platformBrand(options.platform):null;
 if(brand){el.style.setProperty('--toast-brand',brand.color);el.style.setProperty('--toast-ink',brand.ink);}
 const body=document.createElement('div');body.className='ck-toast-body';
 if(brand){const tag=document.createElement('span');tag.className='ck-toast-brand';tag.textContent=brand.name;body.append(tag);}
 const title=document.createElement('div');title.className='ck-toast-title';title.textContent=options.title||({success:'Success',warning:'Notice',error:'Action failed',info:'Notification'}[kind]);body.append(title);
 const description=document.createElement('div');description.className='ck-toast-message';description.textContent=text;body.append(description);
 const accent=document.createElement('span');accent.className='ck-toast-accent';el.append(accent,body);
 const close=document.createElement('button');close.type='button';close.className='ck-toast-close';close.textContent='×';close.setAttribute('aria-label','Dismiss notification');close.onclick=e=>{e.stopPropagation();el.remove()};el.append(close);
 if(typeof options.onClick==='function'){el.style.cursor='pointer';el.setAttribute('role','button');el.tabIndex=0;el.onclick=e=>{if(e.target===close)return;options.onClick();el.remove()};el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();options.onClick();el.remove()}};}
 stack.append(el);while(stack.children.length>4)stack.firstElementChild.remove();
 setTimeout(()=>el.remove(),options.duration||3800);
}
const kitchenPlatformAlertSeen=new Set();
function notifyKitchenPlatformOrder(data){
 if(page!=='pos'||!data?.id||kitchenPlatformAlertSeen.has(data.id))return;
 kitchenPlatformAlertSeen.add(data.id);
 if(kitchenPlatformAlertSeen.size>300)kitchenPlatformAlertSeen.delete(kitchenPlatformAlertSeen.values().next().value);
 const brand=platformBrand(data.platform);
 notify((Number(data.dishes)||0)+' portions · #'+String(data.external_order_id||data.id.slice(0,8)),{kind:'info',title:'New platform order from Kitchen',platform:data.platform,duration:6000,onClick:()=>{fohTab='platform';pos();loadPlatformWorkspace()}});
 if(pickupSoundReady)pickupChime();
}

function sound(){if(!beepEnabled||!audio)return;try{const t=audio.currentTime;const osc=audio.createOscillator(),gain=audio.createGain();osc.type='sine';osc.frequency.setValueAtTime(880,t);osc.frequency.setValueAtTime(660,t+.17);gain.gain.setValueAtTime(.15,t);gain.gain.exponentialRampToValueAtTime(.001,t+.4);osc.connect(gain).connect(audio.destination);osc.start(t);osc.stop(t+.4)}catch{}}
let pickupItems=[],pickupInitialized=false,pickupSerial=0,pickupSoundReady=false,pickupBellAt=0;
function pickupLabel(i){return i.source==='dinein'?'Table '+i.table_no:(sourceName[i.source]||i.source||'Takeaway')}
function enablePickupSound(){
 try{
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass)throw Error('Audio is not supported by this browser');
  audio=audio||new AudioContextClass();
  // Start sound synchronously inside the tap gesture (important for iOS Safari).
  pickupSoundReady=true;
  pickupChime();
  const resumePromise=audio.resume();
  const button=document.querySelector('#pickup-sound');
  if(button)button.textContent='🔊 Alerts enabled · Tap to test';
  Promise.resolve(resumePromise).then(()=>{
   if(audio.state!=='running'){pickupSoundReady=false;notify('Sound is blocked. Check device volume and browser audio settings.')}
  }).catch(e=>{pickupSoundReady=false;notify('Audio unavailable: '+e.message)});
 }catch(e){pickupSoundReady=false;notify('Audio unavailable: '+e.message)}
}
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
function shell(content){document.body.className=page==='kitchen'?'kitchen':'';if((page==='pos'||page==='kitchen')&&app.querySelector(':scope > header')&&app.querySelector(':scope > main')){const main=app.querySelector(':scope > main');main.innerHTML=content;const status=app.querySelector(':scope > header .status');if(status){const live=connected;const nextClass='status '+(live?'online':'offline');const nextText=live?'● Live':'● Connecting / Offline';if(status.className!==nextClass)status.className=nextClass;if(status.textContent!==nextText)status.textContent=nextText;}storeBanner();return;}app.innerHTML=`<header><div class="ck-header-brand"><img class="ck-header-logo" src="/chicken-i-kimchi-logo-web.webp" alt="" onerror="this.hidden=true"><span><strong>Chicken i Kimchi</strong> · ${esc(labels[page]||'POS')}</span></div><nav>${Object.keys(labels).map(p=>`<a class="${page===p?'active':''}" href="/${p}">${labels[p]}</a>`).join('')}</nav><div class="toolbar"><span class="status ${page==='admin'?'online':connected?'online':'offline'}">● ${page==='admin'?'Back Office':connected?'Live':'Connecting / Offline'}</span><button class="alt" id="logout">Log out</button></div></header><main>${content}</main>`;document.querySelector('#logout').onclick=async()=>{if(deviceMode()){if(!confirm('This device will stay paired. Return to the staff sign-in screen?'))return;sessionStorage.removeItem('ck_token_'+page);token='';disconnect();await renewDeviceSession();if(token)start();else login();return;}sessionStorage.removeItem('ck_token_'+page);token='';disconnect();render()};storeBanner();}
let pairPoll=null;
async function beginPairing(){
 const r=await fetch('/api/device/pair/start?role='+encodeURIComponent(page),{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'}});
 const b=await r.json();if(!r.ok)throw Error(b.error||'Pairing unavailable');
 const box=document.querySelector('#pairing-box');if(!box)return;
 box.innerHTML='<strong>Device pairing code: '+esc(b.code)+'</strong><p>Ask a Back Office administrator to approve this code. Expires in 10 minutes.</p>';
 clearInterval(pairPoll);
 pairPoll=setInterval(async()=>{
  try{
   const response=await fetch('/api/device/pair/status?role='+encodeURIComponent(page),{credentials:'same-origin'});
   if(response.status===410){clearInterval(pairPoll);box.textContent='Pairing expired. Click Pair this device to try again.';return;}
   if(!response.ok){const failure=await response.json().catch(()=>({}));if([400,401,403,409].includes(response.status)){clearInterval(pairPoll);box.textContent=(failure.error||'Pairing unavailable')+'. Click Pair this device to request a new code.';}else{box.textContent='Waiting for approval · Connection issue ('+response.status+'). Retrying automatically.';}return;}
   const data=await response.json();if(data.status!=='approved')return;
   clearInterval(pairPoll);
   if(data.role!==page){box.textContent='Approved for '+data.role+'. Open the corresponding role page.';return;}
   token=data.token;sessionStorage.setItem('ck_token_'+page,token);await renewDeviceSession();await start();
  }catch(e){console.warn('Pairing check failed',e)}
 },2500);
}
function login(){
 const choices=[{id:'pos',icon:'🧾',name:'Front of House POS',desc:'Sales and open tickets'},{id:'kitchen',icon:'👨‍🍳',name:'Kitchen Display',desc:'Orders and completed dishes'},{id:'admin',icon:'📊',name:'Back Office',desc:'Reports and menu'}];
 const selected=choices.find(x=>x.id===page);document.body.className='role-login-body';
 app.innerHTML=`<div class="role-login-screen"><section class="role-login-box"><div class="role-brand"><img class="role-brand-logo" src="/chicken-i-kimchi-logo-web.webp" alt="Chicken i Kimchi logo"><h1>Chicken i Kimchi</h1><p>RESTAURANT MANAGEMENT SYSTEM</p></div><h2>${selected?selected.name:'Select your role'}</h2><p class="role-subtitle">${selected?(['pos','kitchen'].includes(page)?'Pair this device through Back Office':'Enter your PIN to continue'):'Select a role to sign in'}</p><div class="role-selection">${choices.map(r=>`<a class="role-choice ${selected?.id===r.id?'role-selected':''}" href="/${r.id}"><span class="role-icon">${r.icon}</span><span class="role-info"><strong>${r.name}</strong><small>${r.desc}</small></span></a>`).join('')}</div>${selected&&!['pos','kitchen'].includes(page)?`<form id="role-login-form" class="role-pin-section"><label for="pin">PIN</label><input id="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="Enter PIN" required><button id="enter" type="submit">Sign in</button><p id="loginerr" class="role-login-error" role="alert"></p></form>`:'<p class="role-login-hint">POS and Kitchen devices require Back Office pairing.</p>'}<div class="role-login-footer">Chicken i Kimchi · Staff Access</div></section></div>`;
 if(['pos','kitchen'].includes(page)){
  const box=document.querySelector('.role-selection');
  box.insertAdjacentHTML('afterend','<div class="panel"><button type="button" class="alt" id="pair-start">Pair this device via Back Office</button><div id="pairing-box" aria-live="polite"></div></div>');
  document.querySelector('#pair-start').onclick=()=>beginPairing().catch(e=>notify(e.message));
  return;
 }
 if(!selected)return;const form=document.querySelector('#role-login-form');form.onsubmit=async e=>{e.preventDefault();const btn=document.querySelector('#enter');btn.disabled=true;btn.textContent='Signing in…';try{const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:page,pin:document.querySelector('#pin').value})});const b=await r.json();if(!r.ok)throw Error(b.error||'Sign-in failed');token=b.token;sessionStorage.setItem('ck_token_'+page,token);await start()}catch(err){document.querySelector('#loginerr').textContent=err.message}finally{btn.disabled=false;btn.textContent='Sign in'}};
}
async function refresh(initial=false){const serial=++kitchenRefreshSerial,epoch=storeEpoch,store=currentDeviceStore?.id;const stale=()=>epoch!==storeEpoch||store!==currentDeviceStore?.id||serial!==kitchenRefreshSerial;try{if(page==='admin'){await loadAdminMenu();if(stale())return;menu=adminMenu;if(document.querySelector('#menu-editor-backdrop:not([hidden])')||document.querySelector('#category-form:not([hidden])')||document.querySelector('#mod-group-form:not([hidden])')||document.querySelector('#mod-option-form:not([hidden])'))return;render();return;}const previousPosSnapshot=page==='pos'?JSON.stringify([menu,orders,modifierCatalog,tableState]):null;const [m,o,mods]=await Promise.all([api('/menu'),api('/orders'),...(page==='pos'?[api('/menu/modifiers')]:[])]);if(stale())return;menu=m;if(mods)modifierCatalog=mods;if(page==='kitchen'){try{kitchenCategories=await api('/kitchen/categories')}catch(e){console.warn('Kitchen categories unavailable',e)}}if(page==='admin'){try{await loadAdminMenu()}catch(e){console.warn('Menu management sync failed',e)}}if(stale())return;if(page==='kitchen'){
  // Ignore stale overlapping responses and preserve optimistic dish states until save settles.
  if(stale())return;
  for(const order of o)for(const item of order.items||[]){
   if(kitchenPending.has(item.id))item.is_done=kitchenPending.get(item.id)?1:0;
  }
 }
 const current=new Set(o.filter(x=>x.status==='new').map(x=>x.id));const currentItemIds=new Set(o.flatMap(order=>(order.items||[]).map(item=>item.id)));if(page==='kitchen'&&!initial&&o.some(order=>order.status!=='cancelled'&&(order.items||[]).some(item=>!item.is_done&&!lastItemIds.has(item.id))))sound();const incomingSuperPos=page==='pos'&&!initial?o.filter(order=>order.status!=='cancelled'&&(superPosPendingIds.has(order.id)||!orders.some(previous=>previous.id===order.id))):[];lastIds=current;lastItemIds=currentItemIds;syncPlatformReadyIndicators(o);if(page==='pos')for(const order of o){if(posVoidedTicketIds.has(order.id))order.status='cancelled';}orders=o;if(page==='kitchen'&&kitchenView==='dag')loadKitchenProduction();if(page==='pos')for(const order of orders){if(pendingCheckoutIds.has(order.id))order.paid_at=order.paid_at||new Date().toISOString()}queueSuperPosAlerts(incomingSuperPos,initial);if(page==='pos'){try{const nextTables=await api('/tables');if(stale())return;tableState=nextTables}catch(e){console.warn('Table sync failed',e)}await loadPickups(!initial);if(stale())return}if(page==='pos'&&itemDialog)return;if(page==='pos'&&!initial&&previousPosSnapshot===JSON.stringify([menu,orders,modifierCatalog,tableState]))return;if(page==='admin'&&(document.querySelector('#menu-editor-backdrop:not([hidden])')||document.querySelector('#category-form:not([hidden])')||document.querySelector('#mod-group-form:not([hidden])')||document.querySelector('#mod-option-form:not([hidden])')))return;render()}catch(e){if(stale())return;if(['Unauthorized','Invalid or expired device session','Device revoked or store inactive','Legacy role sessions disabled'].includes(e.message)){token='';disconnect();sessionStorage.removeItem('ck_token_'+page);login()}else notify('Sync failed: '+e.message)}}
let superPosAlertQueue=[],superPosAlertSeen=new Set(),superPosAlertActive=null,superPosPendingIds=new Set();
function showSuperPosAlert(){
 if(page!=='pos'||superPosAlertActive||!superPosAlertQueue.length)return;
 const order=superPosAlertQueue.shift();superPosAlertActive=order.id;
 const el=document.createElement('div');el.id='super-pos-alert';el.className='super-pos-alert-overlay';
 const title=order.source==='dinein'?'Table '+(order.table_no||''):sourceName[order.source]||'New order';
 const count=(order.items||[]).reduce((n,i)=>n+Number(i.quantity||0),0);
 el.innerHTML='<section class="super-pos-alert-card" role="alertdialog" aria-modal="true" aria-labelledby="super-pos-alert-title"><div class="super-pos-alert-icon">🔔</div><div class="super-pos-alert-kicker">BACK OFFICE · INCOMING ORDER</div><h2 id="super-pos-alert-title">New order received!</h2><p class="super-pos-alert-subtitle">'+esc(title)+' · '+count+' items · #'+esc(order.id.slice(0,8))+'</p><div class="super-pos-alert-preview">'+(order.items||[]).slice(0,4).map(i=>'<div><span>'+Number(i.quantity)+' × '+esc(i.name)+'</span></div>').join('')+((order.items||[]).length>4?'<small>+ more items</small>':'')+'</div><div class="super-pos-alert-actions"><button type="button" id="super-pos-alert-view">View in Open Tickets</button><button type="button" class="alt" id="super-pos-alert-dismiss">Dismiss</button></div></section>';
 document.body.append(el);
 const close=view=>{el.remove();superPosAlertActive=null;if(view){saveFields();fohTab='tickets';editingOrder='';pos();}showSuperPosAlert();};
 el.querySelector('#super-pos-alert-view').onclick=()=>close(true);
 el.querySelector('#super-pos-alert-dismiss').onclick=()=>close(false);
 el.querySelector('#super-pos-alert-view').focus();
 if(pickupSoundReady)pickupChime();
}
function queueSuperPosAlerts(incoming,initial){
 if(page!=='pos'||initial)return;
 for(const order of incoming){
  if(order.created_by!=='admin'||superPosAlertSeen.has(order.id))continue;
  superPosAlertSeen.add(order.id);superPosPendingIds.delete(order.id);superPosAlertQueue.push(order);
 }
 showSuperPosAlert();
}
let reconnectTimer=null,wsGeneration=0;
function disconnect(){storeEpoch++;kitchenRefreshSerial++;document.querySelector('#super-pos-alert')?.remove();superPosAlertQueue=[];superPosAlertActive=null;superPosAlertSeen.clear();superPosPendingIds.clear();pickupInitialized=false;pickupItems=[];pickupSerial++;posReservations=[];posReservationLoaded=false;posReservationReloadPending=false;posReservationAlerts.clear();reservationEventQueue.length=0;reservationEventSeen.clear();document.querySelectorAll('[id^="reservation-reminder-"]').forEach(el=>el.remove());document.querySelector('#pickup-toast')?.remove();wsGeneration++;clearTimeout(reconnectTimer);reconnectTimer=null;const old=ws;ws=null;connected=false;if(old){old.onclose=null;old.onerror=null;old.onopen=null;old.onmessage=null;try{old.close()}catch{}}}
function platformOrderUpdateAlert(id){
 if(!['pos','kitchen'].includes(page))return;
 const order=orders.find(o=>o.id===id);
 const el=document.createElement('div');el.id='platform-order-update-alert';el.setAttribute('role','alert');
 el.style.cssText='position:fixed;top:16px;right:16px;z-index:3000;width:min(390px,calc(100vw - 32px));background:var(--surface,#fff);color:var(--text,#222);border:2px solid #f59e0b;border-radius:14px;box-shadow:0 12px 40px #0003;padding:16px;display:grid;gap:10px';
 el.innerHTML='<strong style="font-size:17px">⚠ ORDER UPDATED</strong><span>'+esc(order?.platform?.replaceAll('_',' ').toUpperCase()||'Platform order')+' · #'+esc(order?.external_order_id||id.slice(0,8))+'</span><div style="display:flex;gap:8px"><button type="button" data-platform-alert-view>View order</button><button type="button" class="alt" data-platform-alert-dismiss>Dismiss</button></div>';
 document.querySelector('#platform-order-update-alert')?.remove();document.body.append(el);
 el.querySelector('[data-platform-alert-dismiss]').onclick=()=>el.remove();
 el.querySelector('[data-platform-alert-view]').onclick=()=>{el.remove();if(page==='pos')openPosPlatformOrders();else document.querySelector('[data-kitchen-order="'+CSS.escape(id)+'"]')?.scrollIntoView({behavior:'smooth',block:'center'})};
 if(page==='kitchen')sound();
}
function connect(){
 if(!token)return;
 if(ws&&(ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING))return;
 clearTimeout(reconnectTimer);
 const generation=++wsGeneration;
 const proto=location.protocol==='https:'?'wss:':'ws:';
 const socket=new WebSocket(`${proto}//${location.host}/ws`,['ckauth.'+token]);
 ws=socket;
 const current=()=>generation===wsGeneration&&ws===socket;
 socket.onopen=()=>{if(!current())return;connected=true;if(page==='pos'){catchUpReservationEvents();loadPosReservations();const status=document.querySelector('header .status');if(status){status.className='status online';status.textContent='● Live'}else render()}else render();refresh();};
 socket.onmessage=e=>{if(!current())return;if(e.data==='pong')return;try{const m=JSON.parse(e.data);if(m.type==='platform_order_kitchen_created'){lastRealtimeMessage=Date.now();notifyKitchenPlatformOrder(m.data);}else if(m.type==='platform_order_edited'){lastRealtimeMessage=Date.now();refresh().then(()=>platformOrderUpdateAlert(m.data?.id||''));}else if(m.type==='assembly_checks'){lastRealtimeMessage=Date.now();if(page==='kitchen')loadKitchenAssemblyChecked()}else if(m.type==='orders'||m.type==='menu'){lastRealtimeMessage=Date.now();if(page==='pos'&&m.type==='orders'&&m.data?.id)superPosPendingIds.add(m.data.id);refresh()}else if(m.type==='reservations'){lastRealtimeMessage=Date.now();if(page==='pos'){queueReservationEvent(m.data);loadPosReservations()}}else if(m.type==='pickup'){lastRealtimeMessage=Date.now();if(page==='pos')loadPickups(true)}else if(m.type==='connected'){lastRealtimeMessage=Date.now()}}catch(err){console.warn('WebSocket message error',err)}};
 socket.onclose=async event=>{if(!current())return;ws=null;connected=false;
 if(event.code===1008&&deviceMode()){
  const recovered=await renewDeviceSession();
  // Renewal can intentionally reload the page after an access change.
  if(generation!==wsGeneration)return;
  if(!recovered){
   // Renewal may have intentionally opened the store selector or started a
   // clean reload. Never overwrite that screen with the old-store UI.
   if(storeSelectionPending)return;
   disconnect();token='';sessionStorage.removeItem('ck_token_'+page);
   menu=[];orders=[];tableState=[];login();return;
  }
 }
 if(page==='pos'){const status=document.querySelector('header .status');if(status){status.className='status offline';status.textContent='● Connecting / Offline'}else render()}else render();
 reconnectTimer=setTimeout(()=>{if(token&&generation===wsGeneration)connect()},2500)};
 socket.onerror=()=>{if(!current())return;console.warn('Kitchen WebSocket connection error');};
}

function storeBanner(){
 document.querySelector('#v3-current-store')?.remove();
 if(!['pos','kitchen'].includes(page))return;
 if(!deviceMode()||!currentDeviceStore){
  if(page==='pos'&&deviceMode()){
   const warning=document.createElement('div');warning.id='v3-current-store';warning.className='v3-current-store v3-current-store-unverified';warning.setAttribute('role','status');
   warning.innerHTML='<div><small>CURRENT RESTAURANT</small><strong>STORE SESSION NOT VERIFIED</strong><small>Reconnecting device authorization. Do not submit orders until the restaurant is verified.</small></div><button type="button" id="v3-store-retry">Retry connection</button>';
   app.prepend(warning);warning.querySelector('#v3-store-retry').onclick=async()=>{if(await renewDeviceSession())render();else notify('Unable to verify restaurant. Check device access in Back Office.')};
  }
  if(page==='kitchen'){
   const warning=document.createElement('div');
   warning.id='v3-current-store';warning.className='v3-current-store v3-current-store-unverified';
   warning.setAttribute('role','status');
   warning.innerHTML='<div><small>CURRENT RESTAURANT</small><strong>STORE NOT VERIFIED</strong><small>Device store session is unavailable. Contact Back Office before processing orders.</small></div>';
   app.prepend(warning);
  }
  return;
 }
 const banner=document.createElement('div');
 banner.id='v3-current-store';banner.className='v3-current-store '+(page==='kitchen'?'v3-current-store-kitchen':'');
 banner.innerHTML='<div><small>CURRENT STORE</small><strong>'+esc(currentDeviceStore.name)+'</strong></div><button type="button" id="v3-switch-store" '+(deviceStores.length<2?'disabled':'')+'>Switch store</button>';
 app.prepend(banner);
 banner.querySelector('#v3-switch-store').onclick=()=>{
  const overlay=document.createElement('div');overlay.className='v3-grants-overlay';
  overlay.innerHTML='<section class="v3-grants-dialog" role="dialog" aria-modal="true"><h2>Switch store</h2><p class="muted">Select an authorized restaurant.</p><form id="v3-store-switch-form"><select name="store_id">'+deviceStores.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===currentDeviceStore.id?'selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select><div class="toolbar"><button type="button" id="v3-switch-cancel" class="alt">Cancel</button><button type="submit">Switch store</button></div></form></section>';
  document.body.append(overlay);
  overlay.querySelector('#v3-switch-cancel').onclick=()=>overlay.remove();
  overlay.querySelector('#v3-store-switch-form').onsubmit=async e=>{
   e.preventDefault();const selected=String(new FormData(e.currentTarget).get('store_id')||'');
   if(!deviceStores.some(x=>x.id===selected))return;
   if(selected===currentDeviceStore?.id){overlay.remove();return}
   if(busy){notify('Wait for the current order submission to finish.');return}
   if(page==='pos'&&configuredCart.length&&!confirm('Switching stores will discard the unsent order draft. Continue?'))return;
   const button=overlay.querySelector('button[type="submit"]');button.disabled=true;
   try{
    // Verify the target grant with the server before changing local selection.
    const response=await fetch('/api/device/renew',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({role:page,store_id:selected})});
    if(!response.ok)throw Error('This store is no longer authorized or the network is unavailable.');
    const result=await response.json();
    if(result.store?.id!==selected||result.role!==page)throw Error('Store authorization could not be verified.');
    sessionStorage.removeItem('ck_token_'+page);
    localStorage.setItem(lastStoreKey,selected);
    location.reload();
   }catch(error){notify(error.message);button.disabled=false}
  };
 };
}
async function openCourierCollection(){
 const overlay=document.createElement('div');overlay.style.cssText='position:fixed;inset:0;z-index:1200;background:#0009;display:flex;align-items:center;justify-content:center;padding:14px';
 const panel=document.createElement('div');panel.style.cssText='width:min(640px,100%);max-height:90vh;overflow:auto;background:var(--surface,#fff);color:var(--text,#222);border-radius:14px;padding:20px';
 panel.innerHTML='<div class="row" style="justify-content:space-between"><h2>Courier Collection</h2><button class="alt" id="courier-close">Close</button></div><p class="muted">Kitchen-completed platform orders awaiting courier pickup.</p><div class="row" style="gap:8px"><button type="button" id="courier-pending">Awaiting Collection</button><button type="button" class="alt" id="courier-history">Collection History</button></div><div id="courier-list">Loading…</div>';
 overlay.append(panel);document.body.append(overlay);const close=()=>overlay.remove();panel.querySelector('#courier-close').onclick=close;overlay.onclick=e=>{if(e.target===overlay)close()};
 const list=panel.querySelector('#courier-list');let historyMode=false;
 panel.querySelector('#courier-pending').onclick=()=>{historyMode=false;load()};panel.querySelector('#courier-history').onclick=()=>{historyMode=true;load()};
 const load=async()=>{try{panel.querySelector('#courier-pending').className=historyMode?'alt':'';panel.querySelector('#courier-history').className=historyMode?'':'alt';const data=await api(historyMode?'/platform-orders/history':'/platform-orders/collection');if(!overlay.isConnected)return;list.innerHTML=data.orders.length?data.orders.map(o=>'<article class="panel" style="margin:10px 0;padding:12px"><div class="row" style="justify-content:space-between"><strong>'+esc(o.platform.replaceAll('_',' ').toUpperCase())+' · #'+esc(o.external_order_id)+'</strong><span>'+Number(o.dish_count)+' dishes</span></div><p class="muted small">Ready '+warsawClock(o.kitchen_completed_at)+(o.collected_at?' · Collected '+warsawClock(o.collected_at):'')+'</p>'+(historyMode?'':'<button type="button" data-courier-collect="'+esc(o.order_id)+'">Collected by Courier</button>')+'</article>').join('') :'<p class="muted">'+(historyMode?'No collected platform orders yet.':'No orders awaiting courier collection.')+'</p>';
 list.querySelectorAll('[data-courier-collect]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await api('/platform-orders/'+encodeURIComponent(button.dataset.courierCollect)+'/collect','POST',{});notify('Courier collection recorded');await load();await refresh();}catch(e){notify('Collection failed: '+e.message);button.disabled=false;}});
 }catch(e){list.textContent='Collection queue unavailable: '+e.message;}};
 await load();
}
let platformReadySeenIds=new Set(),platformReadyNewIds=new Set(),platformReadyInitialized=false,platformReadyStorageScope='';
function platformReadyKey(){
 const store=currentDeviceStore?.id||localStorage.getItem(lastStoreKey)||'legacy';
 return 'ck_pos_ready_v1_'+store;
}
function savePlatformReadyState(){
 try{localStorage.setItem(platformReadyStorageScope,JSON.stringify({seen:[...platformReadySeenIds],unread:[...platformReadyNewIds]}))}catch(e){console.warn('Ready state could not be saved',e)}
}
function syncPlatformReadyIndicators(nextOrders){
 if(page!=='pos')return;
 const key=platformReadyKey();
 if(platformReadyStorageScope!==key){
  platformReadyStorageScope=key;platformReadyInitialized=false;platformReadySeenIds=new Set();platformReadyNewIds=new Set();
  try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved&&Array.isArray(saved.seen)&&Array.isArray(saved.unread)){platformReadySeenIds=new Set(saved.seen);platformReadyNewIds=new Set(saved.unread);platformReadyInitialized=true}}catch(e){console.warn('Ready state could not be restored',e)}
 }
 const readyIds=new Set(nextOrders.filter(o=>o.platform&&!o.collected_at&&o.status!=='cancelled'&&o.kitchen_completed_at).map(o=>o.id||o.order_id));
 if(!platformReadyInitialized){platformReadySeenIds=new Set(readyIds);platformReadyInitialized=true;}
 else for(const id of readyIds)if(!platformReadySeenIds.has(id))platformReadyNewIds.add(id);
 for(const id of platformReadyNewIds)if(!readyIds.has(id))platformReadyNewIds.delete(id);
 for(const id of platformReadySeenIds)if(!readyIds.has(id))platformReadySeenIds.delete(id);
 savePlatformReadyState();
}
function acknowledgePlatformReady(){
 const ready=orders.filter(o=>o.platform&&!o.collected_at&&o.status!=='cancelled'&&o.kitchen_completed_at);
 platformReadySeenIds=new Set(ready.map(o=>o.id||o.order_id));platformReadyNewIds.clear();platformReadyInitialized=true;
 if(!platformReadyStorageScope)platformReadyStorageScope=platformReadyKey();
 savePlatformReadyState();
}
let platformWorkspaceFilter='active',platformWorkspaceSearch='',platformWorkspacePlatform='all',platformCollectedHistory=[],platformWorkspaceLoading=false;
const platformCollectPending=new Set();
const platformBrandThemes={uber_eats:{name:'Uber Eats',color:'#000000',ink:'#FFFFFF'},wolt:{name:'Wolt',color:'#009DE0',ink:'#FFFFFF'},pyszne:{name:'Pyszne.pl',color:'#FF8000',ink:'#FFFFFF'},pyszne_pl:{name:'Pyszne.pl',color:'#FF8000',ink:'#FFFFFF'},bolt_food:{name:'Bolt Food',color:'#32BB78',ink:'#092C1B'},glovo:{name:'Glovo',color:'#FFBF42',ink:'#241B08'}};
function platformBrand(platform){return platformBrandThemes[platform]||{name:String(platform||'Other').replaceAll('_',' ').toUpperCase(),color:'#64748B',ink:'#FFFFFF'};}
let platformHistoryOpen=false,platformHistoryPage=1,platformHistoryFrom='',platformHistoryTo='',platformHistoryProvider='',platformHistoryQuery='',platformHistoryResult={orders:[],total:0,page_size:15},platformHistoryBusy=false;
function platformHistoryHtml(){
 const rows=platformHistoryResult.orders||[],pages=Math.max(1,Math.ceil((platformHistoryResult.total||0)/15));
 return '<section class="panel foh-workspace platform-history"><header class="platform-workspace-head"><div><small>DELIVERY OPERATIONS</small><h2>Collected History</h2><p class="muted">Only orders handed to a courier appear here.</p></div><button type="button" class="alt" id="platform-history-back">← Platform Orders</button></header>'+
 '<div class="platform-history-filters"><label>Collected from<input type="date" id="platform-history-from" value="'+esc(platformHistoryFrom)+'"></label><label>Collected to<input type="date" id="platform-history-to" value="'+esc(platformHistoryTo)+'"></label><label>Platform<select id="platform-history-provider"><option value="">All platforms</option>'+[['wolt','Wolt'],['uber_eats','Uber Eats'],['bolt_food','Bolt Food'],['pyszne','Pyszne.pl'],['pyszne_pl','Pyszne.pl'],['glovo','Glovo'],['other','Other']].map(([id,name])=>'<option value="'+id+'" '+(platformHistoryProvider===id?'selected':'')+'>'+name+'</option>').join('')+'</select></label><label>Order ID<input id="platform-history-query" placeholder="Search order ID" value="'+esc(platformHistoryQuery)+'"></label><button type="button" id="platform-history-apply">Apply filters</button></div>'+
 '<p class="muted small">'+Number(platformHistoryResult.total||0)+' collected orders</p><div class="platform-history-list">'+(rows.length?rows.map(o=>'<button type="button" class="platform-history-row" data-platform-history-id="'+esc(o.order_id)+'"><span><strong>'+esc(platformBrand(o.platform).name)+' · #'+esc(o.external_order_id||o.order_id.slice(0,8))+'</strong><small>'+Number(o.portions||0)+' portions · Collected '+esc(warsawClock(o.collected_at))+'</small></span><span>View details ›</span></button>').join(''):'<p class="muted">No collected orders match your filters.</p>')+'</div>'+
 '<div class="platform-history-pagination"><button type="button" id="platform-history-prev" '+(platformHistoryPage<=1?'disabled':'')+'>Previous</button><span>Page '+platformHistoryPage+' of '+pages+'</span><button type="button" id="platform-history-next" '+(platformHistoryPage>=pages?'disabled':'')+'>Next</button></div></section>';
}
function renderPlatformHistory(){
 const root=document.querySelector('.platform-history');if(!root||!platformHistoryOpen)return;
 root.outerHTML=platformHistoryHtml();bindPlatformHistory();
}
function bindPlatformHistory(){
 const root=document.querySelector('.platform-history');if(!root)return;
 root.querySelector('#platform-history-back').onclick=()=>{platformHistoryOpen=false;pos()};
 root.querySelector('#platform-history-apply').onclick=()=>{platformHistoryFrom=root.querySelector('#platform-history-from').value;platformHistoryTo=root.querySelector('#platform-history-to').value;platformHistoryProvider=root.querySelector('#platform-history-provider').value;platformHistoryQuery=root.querySelector('#platform-history-query').value.trim();if(platformHistoryFrom&&platformHistoryTo&&platformHistoryFrom>platformHistoryTo)return notify('Start date must not be after end date');platformHistoryPage=1;loadPlatformHistory()};
 root.querySelector('#platform-history-prev').onclick=()=>{platformHistoryPage--;loadPlatformHistory()};
 root.querySelector('#platform-history-next').onclick=()=>{platformHistoryPage++;loadPlatformHistory()};
 root.querySelectorAll('[data-platform-history-id]').forEach(el=>el.onclick=()=>showPlatformHistoryDetail(el.dataset.platformHistoryId));
}
async function loadPlatformHistory(){
 if(platformHistoryBusy)return;platformHistoryBusy=true;
 try{const params=new URLSearchParams({page:String(platformHistoryPage)});if(platformHistoryFrom)params.set('from',platformHistoryFrom);if(platformHistoryTo)params.set('to',platformHistoryTo);if(platformHistoryProvider)params.set('platform',platformHistoryProvider);if(platformHistoryQuery)params.set('q',platformHistoryQuery);
 platformHistoryResult=await api('/platform-orders/history/search?'+params);renderPlatformHistory();
 }catch(e){notify('History unavailable: '+e.message)}finally{platformHistoryBusy=false}
}
async function showPlatformHistoryDetail(id){
 try{const data=await api('/platform-orders/history/'+encodeURIComponent(id));const o=data.order;
 const overlay=document.createElement('div');overlay.className='platform-collect-overlay';overlay.innerHTML='<section class="platform-collect-modal platform-history-detail" role="dialog" aria-modal="true"><div class="platform-collect-header"><span class="platform-collect-eyebrow">COLLECTED ORDER</span><button type="button" class="platform-collect-close" aria-label="Close">×</button></div><h2>'+esc(platformBrand(o.platform).name)+' · #'+esc(o.external_order_id||o.id.slice(0,8))+'</h2><p class="muted">Created: '+esc(warsawClock(o.created_at))+' · Kitchen ready: '+esc(warsawClock(o.kitchen_completed_at))+' · Collected: '+esc(warsawClock(o.collected_at))+'</p><p class="muted">Collected by: '+esc(o.collected_by||'Unknown')+'</p><div class="platform-collect-dishes">'+data.items.map(i=>'<div class="platform-collect-dish"><span>'+Number(i.quantity)+' × '+esc(i.name)+(i.modifiers.length?'<small> · '+esc(i.modifiers.map(m=>m.name).join(', '))+'</small>':'')+(i.note?'<small> · '+esc(i.note)+'</small>':'')+'</span></div>').join('')+'</div>'+(o.note?'<p>Note: '+esc(o.note)+'</p>':'')+'</section>';
 document.body.append(overlay);const close=()=>overlay.remove();overlay.querySelector('.platform-collect-close').onclick=close;overlay.onclick=e=>{if(e.target===overlay)close()};
 }catch(e){notify('Order details unavailable: '+e.message)}
}
const platformHistoryCss=document.createElement('style');platformHistoryCss.textContent='.platform-history-filters{display:flex;flex-wrap:wrap;align-items:end;gap:10px;margin:16px 0}.platform-history-filters label{display:grid;gap:5px;flex:1 1 155px}.platform-history-filters input,.platform-history-filters select{width:100%;min-width:0}.platform-history-list{display:grid;gap:8px}.platform-history-row{width:100%;display:flex;justify-content:space-between;align-items:center;text-align:left;gap:12px;padding:14px;border:1px solid var(--border,#ccc);border-radius:12px;background:var(--surface,#fff);color:var(--text,#222)}.platform-history-row span:first-child{display:grid;gap:5px}.platform-history-row small{opacity:.7}.platform-history-pagination{display:flex;justify-content:center;align-items:center;gap:14px;margin-top:18px}.platform-history-detail{max-height:85vh;overflow:auto}';document.head.append(platformHistoryCss);
function platformWorkspaceHtml(){
 const active=orders.filter(o=>o.platform&&!o.collected_at&&o.status!=='cancelled'&&!platformCollectPending.has(o.id||o.order_id));
 const ready=active.filter(o=>!!o.kitchen_completed_at);
 const preparing=active.filter(o=>!o.kitchen_completed_at);
 const readyNew=ready.filter(o=>platformReadyNewIds.has(o.id||o.order_id)).length;
 const buttons=[['active','Active',active.length],['preparing','Preparing',preparing.length],['ready','Ready',ready.length],['collected','Collected',platformCollectedHistory.length]];
 const all=platformWorkspaceFilter==='collected'?platformCollectedHistory:platformWorkspaceFilter==='ready'?ready:platformWorkspaceFilter==='preparing'?preparing:active;
 const q=platformWorkspaceSearch.toLowerCase();
 const filtered=all.filter(o=>(platformWorkspacePlatform==='all'||o.platform===platformWorkspacePlatform)&&[o.platform,o.external_order_id,...(o.items||[]).map(i=>i.name)].join(' ').toLowerCase().includes(q)).sort((a,b)=>{
  if(platformWorkspaceFilter==='active'){
   const aTime=Date.parse(a.created_at||'')||0,bTime=Date.parse(b.created_at||'')||0;
   return bTime-aTime;
  }
  if(platformWorkspaceFilter==='collected')return (Date.parse(b.collected_at||'')||0)-(Date.parse(a.collected_at||'')||0);
  const aTime=Date.parse(a.created_at||'')||0,bTime=Date.parse(b.created_at||'')||0;
  return aTime-bTime;
 });
 const cards=filtered.map(o=>{
  const items=o.items||[],done=items.filter(i=>i.is_done).length,total=items.length;
  const portions=items.length?items.reduce((n,i)=>n+Number(i.quantity||0),0):Number(o.dish_count||0);
  const completed=!!o.kitchen_completed_at||!!o.collected_at,collected=!!o.collected_at;
  const brand=platformBrand(o.platform),id=o.id||o.order_id;
  const status=collected?'Collected':completed?'Ready':'Preparing';
  const dishRows=items.map(i=>'<div class="platform-workspace-dish"><span class="platform-workspace-dish-qty">'+Number(i.quantity||0)+' ×</span><span>'+esc(i.name)+'</span>'+(i.is_done?'<span class="platform-workspace-dish-done" aria-label="Completed">✓</span>':'')+'</div>').join('');
  return '<article class="platform-workspace-card" style="--platform-brand:'+brand.color+';--platform-ink:'+brand.ink+'"><div class="platform-workspace-card-top"><span class="platform-brand-chip">'+esc(brand.name)+'</span><span class="platform-workspace-status '+(collected?'collected':completed?'ready':'preparing')+'">'+status+'</span></div><div class="platform-workspace-order-info"><strong class="platform-workspace-order-id">#'+esc(o.external_order_id||id?.slice(0,8)||'')+'</strong><span class="muted small">'+portions+' portions · '+done+'/'+total+' dishes done</span></div><div class="platform-workspace-dishes">'+(dishRows||'<span class="muted small">Dish details unavailable</span>')+'</div><div class="platform-workspace-actions">'+(!completed?'<button type="button" class="alt" data-platform-workspace-edit="'+esc(id)+'">Edit dishes</button>':'')+(completed&&!collected?'<button type="button" data-platform-workspace-collect="'+esc(id)+'">Collected by Courier</button>':'')+(collected?'<span class="muted small">Collected '+warsawClock(o.collected_at)+'</span>':'')+'</div></article>';
 }).join('');
 return '<section class="panel foh-workspace platform-workspace"><header class="platform-workspace-head platform-workspace-action-row"><div class="platform-workspace-intro"><small>DELIVERY OPERATIONS</small><h2>Platform Orders</h2><p class="muted">Create, edit, track and hand off courier orders in one place.</p></div><button type="button" class="platform-workspace-action-card platform-workspace-action-new" id="platform-workspace-new"><span class="platform-action-icon">＋</span><span>New Platform Order</span></button><button type="button" class="platform-workspace-action-card platform-workspace-action-history" id="platform-history-open"><span class="platform-action-icon">◷</span><span>History</span><small>Collected orders</small></button></header><div class="platform-workspace-stats">'+buttons.map(([id,label,n])=>'<button type="button" aria-pressed="'+(platformWorkspaceFilter===id)+'" data-platform-filter="'+id+'" class="'+(platformWorkspaceFilter===id?'selected':'')+'"><strong>'+(id==='ready'&&readyNew?'<span>'+(n-readyNew)+'</span><span class="platform-ready-increment">+'+readyNew+'</span>':n)+'</strong><span>'+label+'</span>'+(platformWorkspaceFilter===id?'<span class="platform-filter-selected">✓ Selected</span>':'')+'</button>').join('')+'</div><div class="platform-workspace-tools"><input type="search" id="platform-workspace-search" placeholder="Search platform, order ID or dish" value="'+esc(platformWorkspaceSearch)+'" aria-label="Search platform orders"><select id="platform-workspace-provider" aria-label="Delivery platform"><option value="all">All platforms</option>'+[['wolt','Wolt'],['uber_eats','Uber Eats'],['bolt_food','Bolt Food'],['pyszne','Pyszne.pl'],['glovo','Glovo'],['other','Other']].map(([id,name])=>'<option value="'+id+'" '+(platformWorkspacePlatform===id?'selected':'')+'>'+name+'</option>').join('')+'</select><button type="button" class="alt" id="platform-workspace-refresh">Refresh</button></div><div class="platform-workspace-list">'+(filtered.length?cards:'<p class="muted">No matching orders.</p>')+'</div></section>';
}
const platformActionRowCss=document.createElement('style');platformActionRowCss.textContent='.platform-workspace .platform-workspace-action-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(180px,.42fr) minmax(180px,.42fr);gap:12px;align-items:stretch}.platform-workspace-intro{min-width:0;padding:16px 18px;border-radius:12px;background:rgba(10,17,31,.45);display:flex;flex-direction:column;justify-content:center}.platform-workspace-intro h2{margin:4px 0 6px}.platform-workspace-intro p{margin:0}.platform-workspace .platform-workspace-action-card{width:100%;min-height:116px;border-radius:12px;padding:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;font-size:16px;font-weight:750;text-align:center;cursor:pointer;transition:transform .15s,border-color .15s,filter .15s}.platform-workspace .platform-workspace-action-card:hover{transform:translateY(-2px);filter:brightness(1.08)}.platform-workspace-action-new{background:#365be8;color:white;border:1px solid #6684ff}.platform-workspace-action-history{background:#30435a;color:#f0f5ff;border:1px solid #62758c}.platform-action-icon{font-size:26px;line-height:1}.platform-workspace-action-card small{font-size:12px;font-weight:500;opacity:.82}@media(max-width:760px){.platform-workspace .platform-workspace-action-row{grid-template-columns:repeat(2,minmax(0,1fr))}.platform-workspace-intro{grid-column:1/-1}.platform-workspace .platform-workspace-action-card{min-height:90px;font-size:14px}}';document.head.append(platformActionRowCss);
const platformWorkspaceCss=document.createElement('style');platformWorkspaceCss.textContent='.platform-workspace-stats strong{display:flex;align-items:baseline;gap:8px;font-variant-numeric:tabular-nums}.platform-ready-increment{color:#4ade80;font-size:.75em;animation:platform-ready-pop .5s ease-out}@keyframes platform-ready-pop{0%{transform:scale(.8);opacity:.3}65%{transform:scale(1.14)}100%{transform:scale(1);opacity:1}}'+'.platform-workspace-card{border-left:5px solid var(--platform-brand,#64748b)!important}.platform-brand-heading{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.platform-brand-chip{display:inline-flex;align-items:center;min-height:30px;padding:5px 11px;border-radius:7px;background:var(--platform-brand,#64748b);color:var(--platform-ink,#fff);font-size:12px;font-weight:800;letter-spacing:.01em}.platform-workspace-card-top{align-items:center}.platform-workspace-card{background:linear-gradient(110deg,color-mix(in srgb,var(--platform-brand,#64748b) 9%,transparent),transparent 48%),var(--surface,#243244)}.platform-workspace{display:grid;gap:18px}.platform-workspace-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.platform-workspace-head h2{margin:4px 0}.platform-workspace-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.platform-workspace-stats button{display:grid;gap:5px;text-align:left;padding:14px;border:1px solid var(--border,#cbd5e1);border-radius:12px}.platform-workspace-stats strong{font-size:26px}.platform-workspace-stats .selected{border-color:#4b78dc;background:rgba(59,100,210,.12)}.platform-workspace-tools{display:grid;grid-template-columns:minmax(0,1fr) 180px auto;gap:9px}.platform-workspace-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,350px),1fr));gap:12px}.platform-workspace-card{border:1px solid var(--border,#cbd5e1);border-radius:12px;padding:14px;display:grid;gap:12px;align-content:start}.platform-workspace-card-top{display:flex;justify-content:space-between;gap:12px;align-items:start}.platform-workspace-status{border-radius:20px;padding:5px 10px;font-size:12px;font-weight:700;white-space:nowrap}.platform-workspace-status.preparing{background:#fef3c7;color:#92400e}.platform-workspace-status.ready{background:#dcfce7;color:#166534}.platform-workspace-status.collected{background:#e2e8f0;color:#334155}.platform-workspace-dishes{display:flex;flex-wrap:wrap;gap:6px}.platform-workspace-dishes span{padding:5px 8px;border:1px solid var(--border,#cbd5e1);border-radius:7px;font-size:12px}.platform-workspace-actions{display:flex;justify-content:flex-end;gap:8px}@media(max-width:650px){.platform-workspace-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.platform-workspace-tools{grid-template-columns:1fr}.platform-workspace-list{grid-template-columns:1fr}}';platformWorkspaceCss.textContent+='.platform-workspace-stats button{background:#243244!important;color:#e2e8f0!important;border:1px solid #53657b!important;position:relative;min-height:96px;align-content:center}.platform-workspace-stats button.selected{background:#315eea!important;color:#fff!important;border:2px solid #a6bdff!important;box-shadow:0 0 0 2px #315eea44}.platform-workspace-stats button:not(.selected):hover{border-color:#9bb1cc!important;background:#2d4058!important}.platform-filter-selected{font-size:11px;font-weight:700;color:#fff}.platform-workspace-card{grid-template-rows:auto auto minmax(0,1fr) auto;gap:11px!important;min-height:260px;align-content:stretch!important;border-left-width:5px!important}.platform-workspace-card-top{display:flex;justify-content:space-between;align-items:center;gap:8px}.platform-workspace-order-info{display:flex;flex-direction:column;gap:3px}.platform-workspace-order-id{font-size:19px;line-height:1.2;color:#f8fafc}.platform-workspace-dishes{display:flex!important;flex-direction:column!important;flex-wrap:nowrap!important;gap:6px!important;align-items:stretch}.platform-workspace-dish{display:flex;gap:7px;align-items:baseline;line-height:1.35;font-size:13px;color:#f1f5f9;overflow-wrap:anywhere}.platform-workspace-dish-qty{flex:0 0 auto;font-weight:700;color:#cbd5e1}.platform-workspace-dish-done{margin-left:auto;color:#86efac;font-weight:800}.platform-workspace-actions{border-top:1px solid #475569;padding-top:11px;margin-top:auto;min-height:45px;align-items:center}.platform-workspace-card .platform-workspace-status{flex-shrink:0}.platform-workspace-card .platform-brand-chip{font-size:12px}.foh-tabs button[data-foh-tab=platform]{white-space:nowrap}@media(max-width:650px){.platform-workspace-card{min-height:0}.platform-workspace-stats button{min-height:82px}}';platformWorkspaceCss.textContent+='.platform-collect-overlay{position:fixed;inset:0;z-index:1800;background:rgba(5,10,20,.76);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(3px)}.platform-collect-modal{width:min(520px,100%);max-height:90vh;overflow:auto;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:18px;padding:24px;box-shadow:0 24px 80px #0008;display:grid;gap:16px}.platform-collect-header,.platform-collect-order-heading,.platform-collect-footer{display:flex;align-items:center;gap:10px}.platform-collect-header{justify-content:space-between}.platform-collect-eyebrow{color:#f4b183;font-size:11px;letter-spacing:1.6px;font-weight:800}.platform-collect-close{background:#334155;color:#fff;border:0;border-radius:10px;width:38px;height:38px;font-size:24px}.platform-collect-modal h2{font-size:25px;margin:0;color:#fff}.platform-collect-modal p{margin:0;color:#cbd5e1;line-height:1.5}.platform-collect-order{border:1px solid #526276;border-left:5px solid var(--platform-brand);border-radius:12px;padding:15px;display:grid;gap:14px;background:#243449}.platform-collect-order-heading{flex-wrap:wrap}.platform-collect-order-heading strong{font-size:19px}.platform-collect-order-heading .platform-workspace-status{margin-left:auto}.platform-collect-dishes{display:grid;gap:8px}.platform-collect-dish{display:flex;justify-content:space-between;gap:12px;font-size:14px;border-top:1px solid #45556a;padding-top:8px}.platform-collect-dish span:last-child{color:#86efac}.platform-collect-footer{justify-content:flex-end;border-top:1px solid #475569;padding-top:16px}.platform-collect-footer button{min-height:44px}.platform-collect-submit{background:#3861ed;color:#fff}.platform-collect-error{color:#fecaca!important;background:#7f1d1d55;padding:10px;border-radius:8px}@media(max-width:550px){.platform-collect-modal{padding:18px}.platform-collect-footer button{flex:1}}';document.head.append(platformWorkspaceCss);
function bindPlatformWorkspace(){
 const root=document.querySelector('.platform-workspace');if(!root)return;
 root.querySelector('#platform-workspace-new').onclick=openQuickOrderDialog;
 root.querySelector('#platform-history-open').onclick=()=>{platformHistoryOpen=true;pos();loadPlatformHistory()};
 root.querySelector('#platform-workspace-refresh').onclick=loadPlatformWorkspace;
 root.querySelector('#platform-workspace-search').oninput=e=>{platformWorkspaceSearch=e.target.value;renderPlatformWorkspace()};
 root.querySelector('#platform-workspace-provider').onchange=e=>{platformWorkspacePlatform=e.target.value;renderPlatformWorkspace()};
 root.querySelectorAll('[data-platform-filter]').forEach(b=>b.onclick=()=>{platformWorkspaceFilter=b.dataset.platformFilter;if(platformWorkspaceFilter==='ready')acknowledgePlatformReady();renderPlatformWorkspace();if(platformWorkspaceFilter==='collected')loadPlatformWorkspace()});
 root.querySelectorAll('[data-platform-workspace-edit]').forEach(b=>b.onclick=()=>editPlatformOrder(b.dataset.platformWorkspaceEdit));
 root.querySelectorAll('[data-platform-workspace-collect]').forEach(b=>b.onclick=()=>confirmPlatformCollection(b.dataset.platformWorkspaceCollect));
}
function confirmPlatformCollection(id){
 const order=orders.find(o=>o.id===id)||platformCollectedHistory.find(o=>(o.id||o.order_id)===id);
 if(!order)return notify('Order unavailable. Refresh and try again.');
 if(document.querySelector('#platform-collect-dialog'))return;
 const brand=platformBrand(order.platform);
 const overlay=document.createElement('div');
 overlay.id='platform-collect-dialog';
 overlay.className='platform-collect-overlay';
 const dishes=(order.items||[]).map(i=>'<div class="platform-collect-dish"><span>'+Number(i.quantity||0)+' × '+esc(i.name)+'</span><span aria-label="Ready">✓</span></div>').join('');
 overlay.innerHTML='<section class="platform-collect-modal" role="dialog" aria-modal="true" aria-labelledby="platform-collect-title" aria-describedby="platform-collect-description"><div class="platform-collect-header"><span class="platform-collect-eyebrow">COURIER HANDOFF</span><button type="button" class="platform-collect-close" aria-label="Close confirmation">×</button></div><h2 id="platform-collect-title">Confirm courier pickup</h2><p id="platform-collect-description">Only confirm after the courier has physically collected this order.</p><div class="platform-collect-order" style="--platform-brand:'+brand.color+';--platform-ink:'+brand.ink+'"><div class="platform-collect-order-heading"><span class="platform-brand-chip">'+esc(brand.name)+'</span><strong>#'+esc(order.external_order_id||id.slice(0,8))+'</strong><span class="platform-workspace-status ready">Ready</span></div><div class="platform-collect-dishes">'+(dishes||'<span class="muted">Order ready for pickup</span>')+'</div></div><p class="platform-collect-error" role="alert" hidden></p><div class="platform-collect-footer"><button type="button" class="alt platform-collect-cancel">Cancel</button><button type="button" class="platform-collect-submit">Confirm collected</button></div></section>';
 document.body.append(overlay);
 const previousFocus=document.activeElement;
 const cancel=()=>{document.removeEventListener('keydown',onKey);overlay.remove();if(previousFocus?.isConnected)previousFocus.focus()};
 const onKey=e=>{if(e.key==='Escape'&&!overlay.dataset.busy){e.preventDefault();cancel()}if(e.key==='Tab'){const buttons=[...overlay.querySelectorAll('button:not([disabled])')];const first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};
 document.addEventListener('keydown',onKey);
 overlay.querySelector('.platform-collect-close').onclick=cancel;
 overlay.querySelector('.platform-collect-cancel').onclick=cancel;
 overlay.onclick=e=>{if(e.target===overlay&&!overlay.dataset.busy)cancel()};
 overlay.querySelector('.platform-collect-submit').onclick=async()=>{
  if(overlay.dataset.busy)return;
  overlay.dataset.busy='1';
  const submit=overlay.querySelector('.platform-collect-submit');
  submit.disabled=true;submit.textContent='Recording pickup…';
  overlay.querySelector('.platform-collect-cancel').disabled=true;
  overlay.querySelector('.platform-collect-close').disabled=true;
  platformCollectPending.add(id);
  renderPlatformWorkspace();
  cancel();
  try{
   await api('/platform-orders/'+encodeURIComponent(id)+'/collect','POST',{});
   notify('Courier collection recorded');
  }catch(e){
   notify('Collection failed: '+e.message);
  }finally{
   platformCollectPending.delete(id);
   await loadPlatformWorkspace();
  }
 };
 overlay.querySelector('.platform-collect-cancel').focus();
}
function renderPlatformWorkspace(){
 const root=document.querySelector('.platform-workspace');if(!root||fohTab!=='platform')return;
 const search=root.querySelector('#platform-workspace-search');const focused=document.activeElement===search;const selection=focused?search.selectionStart:null;
 root.outerHTML=platformWorkspaceHtml();bindPlatformWorkspace();
 if(focused){const next=document.querySelector('#platform-workspace-search');next.focus();if(selection!==null)next.setSelectionRange(selection,selection);}
}
async function loadPlatformWorkspace(){
 if(platformWorkspaceLoading)return;platformWorkspaceLoading=true;
 try{
  const [latest,history]=await Promise.all([api('/orders'),api('/platform-orders/history?limit=40')]);
  if(fohTab!=='platform')return;
  syncPlatformReadyIndicators(latest);orders=latest;platformCollectedHistory=(history.orders||[]).map(o=>({...o,id:o.order_id,items:o.items||[]}));
  renderPlatformWorkspace();
 }catch(e){notify('Platform orders refresh failed: '+e.message)}
 finally{platformWorkspaceLoading=false}
}
async function editPlatformOrder(id){
 let order=orders.find(o=>o.id===id&&o.platform);
 if(!order){await refresh();order=orders.find(o=>o.id===id&&o.platform);}
 if(!order)return notify('Platform order not found; refresh');
 if(order.kitchen_completed_at||order.collected_at)return notify('Reopen the order in Kitchen before editing');
 const editStyle=document.createElement('style');editStyle.textContent='.platform-edit-dialog .platform-edit-option{display:flex;align-items:center;gap:10px;margin:0;padding:10px 12px;border-radius:8px;cursor:pointer;min-width:0;line-height:1.4;overflow-wrap:anywhere}.platform-edit-dialog .platform-edit-option:hover{background:rgba(100,116,139,.1)}.platform-edit-dialog .platform-edit-option input[type=checkbox]{flex:0 0 18px;width:18px;height:18px;margin:0;accent-color:#315ec2}.platform-edit-dialog .platform-edit-option-name{flex:1;min-width:0;white-space:normal;overflow-wrap:anywhere}.platform-edit-dialog details[open]>.platform-edit-option{margin-top:6px}.platform-edit-dialog details summary{list-style-position:inside;line-height:1.5;padding:4px 2px}.platform-edit-dialog details{min-width:0}.platform-edit-dialog .edit-panel{overflow-wrap:anywhere}.platform-edit-dialog{display:grid;gap:14px}.platform-edit-dialog h2,.platform-edit-dialog h3{margin:0}.platform-edit-dialog .edit-workspace{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:14px;align-items:start}.platform-edit-dialog .edit-panel{border:1px solid var(--border,#cbd5e1);border-radius:12px;padding:12px;min-width:0;display:grid;gap:10px}.platform-edit-dialog .edit-browser{display:grid;grid-template-columns:125px minmax(0,1fr);gap:8px;max-height:350px;overflow:hidden}.platform-edit-dialog .edit-categories,.platform-edit-dialog .edit-results{display:flex;flex-direction:column;gap:6px;overflow:auto;min-width:0}.platform-edit-dialog .edit-browser button{text-align:left;white-space:normal;overflow-wrap:anywhere;padding:9px}.platform-edit-dialog .edit-browser button.selected{background:#315ec2;color:white}.platform-edit-dialog .edit-footer{position:sticky;bottom:-18px;background:var(--surface,#fff);padding:12px 0 2px;display:flex;justify-content:flex-end;gap:10px;border-top:1px solid var(--border,#cbd5e1)}.platform-edit-dialog .edit-hint{font-size:13px;opacity:.75;margin:0}.platform-edit-dialog [data-edit-existing]{min-width:0}.platform-edit-dialog [data-edit-existing] button{padding:8px}.platform-edit-dialog .edit-status{font-size:12px;font-weight:700}.platform-edit-dialog .edit-status.done{color:#059669}@media(max-width:720px){.platform-edit-dialog .edit-workspace{grid-template-columns:1fr}.platform-edit-dialog .edit-browser{grid-template-columns:100px minmax(0,1fr);max-height:300px}.platform-edit-dialog [data-edit-existing]{gap:6px!important}}';document.head.append(editStyle);
 const overlay=document.createElement('div');overlay.style.cssText='position:fixed;inset:0;z-index:1300;background:#0009;display:flex;align-items:center;justify-content:center;padding:12px';
 const form=document.createElement('form');form.className='platform-edit-dialog';form.style.cssText='width:min(1060px,100%);max-height:94vh;overflow:auto;background:var(--surface,#fff);color:var(--text,#222);border-radius:14px;padding:18px;display:grid;gap:12px';
 form.innerHTML='<header style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div><h2>Edit Platform Order · #'+esc(order.external_order_id||order.id.slice(0,8))+'</h2><p class="edit-hint">'+esc(order.platform.replaceAll('_',' ').toUpperCase())+' · Changes are sent to Kitchen when saved</p></div><button type="button" class="alt" id="platform-edit-cancel" aria-label="Close editor">×</button></header><div class="edit-workspace"><section class="edit-panel"><h3>1 · Current dishes</h3><p class="edit-hint">Change quantity or remove Pending dishes. Add a new dish from the menu. Done dishes are locked.</p><div id="platform-edit-existing" style="display:grid;gap:8px"></div><h3>New dishes <span id="platform-edit-added-count"></span></h3><div id="platform-edit-added" style="display:grid;gap:10px"></div></section><section class="edit-panel"><h3>2 · Menu</h3><p class="edit-hint">Choose a category, then tap a dish to add it. To change a dish, remove the old one and add the new one.</p><input type="search" id="platform-edit-search" placeholder="Search menu..." aria-label="Search menu"><div class="edit-browser"><nav class="edit-categories" id="platform-edit-categories" aria-label="Dish categories"></nav><div class="edit-results" id="platform-edit-catalog"></div></div><label>Kitchen note<textarea name="note" maxlength="500" rows="3">'+esc(order.note||'')+'</textarea></label></section></div><div class="edit-footer"><button type="button" class="alt" id="platform-edit-back">Cancel</button><button type="submit">Save changes to Kitchen</button></div>';
 overlay.append(form);document.body.append(overlay);
 const close=()=>{overlay.remove();editStyle.remove()};form.querySelector('#platform-edit-cancel').onclick=close;form.querySelector('#platform-edit-back').onclick=close;overlay.onclick=e=>{if(e.target===overlay)close()};
 const existingNode=form.querySelector('#platform-edit-existing'),addedNode=form.querySelector('#platform-edit-added'),catalog=form.querySelector('#platform-edit-catalog');
 const removed=new Set();let menu=[],modifiers={groups:[],options:[],links:[]},activeCategory='All';
 const groupFor=menuId=>modifiers.groups.filter(g=>modifiers.links.some(l=>l.menu_id===menuId&&l.group_id===g.id));
 const drawExisting=()=>{
  existingNode.innerHTML=order.items.map(item=>'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px;border:1px solid #aaa;border-radius:9px" data-edit-existing="'+esc(item.id)+'"><strong style="flex:1;min-width:150px">'+esc(item.name)+'</strong><span>'+ (item.is_done?'Done · Locked':'Pending')+'</span><input aria-label="Quantity" type="number" min="1" max="99" value="'+Number(item.quantity)+'" '+(item.is_done?'disabled':'')+' style="width:72px"><button type="button" class="alt" data-edit-remove '+(item.is_done?'disabled':'')+'>Remove</button></div>').join('');
  for(const row of existingNode.children){
   const id=row.dataset.editExisting,item=order.items.find(i=>i.id===id);
   if(removed.has(id)){row.hidden=true;continue;}
   row.querySelector('[data-edit-remove]').onclick=()=>{removed.add(id);row.hidden=true};
   
  }
 };
 const addDish=(menuId,quantity=1,selected=[])=>{
  const dish=menu.find(m=>m.id===menuId);if(!dish)return notify('Dish is not available on this platform');
  const row=document.createElement('div');row.style.cssText='display:grid;gap:8px;padding:10px;border:1px solid var(--border,#cbd5e1);border-radius:10px;background:var(--surface,#fff)';
  row.innerHTML='<div style="display:flex;gap:8px;align-items:center"><strong style="flex:1">'+esc(dish.name)+'</strong><input aria-label="Quantity" type="number" min="1" max="99" value="'+Number(quantity)+'" style="width:75px"><button type="button" class="alt" data-remove-added>×</button></div>'+groupFor(menuId).map(g=>'<details style="border:1px solid var(--border,#cbd5e1);border-radius:8px;padding:8px"><summary style="cursor:pointer">Options · '+esc(g.name)+' · '+Number(g.min_select)+'–'+Number(g.max_select)+'</summary>'+modifiers.options.filter(o=>o.group_id===g.id).map(o=>'<label class="platform-edit-option"><input type="checkbox" data-edit-option="'+esc(o.id)+'" data-edit-group="'+esc(g.id)+'" '+(selected.includes(o.id)?'checked':'')+'><span class="platform-edit-option-name">'+esc(o.name)+'</span></label>').join('')+'</details>').join('');
  row.dataset.menuId=menuId;row.querySelector('[data-remove-added]').onclick=()=>{row.remove();updateAddedCount()};addedNode.append(row);updateAddedCount();
  row.querySelectorAll('[data-edit-option]').forEach(input=>input.onchange=()=>{const g=groupFor(menuId).find(g=>g.id===input.dataset.editGroup);if(g&&row.querySelectorAll('[data-edit-group="'+CSS.escape(g.id)+'"]:checked').length>g.max_select){input.checked=false;notify('Maximum '+g.max_select+' selections for '+g.name)}});
 };
 const updateAddedCount=()=>{form.querySelector('#platform-edit-added-count').textContent=addedNode.children.length?'('+addedNode.children.length+')':'';};
 const drawCatalog=()=>{
  const q=form.querySelector('#platform-edit-search').value.trim().toLowerCase();
  const categories=['All',...new Set(menu.map(m=>m.category||'Other'))];
  const nav=form.querySelector('#platform-edit-categories');
  nav.innerHTML=categories.map(cat=>'<button type="button" class="alt '+(cat===activeCategory?'selected':'')+'" data-edit-category="'+esc(cat)+'">'+esc(cat)+'</button>').join('');
  nav.querySelectorAll('[data-edit-category]').forEach(btn=>btn.onclick=()=>{activeCategory=btn.dataset.editCategory;drawCatalog()});
  const filtered=menu.filter(m=>(activeCategory==='All'||(m.category||'Other')===activeCategory)&&m.name.toLowerCase().includes(q));
  catalog.innerHTML=filtered.length?filtered.map(m=>'<button type="button" class="alt" data-add-menu="'+esc(m.id)+'">+ '+esc(m.name)+'</button>').join(''):'<p class="edit-hint">No matching dishes</p>';
  catalog.querySelectorAll('[data-add-menu]').forEach(btn=>btn.onclick=()=>addDish(btn.dataset.addMenu));
 };
 drawExisting();form.querySelector('#platform-edit-search').oninput=drawCatalog;
 try{[menu,modifiers]=await Promise.all([api('/quick-order/menu?platform='+encodeURIComponent(order.platform)),api('/menu/modifiers')]);if(!overlay.isConnected)return;drawCatalog();}
 catch(e){notify('Platform menu failed: '+e.message);}
 form.onsubmit=async e=>{
  e.preventDefault();const button=form.querySelector('[type="submit"]');button.disabled=true;
  try{
   const items=order.items.filter(i=>!removed.has(i.id)).map(i=>({id:i.id,quantity:i.is_done?Number(i.quantity):Number(existingNode.querySelector('[data-edit-existing="'+CSS.escape(i.id)+'"] input[aria-label="Quantity"]').value)}));
   const added_items=[...addedNode.children].map(row=>{const menu_id=row.dataset.menuId,quantity=Number(row.querySelector('input[aria-label="Quantity"]').value),option_ids=[...row.querySelectorAll('[data-edit-option]:checked')].map(el=>el.dataset.editOption);for(const g of groupFor(menu_id)){const n=option_ids.filter(id=>modifiers.options.some(o=>o.id===id&&o.group_id===g.id)).length;if(n<g.min_select||n>g.max_select)throw Error('Select '+g.min_select+'–'+g.max_select+' options for '+g.name);}return {menu_id,quantity,option_ids};});
   if(!items.length&&!added_items.length)throw Error('An order must contain at least one dish');
   if([...items,...added_items].some(x=>!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>99))throw Error('Quantity must be between 1 and 99');
   await api('/platform-orders/'+encodeURIComponent(id)+'/edit','POST',{expected_updated_at:order.updated_at,note:form.elements.note.value,items,removed_ids:[...removed],added_items});
   close();notify('Platform order updated');await refresh();
  }catch(err){notify('Edit failed: '+err.message);button.disabled=false;}
 };
}
async function openQuickOrderDialog(){
 const overlay=document.createElement('div');
 overlay.style.cssText='position:fixed;inset:0;z-index:1000;background:#0009;display:flex;align-items:center;justify-content:center;padding:16px';
 const form=document.createElement('form');
 form.style.cssText='background:var(--surface,#fff);color:var(--text,#222);border-radius:14px;padding:22px;width:min(960px,100%);max-height:94vh;overflow:auto;display:grid;gap:12px';
 const quickOrderStyle=document.createElement('style');quickOrderStyle.textContent=`.quick-ready-control{display:grid;gap:10px;padding:14px;border:1px solid var(--border,#d8dde5);border-radius:12px}.quick-ready-header{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.quick-ready-header span{font-size:13px;opacity:.75}.quick-ready-minutes{text-align:center;font-size:32px;font-weight:750;font-variant-numeric:tabular-nums}.quick-ready-buttons{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.quick-ready-buttons button{min-width:0;padding:10px 4px}.quick-ready-control #quick-ready-reset{justify-self:end;font-size:12px}.quick-ready-buttons button:disabled{opacity:.35;cursor:not-allowed}.platform-order-dish{display:grid;gap:10px;padding:14px;border:1px solid var(--border,#d8dde5);border-radius:14px;background:var(--surface,#fff)}.platform-dish-top{display:grid;grid-template-columns:minmax(0,1fr) 76px 42px;gap:8px;align-items:center}.platform-dish-top select{width:100%;min-width:0}.platform-dish-top input{width:100%;min-width:0;text-align:center}.platform-dish-top button{min-width:0;padding:8px}.platform-modifiers{display:grid;gap:10px}.platform-mod-group{min-width:0;margin:0;padding:10px 12px 12px;border:1px solid var(--border,#d8dde5);border-radius:10px}.platform-mod-group legend{max-width:100%;padding:0 5px;font-size:13px;font-weight:650;white-space:normal}.platform-mod-hint{font-weight:400;opacity:.65}.platform-mod-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:6px}.platform-mod-option{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:9px;align-items:center;padding:9px 10px;border:1px solid var(--border,#e4e7ec);border-radius:9px;cursor:pointer;min-width:0;margin:0}.platform-mod-option:has(input:checked){border-color:var(--primary,#2563eb);background:rgba(59,130,246,.07)}.platform-mod-option input{margin:0;width:16px;height:16px}.platform-mod-name{min-width:0;overflow-wrap:anywhere;font-size:13px;line-height:1.35}.platform-mod-price{white-space:nowrap;font-size:12px;opacity:.7}.platform-order-dish .platform-mod-option:hover{background:rgba(120,130,150,.07)}@media(max-width:480px){.platform-order-dish{padding:10px}.platform-dish-top{grid-template-columns:minmax(0,1fr) 58px 36px;gap:6px}.platform-mod-options{grid-template-columns:1fr}.platform-mod-option{padding:8px}.platform-mod-group{padding:8px}}.quick-order-sticky{position:sticky;top:-22px;z-index:5;background:var(--surface,#fff);padding:12px 0;display:grid;gap:10px;border-bottom:1px solid var(--border,#ddd)}.quick-order-title{display:flex;align-items:center;justify-content:space-between;gap:12px}.quick-order-title h2{margin:0}.quick-order-sticky #quick-order-submit{width:100%;padding:14px;font-size:16px}.quick-order-meta{display:grid;gap:12px}.quick-platform-buttons{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:8px}.quick-platform-buttons button{min-width:0;padding:11px 5px;white-space:normal}.quick-platform-buttons button[data-quick-platform]{background:var(--quick-brand,#64748B)!important;color:var(--quick-ink,#FFFFFF)!important;border:2px solid transparent!important;font-weight:800;transition:filter .12s,border-color .12s,box-shadow .12s;opacity:.88;filter:saturate(.83)}.quick-platform-buttons button[data-quick-platform]:hover{filter:brightness(1.08);opacity:1}.quick-platform-buttons button[data-quick-platform].selected{background:var(--quick-brand,#64748B)!important;color:var(--quick-ink,#FFFFFF)!important;border:3px solid #ffffff!important;outline:3px solid #1d4ed8;outline-offset:1px;box-shadow:0 0 0 5px #ffffff99,0 4px 12px #0003;opacity:1;filter:none;position:relative}.quick-platform-buttons button[data-quick-platform].selected::after{content:'✓';display:inline-grid;place-items:center;margin-left:9px;background:#fff;color:#1e293b;border-radius:50%;width:19px;height:19px;font-size:12px;font-weight:900}.quick-platform-buttons button[data-quick-platform]:focus-visible{outline:3px solid #2563eb;outline-offset:3px}.quick-platform-buttons button[data-quick-platform]:disabled{opacity:.65;cursor:wait}.quick-platform-buttons button[data-quick-platform].selected:disabled{opacity:1}.quick-order-workspace{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:14px;align-items:start}.quick-order-workspace section{min-width:0;border:1px solid var(--border,#ddd);border-radius:12px;padding:12px;display:grid;gap:10px}.quick-order-workspace h3{margin:0}.quick-order-browser{display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px;min-height:180px;max-height:390px}.quick-order-browser nav,.quick-order-browser #quick-dish-results{overflow-y:auto;display:flex;flex-direction:column;gap:6px;min-width:0}.quick-order-browser button{white-space:normal;text-align:left;overflow-wrap:anywhere;padding:10px 8px}.quick-order-browser nav button.selected{background:var(--primary,#2563eb);color:#fff}.quick-order-current .platform-dish-top select{font-size:12px}@media(max-width:700px){.quick-order-workspace{grid-template-columns:1fr}.quick-order-browser{max-height:310px}.quick-order-sticky{top:-22px}}.quick-selected-name{font-size:16px;font-weight:750;line-height:1.35;overflow-wrap:anywhere}.quick-mod-toggle{text-align:left;justify-self:start}.platform-modifiers[hidden]{display:none!important}.quick-order-current .platform-dish-top{grid-template-columns:minmax(0,1fr) 65px 38px}.quick-order-current .platform-dish-top select{opacity:.8;font-size:11px}`;document.head.append(quickOrderStyle);
 const platforms=[['wolt','Wolt'],['uber_eats','Uber Eats'],['pyszne','Pyszne.pl'],['glovo','Glovo'],['bolt_food','Bolt Food'],['other','Other']];
 form.innerHTML='<div class="quick-order-sticky"><div class="quick-order-title"><h2>Kitchen Quick Entry</h2><button type="button" id="quick-order-cancel" class="alt" aria-label="Close">×</button></div><button type="submit" id="quick-order-submit">Send to Kitchen · <span id="quick-order-count">0 dishes</span></button></div><div class="quick-order-meta"><div><strong>Platform</strong><div class="quick-platform-buttons">'+platforms.map(([v,n])=>{const brand=platformBrand(v);return '<button type="button" data-quick-platform="'+v+'" class="alt" style="--quick-brand:'+brand.color+';--quick-ink:'+brand.ink+'">'+esc(n)+'</button>'}).join('')+'</div><input name="platform" type="hidden" value="wolt"></div><label>Platform order ID<input name="external_order_id" required maxlength="100" placeholder="Enter platform order ID"></label></div><div class="quick-ready-control"><div class="quick-ready-header"><strong>Ready in</strong><span id="quick-ready-time" aria-live="polite"></span></div><div id="quick-ready-minutes" class="quick-ready-minutes">15 min</div><div class="quick-ready-buttons"><button type="button" data-ready-adjust="-10" class="alt">−10</button><button type="button" data-ready-adjust="-5" class="alt">−5</button><button type="button" data-ready-adjust="5" class="alt">+5</button><button type="button" data-ready-adjust="10" class="alt">+10</button></div><button type="button" id="quick-ready-reset" class="alt">Reset to 15 min</button><input name="ready_by" type="hidden"></div><div class="quick-order-workspace"><section class="quick-order-catalog"><h3>Select dishes</h3><input id="quick-dish-search" type="search" placeholder="Search dishes..." aria-label="Search dishes"><div class="quick-order-browser"><nav id="quick-dish-categories" aria-label="Dish categories"></nav><div id="quick-dish-results"></div></div></section><section class="quick-order-current"><h3>Current order</h3><div id="quick-order-items" style="display:grid;gap:8px"></div><label>Kitchen note<textarea name="note" maxlength="500" rows="2"></textarea></label></section></div><p class="muted small">Prices and names follow this store and platform. No automatic payment is recorded.</p>';
 overlay.append(form);document.body.append(overlay);
 const close=()=>{++loading;overlay.remove();quickOrderStyle.remove()};
 form.querySelector('#quick-order-cancel').onclick=close;
 overlay.onclick=e=>{if(e.target===overlay)close()};
 let categoryOrder=[],platformMenu=[],loading=0,platformModifiers={groups:[],options:[],links:[]};
 const itemsNode=form.querySelector('#quick-order-items');
 const choices=()=>platformMenu.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name)+' · '+money(m.price_cents)+'</option>').join('');
 const groupsFor=id=>platformModifiers.groups.filter(g=>platformModifiers.links.some(l=>l.menu_id===id&&l.group_id===g.id));
 const renderModifiers=row=>{
  const menuId=row.querySelector('select[aria-label="Dish"]').value;
  row.querySelector('.quick-selected-name').textContent=platformMenu.find(m=>m.id===menuId)?.name||'Dish';
  const target=row.querySelector('.platform-modifiers');target.innerHTML=groupsFor(menuId).map(g=>{
   const options=platformModifiers.options.filter(o=>o.group_id===g.id);
   return '<fieldset class="platform-mod-group"><legend>'+esc(g.name)+' <span class="platform-mod-hint">'+(g.min_select>0?'Required':'Optional')+' · '+g.min_select+'–'+g.max_select+'</span></legend><div class="platform-mod-options">'+options.map(o=>'<label class="platform-mod-option"><input type="checkbox" data-platform-option="'+esc(o.id)+'" data-platform-group="'+esc(g.id)+'"><span class="platform-mod-name">'+esc(o.name)+'</span><span class="platform-mod-price">'+(Number(o.price_cents)>0?'+':'')+money(o.price_cents)+'</span></label>').join('')+'</div></fieldset>';
  }).join('');
  target.hidden=true;row.querySelector('.quick-mod-toggle').hidden=!target.children.length;row.querySelector('.quick-mod-toggle').textContent=target.children.length?'Modifiers · '+target.children.length+' groups ▾':'';
  target.querySelectorAll('input[type="checkbox"]').forEach(input=>input.onchange=()=>{
   const g=groupsFor(menuId).find(g=>g.id===input.dataset.platformGroup);
   const selected=[...target.querySelectorAll('input[data-platform-group="'+input.dataset.platformGroup+'"]:checked')];
   if(g&&selected.length>g.max_select){input.checked=false;notify('Maximum '+g.max_select+' selections for '+g.name);}
  });
 };
 const add=(selectedMenuId)=>{if(!platformMenu.length){notify('No dishes available for this platform');return}const row=document.createElement('div');row.className='platform-order-dish';row.innerHTML='<div class="quick-selected-name"></div><div class="platform-dish-top"><select aria-label="Dish">'+choices()+'</select><input aria-label="Quantity" type="number" min="1" max="99" value="1"><button type="button" class="alt" aria-label="Remove dish" title="Remove dish">×</button></div><button type="button" class="alt quick-mod-toggle" hidden>Modifiers ▾</button><div class="platform-modifiers"></div>';if(selectedMenuId)row.querySelector('select').value=selectedMenuId;row.querySelector('button').onclick=()=>{row.remove();updateDishCount();form.querySelector('#quick-order-submit').disabled=itemsNode.children.length===0||[...itemsNode.children].some(r=>r.dataset.unavailable==='1')};row.querySelector('.quick-mod-toggle').onclick=()=>{const panel=row.querySelector('.platform-modifiers');panel.hidden=!panel.hidden;row.querySelector('.quick-mod-toggle').textContent=panel.hidden?'Modifiers ▾':'Modifiers ▴'};row.querySelector('select').onchange=()=>{delete row.dataset.unavailable;row.style.border='';renderModifiers(row);form.querySelector('#quick-order-submit').disabled=[...itemsNode.children].some(r=>r.dataset.unavailable==='1')};row.querySelector('input[aria-label="Quantity"]').oninput=updateDishCount;itemsNode.append(row);renderModifiers(row);updateDishCount();form.querySelector('#quick-order-submit').disabled=false;};
 const updateDishCount=()=>{const n=[...itemsNode.children].reduce((sum,row)=>sum+(Number(row.querySelector('input[aria-label="Quantity"]')?.value)||0),0);form.querySelector('#quick-order-count').textContent=n+' '+(n===1?'dish':'dishes')};
 let selectedCategory='All';
 const categoriesNode=form.querySelector('#quick-dish-categories'),resultsNode=form.querySelector('#quick-dish-results'),searchNode=form.querySelector('#quick-dish-search');
 const renderCatalog=()=>{
  const used=[...new Set(platformMenu.map(m=>m.category||'Other'))];const categories=['All',...used.sort((a,b)=>{const ai=categoryOrder.indexOf(a),bi=categoryOrder.indexOf(b);return (ai<0?99999:ai)-(bi<0?99999:bi)||a.localeCompare(b)})];
  if(!categories.includes(selectedCategory))selectedCategory='All';
  categoriesNode.innerHTML=categories.map(cat=>'<button type="button" data-quick-category="'+esc(cat)+'" class="alt '+(cat===selectedCategory?'selected':'')+'">'+esc(cat)+'</button>').join('');
  categoriesNode.querySelectorAll('[data-quick-category]').forEach(button=>button.onclick=()=>{selectedCategory=button.dataset.quickCategory;renderCatalog()});
  const q=searchNode.value.trim().toLowerCase();
  const visible=platformMenu.filter(m=>(selectedCategory==='All'||(m.category||'Other')===selectedCategory)&&m.name.toLowerCase().includes(q));
  resultsNode.innerHTML=visible.map(m=>'<button type="button" class="alt" data-quick-dish="'+esc(m.id)+'"><strong>'+esc(m.name)+'</strong><small style="display:block;opacity:.7">'+money(m.price_cents)+'</small></button>').join('')||'<p class="muted">No matching dishes</p>';
  resultsNode.querySelectorAll('[data-quick-dish]').forEach(button=>button.onclick=()=>add(button.dataset.quickDish));
 };
 searchNode.oninput=renderCatalog;
 const renderPlatforms=()=>form.querySelectorAll('[data-quick-platform]').forEach(button=>{button.classList.toggle('selected',button.dataset.quickPlatform===form.elements.platform.value);button.setAttribute('aria-pressed',String(button.dataset.quickPlatform===form.elements.platform.value))});
 form.querySelectorAll('[data-quick-platform]').forEach(button=>button.onclick=()=>{form.elements.platform.value=button.dataset.quickPlatform;form.elements.platform.onchange()});
 renderPlatforms();
 const load=async()=>{const current=++loading;const platform=form.elements.platform.value;form.querySelector('#quick-order-submit').disabled=true;form.querySelectorAll('[data-quick-platform]').forEach(button=>button.disabled=true);try{const [result,modifiers,categories]=await Promise.all([api('/quick-order/menu?platform='+encodeURIComponent(platform)),api('/menu/modifiers'),api('/kitchen/categories')]);if(current!==loading)return;const snapshots=[...itemsNode.children].map(row=>({id:row.querySelector('select[aria-label="Dish"]').value,name:row.querySelector('.quick-selected-name').textContent,quantity:row.querySelector('input[aria-label="Quantity"]').value,selected:[...row.querySelectorAll('[data-platform-option]:checked')].map(el=>el.dataset.platformOption),expanded:!row.querySelector('.platform-modifiers').hidden}));
platformMenu=result;platformModifiers=modifiers;categoryOrder=categories.map(x=>x.name);
let unavailable=0,changedOptions=0;
for(let index=0;index<snapshots.length;index++){
 const snapshot=snapshots[index],row=itemsNode.children[index],select=row.querySelector('select[aria-label="Dish"]');
 if(!platformMenu.some(m=>m.id===snapshot.id)){
  unavailable++;
  row.dataset.unavailable='1';
  select.innerHTML='<option value="'+esc(snapshot.id)+'">'+esc(snapshot.name)+' · Unavailable on '+esc(platform)+'</option>'+choices();
  row.querySelector('.quick-selected-name').textContent=snapshot.name+' · Unavailable on '+platform;
  row.style.border='2px solid #ef4444';
  continue;
 }
 delete row.dataset.unavailable;row.style.border='';
 select.innerHTML=choices();select.value=snapshot.id;
 renderModifiers(row);
 for(const input of row.querySelectorAll('[data-platform-option]'))input.checked=snapshot.selected.includes(input.dataset.platformOption);
 changedOptions+=snapshot.selected.filter(id=>!row.querySelector('[data-platform-option="'+CSS.escape(id)+'"]')).length;
 row.querySelector('.platform-modifiers').hidden=!snapshot.expanded;
}
updateDishCount();selectedCategory='All';renderCatalog();
if(unavailable)notify(unavailable+' dish(es) unavailable on '+platform+'. Choose a replacement or remove them before sending.',{kind:'warning',duration:6500});
else if(changedOptions)notify('Some modifiers are unavailable on '+platform+'. Please review the selections.',{kind:'warning',duration:6500});
if(!result.length)notify('No available dishes for '+platform);
form.querySelector('#quick-order-submit').disabled=!itemsNode.children.length||!!unavailable;}catch(e){if(current===loading)notify('Platform menu failed: '+e.message);}finally{if(current===loading)form.querySelectorAll('[data-quick-platform]').forEach(button=>button.disabled=false)}};
 let loadedPlatform=form.elements.platform.value;
 form.elements.platform.onchange=async()=>{
  const next=form.elements.platform.value;
  if(next===loadedPlatform)return;
  loadedPlatform=next;renderPlatforms();await load();
 };

 const openedAt=Date.now();
 const deadlineInput=form.elements.ready_by;
 let readyMinutes=15;
 const readyTime=form.querySelector('#quick-ready-time');
 const readyMinutesLabel=form.querySelector('#quick-ready-minutes');
 const readyButtons=[...form.querySelectorAll('[data-ready-adjust]')];
 const renderReady=()=>{
  const deadline=new Date(openedAt+readyMinutes*60000);
  deadlineInput.value=deadline.toISOString();
  readyMinutesLabel.textContent=readyMinutes+' min';
  readyTime.textContent='Ready at '+deadline.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  readyButtons.forEach(button=>{const next=readyMinutes+Number(button.dataset.readyAdjust);button.disabled=next<5||next>120});
 };
 readyButtons.forEach(button=>button.onclick=()=>{readyMinutes=Math.max(5,Math.min(120,readyMinutes+Number(button.dataset.readyAdjust)));renderReady()});
 form.querySelector('#quick-ready-reset').onclick=()=>{readyMinutes=15;renderReady()};
 const checkDeadline=()=>{
  const deadline=openedAt+readyMinutes*60000,now=Date.now();
  if(deadline<=now){notify('Ready time has passed. Reset the timer before sending.');return false}
  if(deadline>now+48*3600000){notify('Ready time must be within 48 hours.');return false}
  return true;
 };
 renderReady();
 let pendingKey=crypto.randomUUID();
 form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('#quick-order-submit');button.disabled=true;try{
  if(!checkDeadline())throw Error('Ready time must be in the future. Reset the timer if needed.');
  const items=[...itemsNode.children].map(row=>{const menu_id=row.querySelector('select[aria-label="Dish"]').value;const option_ids=[...row.querySelectorAll('[data-platform-option]:checked')].map(el=>el.dataset.platformOption);for(const g of groupsFor(menu_id)){const selected=option_ids.filter(id=>platformModifiers.options.some(o=>o.id===id&&o.group_id===g.id)).length;if(selected<g.min_select||selected>g.max_select)throw Error('Select '+g.min_select+'–'+g.max_select+' options for '+g.name);}return {menu_id,quantity:Number(row.querySelector('input[aria-label="Quantity"]').value),option_ids};});
  if(!items.length)throw Error('Add at least one dish');
  if(items.some(item=>!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>99||!platformMenu.some(m=>m.id===item.menu_id)))throw Error('Dish quantities must be whole numbers from 1 to 99');
  const result=await api('/quick-orders','POST',{platform:form.elements.platform.value,external_order_id:form.elements.external_order_id.value,ready_by:deadlineInput.value,note:form.elements.note.value,items,client_key:pendingKey});
  close();notify('Platform Order created · '+result.id.slice(0,8));await refresh();
 }catch(err){notify('Platform Order failed: '+err.message);button.disabled=false;}};
 await load();
}

document.addEventListener('click',e=>{if(e.target.closest('#pos-courier-queue'))openCourierCollection();});
document.addEventListener('click',e=>{const button=e.target.closest('[data-platform-edit]');if(button)editPlatformOrder(button.dataset.platformEdit);});
function render(){if(!token){login();return}if(page==='pos')pos();else if(page==='kitchen')kitchen();else if(page==='admin')admin();}
function categoryButtons(){return `<div class="chips">${['All',...new Set(menu.map(x=>x.category))].map(x=>`<button data-cat="${esc(x)}" class="${category===x?'selected':''}">${esc(x)}</button>`).join('')}</div>`;}

function money(c){return (c/100).toFixed(2)+' zł'}
function itemGroups(id){return modifierCatalog.groups.filter(g=>modifierCatalog.links.some(l=>l.menu_id===id&&l.group_id===g.id))}
function cartUnitPrice(line){const m=menu.find(x=>x.id===line.menu_id);const base=m?.price_cents||0,extras=line.option_ids.reduce((n,id)=>n+(modifierCatalog.options.find(o=>o.id===id)?.price_cents||0),0);return base-Math.round(base*(line.discount_percent||0)/100)+extras}
function openItem(id){saveFields();itemDialog={menu_id:id,quantity:1,option_ids:[],note:'',discount_percent:0};showItemDialog()}
function itemModal(){if(!itemDialog)return '';const m=menu.find(x=>x.id===itemDialog.menu_id);if(!m)return '';return '<div class="item-dialog-backdrop"><section class="item-dialog" role="dialog" aria-modal="true"><div class="row"><h2>'+esc(m.name)+'</h2><button class="alt" id="item-close">✕</button></div><p class="muted">Base price '+money(m.price_cents)+'</p>'+itemGroups(m.id).map(g=>{const selected=itemDialog.option_ids.filter(id=>modifierCatalog.options.some(o=>o.id===id&&o.group_id===g.id));return '<fieldset class="modifier-fieldset"><legend>'+esc(g.name)+' <small class="muted">'+(g.min_select?'Required':'Optional')+' · '+g.min_select+'–'+g.max_select+'</small></legend>'+modifierCatalog.options.filter(o=>o.group_id===g.id).map(o=>'<label class="modifier-choice"><input type="'+(g.max_select===1?'radio':'checkbox')+'" name="group-'+esc(g.id)+'" value="'+esc(o.id)+'" '+(selected.includes(o.id)?'checked':'')+'><span>'+esc(o.name)+'</span><b>'+(o.price_cents?'+'+money(o.price_cents):'Included')+'</b></label>').join('')+'</fieldset>'}).join('')+'<fieldset class="modifier-fieldset"><legend>Discount</legend><label class="modifier-choice"><input type="radio" name="item-discount" value="0" '+(!itemDialog.discount_percent?'checked':'')+'>No discount</label><label class="modifier-choice"><input type="radio" name="item-discount" value="20" '+(itemDialog.discount_percent===20?'checked':'')+'>20% – Member</label><label class="modifier-choice"><input type="radio" name="item-discount" value="50" '+(itemDialog.discount_percent===50?'checked':'')+'>50% – Finebite</label></fieldset>'+'<label>Item note<textarea id="item-note" rows="2" placeholder="Special instructions">'+esc(itemDialog.note)+'</textarea></label><div class="row"><span>Quantity</span><div class="toolbar"><button class="alt" id="item-dec">−</button><b>'+itemDialog.quantity+'</b><button class="alt" id="item-inc">+</button></div></div><button id="item-confirm">Add to order · '+money(cartUnitPrice(itemDialog)*itemDialog.quantity)+'</button></section></div>'}

function ticketTotal(o){return (o.items||[]).reduce((n,i)=>n+(Number(i.price_cents)||0)*i.quantity,0)}
function activeTickets(){return orders.filter(o=>!o.platform&&o.status!=='cancelled'&&(!o.paid_at||(o.source==='dinein'?o.table_occupied:!o.kitchen_completed_at)))}
function tableTicket(no){return activeTickets().find(o=>o.source==='dinein'&&o.table_no===no&&o.table_occupied)}
function selectTable(no){orderReturnTab='tables';if(configuredCart.length&&!confirm('Discard the current unsent items?'))return;const o=tableTicket(no);table=no;type='dinein';editingOrder=o&&!o.paid_at?o.id:'';followupPaidOrderId=o?.paid_at?o.id:'';configuredCart=[];note='';itemDialog=null;pendingKey=crypto.randomUUID();fohTab='order';pos()}
function selectTicket(id){orderReturnTab='tickets';const o=activeTickets().find(o=>o.id===id);if(!o)return notify('Ticket is no longer open');if(o.paid_at&&o.source!=='dinein')return notify('Already paid');if(configuredCart.length&&!confirm('Discard the current unsent items?'))return;editingOrder=o.paid_at?'':id;followupPaidOrderId=o.paid_at?id:'';type=o.source;table=o.table_no||'01';configuredCart=[];note='';itemDialog=null;pendingKey=crypto.randomUUID();fohTab='order';pos()}
function updateCartView(){const root=document.querySelector('#pos-cart');if(!root)return;root.innerHTML=configuredCart.map((line,i)=>{const m=menu.find(x=>x.id===line.menu_id);return '<div class="foh-cart-line"><div><strong>'+esc(m?.name||'Item')+' × '+line.quantity+'</strong><small>'+esc(line.option_ids.map(id=>modifierCatalog.options.find(o=>o.id===id)?.name||'').filter(Boolean).join(', '))+(line.discount_percent?' · '+line.discount_percent+'% discount':'')+(line.note?' · '+esc(line.note):'')+'</small></div><div><b>'+money(cartUnitPrice(line)*line.quantity)+'</b><button class="alt" data-remove-line="'+i+'">Remove</button></div></div>'}).join('')||'<p class="muted">Choose a dish to start the order.</p>';root.querySelectorAll('[data-remove-line]').forEach(b=>b.onclick=()=>{configuredCart.splice(Number(b.dataset.removeLine),1);updateCartView()});document.querySelector('#pos-total').textContent=money(configuredCart.reduce((n,line)=>n+cartUnitPrice(line)*line.quantity,0));document.querySelector('#submit').disabled=!configuredCart.length||busy}
function showItemDialog(){document.querySelector('.item-dialog-backdrop')?.remove();if(!itemDialog)return;document.body.insertAdjacentHTML('beforeend',itemModal());const close=()=>{itemDialog=null;document.querySelector('.item-dialog-backdrop')?.remove()};const rerender=()=>{itemDialog.note=document.querySelector('#item-note')?.value||'';showItemDialog()};document.querySelector('#item-close').onclick=close;document.querySelectorAll('input[name="item-discount"]').forEach(input=>input.onchange=()=>{itemDialog.note=document.querySelector('#item-note')?.value||'';itemDialog.discount_percent=Number(input.value);showItemDialog()});document.querySelector('.item-dialog-backdrop').addEventListener('click',e=>{if(e.target.classList.contains('item-dialog-backdrop'))close()});document.querySelector('#item-dec').onclick=()=>{itemDialog.quantity=Math.max(1,itemDialog.quantity-1);rerender()};document.querySelector('#item-inc').onclick=()=>{itemDialog.quantity=Math.min(99,itemDialog.quantity+1);rerender()};document.querySelectorAll('.modifier-choice input[name^="group-"]').forEach(input=>input.onchange=()=>{itemDialog.note=document.querySelector('#item-note').value;const o=modifierCatalog.options.find(x=>x.id===input.value),g=itemGroups(itemDialog.menu_id).find(x=>x.id===o?.group_id);if(!g)return;const ids=itemDialog.option_ids.filter(id=>modifierCatalog.options.find(x=>x.id===id)?.group_id!==g.id);const current=itemDialog.option_ids.filter(id=>modifierCatalog.options.find(x=>x.id===id)?.group_id===g.id);if(g.max_select===1)itemDialog.option_ids=[...ids,...(input.checked?[input.value]:[])];else{const next=input.checked?[...current,input.value]:current.filter(id=>id!==input.value);if(next.length>g.max_select){notify('Maximum '+g.max_select+' selections');input.checked=false;return}itemDialog.option_ids=[...ids,...next]}showItemDialog()});document.querySelector('#item-confirm').onclick=()=>{const groups=itemGroups(itemDialog.menu_id);if(groups.some(g=>{const n=itemDialog.option_ids.filter(id=>modifierCatalog.options.find(o=>o.id===id&&o.group_id===g.id)).length;return n<g.min_select||n>g.max_select})){notify('Please complete required selections');return}itemDialog.note=document.querySelector('#item-note').value;configuredCart.push({...itemDialog});close();updateCartView()}}
let posReservationError='';let posReservationFilter='today',posReservationFrom='',posReservationTo='';
let posReservations=[],posReservationLoaded=false,posReservationLoading=false,posReservationReloadPending=false,posReservationAlerts=new Set();
const reservationEventQueue=[],reservationEventSeen=new Set();
function queueReservationEvent(data){
 if(page!=='pos'||!currentDeviceStore||!data?.reservation||data.reservation.store_id!==currentDeviceStore.id)return;
 const r=data.reservation,action=data.action;
 if(!['created','updated','cancelled'].includes(action))return;
 const key=currentDeviceStore.id+':'+r.id+':'+action+':'+r.starts_at+':'+r.status+':'+r.party_size+':'+r.guest_name+':'+r.phone+':'+r.note;
 if(reservationEventSeen.has(key))return;
 reservationEventSeen.add(key);reservationEventQueue.push({reservation:r,action});
 if(reservationEventQueue.length>100)reservationEventQueue.shift();
 showNextReservationEvent();
}
function showNextReservationEvent(){
 if(page!=='pos'||document.hidden||document.querySelector('[id^="reservation-event-"]')||document.querySelector('[id^="reservation-reminder-"]'))return;
 const event=reservationEventQueue.shift();if(!event)return;
 const r=event.reservation;
 const labels={created:'NEW RESERVATION',updated:'RESERVATION UPDATED',cancelled:'RESERVATION CANCELLED'};
 const el=document.createElement('div');el.id='reservation-event-'+r.id;el.className='reservation-alert-overlay';
 el.innerHTML='<section class="reservation-alert-card" role="alertdialog" aria-modal="true" aria-label="'+labels[event.action]+'"><div class="reservation-alert-icon">📅</div><span class="reservation-alert-kicker">'+labels[event.action]+'</span><h2>'+esc(r.starts_at.replace('T',' · '))+'</h2><div class="reservation-alert-guests">'+Number(r.party_size)+' guests · '+esc(r.guest_name||'Guest')+'</div><div class="reservation-alert-details"><div><small>PHONE</small><strong>'+esc(r.phone||'—')+'</strong></div><div><small>NOTES</small><strong>'+esc(r.note||'No notes')+'</strong></div></div><div class="reservation-alert-actions"><button type="button" data-reservation-view>View reservations</button><button type="button" class="alt" data-reservation-dismiss>Dismiss</button></div></section>';
 document.body.append(el);sound();
 const close=()=>{el.remove();showNextReservationEvent()};
 el.querySelector('[data-reservation-dismiss]').onclick=close;
 el.querySelector('[data-reservation-view]').onclick=()=>{close();fohTab='reservations';pos()};
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)showNextReservationEvent()});
function warsawDay(offset=0){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(Date.now()+offset*86400000));const v=k=>parts.find(p=>p.type===k).value;return v('year')+'-'+v('month')+'-'+v('day')}
let reservationCatchUpPending=false;
async function catchUpReservationEvents(){
 if(reservationCatchUpPending)return;
 if(page!=='pos'||!currentDeviceStore?.id)return;
 const store=currentDeviceStore.id,epoch=storeEpoch,key='ck_reservation_cursor_'+store;
 let since=localStorage.getItem(key);
 if(!since){localStorage.setItem(key,new Date().toISOString());return;}
 reservationCatchUpPending=true;const requestedAt=new Date().toISOString();
 try{
  const data=await api('/reservations?changed_since='+encodeURIComponent(since));
  if(epoch!==storeEpoch||store!==currentDeviceStore?.id)return;
  const changes=data.changes||[];
  for(const r of changes){
   if(r.status==='arrived'||r.status==='no_show')continue;
   queueReservationEvent({action:r.status==='cancelled'?'cancelled':r.created_at===r.updated_at?'created':'updated',reservation:r});
  }
  if(changes.length<200)localStorage.setItem(key,requestedAt);
  else if(changes.length)localStorage.setItem(key,changes[changes.length-1].updated_at);
 }catch(e){console.warn('Reservation change sync unavailable',e)}finally{reservationCatchUpPending=false}
}
async function loadPosReservations(){
 if(page!=='pos'||!currentDeviceStore?.id)return;
 catchUpReservationEvents();
 if(posReservationLoading){posReservationReloadPending=true;return;}
 posReservationLoading=true;const store=currentDeviceStore.id,epoch=storeEpoch;
 try{const today=warsawDay(),tomorrow=warsawDay(1),yesterday=warsawDay(-1);
 const defaultFrom=posReservationFilter==='past'?'2000-01-01':posReservationFilter==='all'?'2000-01-01':posReservationFilter==='upcoming'?tomorrow:today;
 const defaultTo=posReservationFilter==='past'?yesterday:posReservationFilter==='today'?today:'2100-12-31';
 const from=posReservationFrom||defaultFrom,to=posReservationTo||defaultTo;
 const data=await api('/reservations?from='+from+'&to='+to);
 if(epoch!==storeEpoch||store!==currentDeviceStore?.id)return;
 posReservationError='';posReservations=(data.reservations||[]).filter(r=>posReservationFilter==='all'||posReservationFrom||posReservationTo||posReservationFilter==='today'?true:posReservationFilter==='past'?r.starts_at.slice(0,10)<today:r.starts_at.slice(0,10)>today);posReservationLoaded=true;
 const nowParts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
 const value=k=>nowParts.find(p=>p.type===k).value;
 const warsawNow=value('year')+'-'+value('month')+'-'+value('day')+'T'+value('hour')+':'+value('minute');
 const minuteValue=stamp=>{const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(stamp);return m?Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5])/60000:NaN};
 const currentMinute=minuteValue(warsawNow);
 for(const r of posReservations){const diff=minuteValue(r.starts_at)-currentMinute;if(r.status==='booked'&&diff>=-5&&diff<=30&&!document.hidden&&!posReservationAlerts.has(r.id+'@'+r.starts_at)){if(showReservationAlert(r))posReservationAlerts.add(r.id+'@'+r.starts_at);}}
 if(fohTab==='reservations')pos();
 }catch(e){posReservationError=e.message||'Unable to load reservations';if(fohTab==='reservations')pos();console.warn('Reservations unavailable',e)}finally{posReservationLoading=false;if(posReservationReloadPending){posReservationReloadPending=false;loadPosReservations()}}
}
function showReservationAlert(r){
 if(page!=='pos'||document.hidden)return false;
 const id='reservation-reminder-'+r.id;
 if(document.getElementById(id)||document.querySelector('[id^="reservation-reminder-"]'))return false;
 const el=document.createElement('div');el.id=id;el.className='admin-modal-backdrop';
 el.innerHTML='<section class="admin-modal" role="alertdialog" aria-modal="true" aria-label="Upcoming reservation"><div class="admin-modal-head"><div><span class="admin-eyebrow">UPCOMING RESERVATION</span><h2>'+esc(r.starts_at.slice(11))+' · '+Number(r.party_size)+' guests</h2></div></div><p><strong>'+esc(r.guest_name||'Guest')+'</strong></p><p>'+esc(r.note||'No notes')+'</p><div class="admin-modal-actions"><button type="button" data-reservation-view>View reservations</button><button type="button" class="alt" data-reservation-dismiss>Dismiss</button></div></section>';
 document.body.append(el);
 el.querySelector('[data-reservation-dismiss]').onclick=()=>el.remove();
 el.querySelector('[data-reservation-view]').onclick=()=>{el.remove();fohTab='reservations';pos()};
 return true;
}
function posReservationPanel(){
 const filters='<div class="reservation-filters"><div class="reservation-filter-tabs">'+[['today','Today'],['upcoming','Upcoming'],['past','Past'],['all','All reservations']].map(([id,label])=>'<button type="button" data-reservation-filter="'+id+'" class="'+(posReservationFilter===id?'active':'')+'">'+label+'</button>').join('')+'</div><label>From<input type="date" id="pos-reservation-from" value="'+esc(posReservationFrom)+'"></label><label>To<input type="date" id="pos-reservation-to" value="'+esc(posReservationTo)+'"></label><button type="button" class="alt" id="pos-reservations-refresh">Refresh</button></div>';
 const warsawTime=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()).replace(' ','T');
 const rows=[...posReservations].sort((a,b)=>posReservationFilter==='past'?b.starts_at.localeCompare(a.starts_at):a.starts_at.localeCompare(b.starts_at));
 return '<section class="panel foh-workspace reservation-workspace"><div class="row"><div><h2>Reservations</h2><p class="muted">Bookings for this restaurant · Warsaw local time</p></div><span class="reservation-count">'+rows.length+' bookings</span></div>'+filters+
 (rows.length?'<div class="reservation-table-wrap"><table class="reservation-table"><thead><tr><th>Date & time</th><th>Guest</th><th>Party</th><th>Phone</th><th>Notes</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+rows.map(r=>'<tr><td><strong>'+esc(r.starts_at.slice(0,10))+'</strong><small>'+esc(r.starts_at.slice(11))+'</small></td><td><strong>'+esc(r.guest_name||'Guest')+'</strong></td><td>'+Number(r.party_size)+' guests</td><td>'+esc(r.phone||'—')+'</td><td class="reservation-notes">'+esc(r.note||'—')+'</td><td><span class="reservation-status reservation-status-'+esc(r.status)+'">'+esc(r.status.replace('_',' '))+'</span></td><td>'+(r.status==='booked'?'<div class="reservation-actions"><button type="button" data-pos-reservation-arrived="'+esc(r.id)+'" data-reservation-action="arrived">Arrived</button><button type="button" class="alt" data-pos-reservation-arrived="'+esc(r.id)+'" data-reservation-action="no-show">No-show</button></div>':'—')+'</td></tr>').join('')+'</tbody></table></div>':'<div class="reservation-empty"><strong>No reservations in this view</strong><p>Try another period or select All reservations.</p></div>')+'</section>';
}
function pos(){const active=activeTickets(),selected=active.find(o=>o.id===editingOrder),occupied=new Set(tableState.filter(t=>t.occupied).map(t=>t.number));const availableTables=Array.from({length:20},(_,i)=>String(i+1).padStart(2,'0')).filter(no=>!occupied.has(no));if(!selected&&type==='dinein'&&!availableTables.includes(table))table=availableTables[0]||'';const tabs='<div class="foh-tabs">'+[['order','New Order'],['tickets','Open Tickets ('+active.length+')'],['tables','Tables'],['reservations','Reservations'],['history','History'],['platform','Platform Orders ('+orders.filter(o=>o.platform&&!o.collected_at&&o.status!=='cancelled'&&o.kitchen_completed_at).length+'/'+orders.filter(o=>o.platform&&!o.collected_at&&o.status!=='cancelled').length+')']].map(([id,label])=>'<button class="'+(fohTab===id?'active':'')+'" data-foh-tab="'+id+'">'+label+'</button>').join('')+'</div>';
const history='<section class="panel foh-workspace"><h2>Payment History</h2>'+
'<div class="foh-history-filters"><label>Period<select id="pos-history-range">'+[['today','Today'],['yesterday','Yesterday'],['last_three','Last 3 Days']].map(([v,n])=>'<option value="'+v+'" '+(posHistoryRange===v?'selected':'')+'>'+n+'</option>').join('')+'</select></label>'+

'<label>Payment method<select id="pos-history-method">'+[['all','All methods'],['card','Card'],['cash','Cash'],['other','Other']].map(([v,n])=>'<option value="'+v+'" '+(posHistoryMethod===v?'selected':'')+'>'+n+'</option>').join('')+'</select></label>'+
'<label>Search<input id="pos-history-search" placeholder="Table / order ID" value="'+esc(posHistoryQuery)+'"></label><button id="pos-history-find">Apply filters</button></div>'+
'<div class="foh-history-summary"><div><small>Paid orders</small><strong>'+Number(posHistoryResult.total||0)+'</strong></div><div><small>Total sales</small><strong>'+money(posHistoryResult.summary?.total_cents||0)+'</strong></div><div><small>Card</small><strong>'+money(posHistoryResult.summary?.card_cents||0)+'</strong></div><div><small>Cash</small><strong>'+money(posHistoryResult.summary?.cash_cents||0)+'</strong></div><div><small>Other</small><strong>'+money(posHistoryResult.summary?.other_cents||0)+'</strong></div></div>'+

(posHistoryResult.orders.length?posHistoryResult.orders.map(o=>'<button type="button" class="foh-history-row" data-pos-history-detail="'+esc(o.id)+'"><b>'+(o.source==='dinein'?'Table '+esc(o.table_no):esc(sourceName[o.source]||o.source))+'</b> #'+esc(o.id.slice(0,8))+' · '+money(o.amount_cents||0)+' · '+esc(o.method||'Unknown')+'<small>Paid '+posDetailTime(o.paid_at)+' · Kitchen '+(o.kitchen_completed_at?posDetailTime(o.kitchen_completed_at):'Pending')+'</small><span class="foh-history-open">View order details →</span></button>').join(''):'<p class="muted">No payments match these filters.</p>')+
'<div class="toolbar"><button id="pos-history-prev" '+(posHistoryPage<=1?'disabled':'')+'>Previous</button><span>Page '+posHistoryPage+' / '+Math.max(1,Math.ceil(posHistoryResult.total/15))+'</span><button id="pos-history-next" '+(posHistoryPage*15>=posHistoryResult.total?'disabled':'')+'>Next</button></div></section>';
const tables='<section class="panel foh-workspace"><div class="foh-title"><div><h2>Tables</h2><p>Tap an available table to start an order, or an occupied table to continue.</p></div><span class="foh-count">'+occupied.size+' / 20 occupied</span></div><div class="foh-table-grid">'+Array.from({length:20},(_,i)=>{const no=String(i+1).padStart(2,'0'),o=tableTicket(no),conflict=tableState.find(t=>t.number===no)?.conflict;return '<button class="foh-table '+(o?'occupied':'available')+'" data-table-no="'+no+'"><small>TABLE</small><strong>'+no+'</strong><span>'+(conflict?'Check duplicates':o?(o.paid_at?'PAID · ':'Open · ')+money(ticketTotal(o)):'Available')+'</span></button>'+(o&&o.paid_at?'<button class="foh-table-release" data-release-table="'+esc(o.id)+'">Release Table '+no+'</button>':'')}).join('')+'</div></section>';
const tickets='<section class="panel foh-workspace"><div class="foh-title"><div><h2>Open Tickets</h2><p>Live kitchen progress · payment and table release are separate.</p></div></div><div class="foh-ticket-grid">'+active.map(o=>'<article class="foh-ticket '+(o.paid_at?'foh-ticket-paid':'foh-ticket-unpaid')+'"><div class="foh-ticket-top"><strong>'+(o.source==='dinein'?'Table '+esc(o.table_no):esc(sourceName[o.source]||o.source))+'</strong><span class="foh-kitchen-state '+(o.kitchen_completed_at?'ready':o.items.some(i=>i.is_done)?'cooking':Date.now()-Date.parse(o.created_at)>900000?'waiting':'new')+'">'+(o.kitchen_completed_at?'READY':o.items.some(i=>i.is_done)?'COOKING':Date.now()-Date.parse(o.created_at)>900000?'WAITING LONG':'NEW')+'</span></div><small>#'+esc(o.id.slice(0,8))+' · '+(o.items||[]).length+' items</small><div class="foh-progress"><span style="width:'+Math.round(100*(o.items||[]).filter(i=>i.is_done).length/Math.max(1,(o.items||[]).length))+'%"></span></div><small>'+(o.items||[]).filter(i=>i.is_done).length+'/'+(o.items||[]).length+' done</small><details><summary>Dish status</summary><div class="foh-ticket-items">'+(o.items||[]).map(i=>'<div class="foh-ticket-item"><span><strong>'+Number(i.quantity)+' × '+esc(i.name)+'</strong>'+(i.modifiers?.length?'<small>'+esc(i.modifiers.map(m=>m.name).join(', '))+'</small>':'')+(i.note?'<small>'+esc(i.note)+'</small>':'')+'</span><span class="foh-item-status">'+(i.is_done?'✓ Done':'Pending')+'</span></div>').join('')+'</div></details>'+(o.note?'<p class="foh-ticket-note">Note: '+esc(o.note)+'</p>':'')+'<h3>'+money(ticketTotal(o))+'</h3><p class="foh-payment">'+(o.paid_at?'✓ PAID · '+({cash:'💵 Cash',card:'💳 Card',other:'▣ Other'}[o.payment?.method]||'Paid')+' · '+money(o.payment?.amount_cents??ticketTotal(o)):'UNPAID')+'</p><div class="foh-ticket-actions">'+(!o.paid_at?'<button class="alt" data-open-ticket="'+esc(o.id)+'">Add items</button>'+(!o.platform?(!o.kitchen_completed_at?'<button class="alt" data-edit-ticket="'+esc(o.id)+'">Edit Ticket</button>':'')+'<button class="danger" data-void-ticket="'+esc(o.id)+'">Void Ticket</button>':'')+'<button data-checkout="'+esc(o.id)+'">Checkout</button>':'')+(o.source==='dinein'&&o.paid_at&&o.table_occupied?'<button class="alt" data-release-table="'+esc(o.id)+'">Release Table</button>':'')+'</div></article>').join('')+'</div>'+(active.length?'':'<div class="foh-empty-tickets"><span class="foh-empty-symbol" aria-hidden="true">✓</span><strong>All caught up</strong><p>No open tickets right now. New orders will appear here automatically.</p></div>')+pickupQueueHtml()+'</section>';
const order='<div class="layout foh-order"><section><div class="panel"><div class="foh-title"><div><h2>'+(selected?'Add items · '+(selected.source==='dinein'?'Table '+esc(selected.table_no):esc(sourceName[selected.source])):type==='dinein'?'New order · Table '+esc(table):'New '+esc(sourceName[type])+' order')+'</h2><p>'+(selected?'New dishes are sent to the existing kitchen ticket.':'Select dishes and send to kitchen.')+'</p></div>'+(selected?'<button class="alt foh-back-top" id="back-from-add">← Back to '+(orderReturnTab==='tables'?'Tables':'Open Tickets')+'</button>':'')+'</div><div class="toolbar"><select id="type" '+(selected?'disabled':'')+'><option value="dinein" '+(type==='dinein'?'selected':'')+'>Dine-in</option><option value="takeaway" '+(type==='takeaway'?'selected':'')+'>Takeaway</option><option value="delivery" '+(type==='delivery'?'selected':'')+'>Delivery (manual)</option></select>'+(type==='dinein'?'<select id="table" '+(selected?'disabled':'')+'>'+(selected?'<option value="'+esc(selected.table_no)+'" selected>Table '+esc(selected.table_no)+'</option>':availableTables.length?availableTables.map(no=>'<option value="'+no+'" '+(table===no?'selected':'')+'>Table '+no+'</option>').join(''):'<option value="" selected>No available tables</option>')+'</select>':'')</div>'+categoryButtons()+'<div class="menu">'+menu.filter(m=>category==='All'||m.category===category).map(m=>'<button data-configure="'+esc(m.id)+'">'+(m.image_url?'<img class="dish-photo" src="'+esc(m.image_url)+'" alt="" loading="lazy">':'')+'<strong>'+esc(m.name)+'</strong><span class="muted">'+money(m.price_cents)+'</span></button>').join('')+'</div></div></section><aside><div class="panel foh-cart-panel"><h3>'+ (selected?'Additional items':'Current order')+'</h3><div id="pos-cart"></div><label>Order note</label><textarea id="note" rows="3">'+esc(note)+'</textarea><div class="row"><b>New items total</b><b id="pos-total">0.00 zł</b></div><button id="submit"> '+(selected?'Send additional items':'Send to kitchen')+'</button>'+(selected?'<button class="alt" id="checkout-selected">Checkout · '+money(ticketTotal(selected))+'</button>':'')+'<button class="alt" id="clear">Cancel / Back</button></div></aside></div>';
shell('<div class="foh-head"><div><small>FRONT OF HOUSE</small><h1>Restaurant POS</h1><p>Table management, tickets and kitchen orders</p></div><div class="pickup-top-actions"><button type="button" id="pickup-sound">'+(pickupSoundReady?'🔊 Alerts enabled · Tap to test':'🔔 Enable pickup sound')+'</button><button type="button" id="pickup-nav">🔔 Pickup Queue <span id="pickup-count">'+pickupItems.length+'</span></button><span class="foh-count">'+active.length+' open tickets</span></div></div>'+tabs+(fohTab==='tables'?tables:fohTab==='tickets'?tickets:fohTab==='history'?history:fohTab==='reservations'?posReservationPanel():fohTab==='platform'?(platformHistoryOpen?platformHistoryHtml():platformWorkspaceHtml()):order));
if(fohTab==='platform'){if(platformHistoryOpen)bindPlatformHistory();else bindPlatformWorkspace();}
if(fohTab==='reservations'){document.querySelector('#pos-reservations-refresh').onclick=()=>loadPosReservations();document.querySelectorAll('[data-reservation-filter]').forEach(b=>b.onclick=()=>{posReservationFilter=b.dataset.reservationFilter;posReservationFrom='';posReservationTo='';loadPosReservations();pos()});for(const [id,key] of [['pos-reservation-from','from'],['pos-reservation-to','to']])document.querySelector('#'+id).onchange=e=>{if(key==='from')posReservationFrom=e.target.value;else posReservationTo=e.target.value;posReservationFilter='all';loadPosReservations();pos()};document.querySelectorAll('[data-pos-reservation-arrived]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('/reservations/'+b.dataset.posReservationArrived+'/'+b.dataset.reservationAction,'POST',{});await loadPosReservations();pos()}catch(e){b.disabled=false;notify(e.message)}})}
document.querySelector('#pickup-sound').onclick=enablePickupSound;
document.querySelector('#pickup-nav').onclick=openPickupQueue;
document.querySelectorAll('[data-pickup-ack]').forEach(b=>b.onclick=()=>acknowledgePickup(b.dataset.pickupAck));
document.querySelectorAll('[data-pickup-all]').forEach(b=>b.onclick=()=>acknowledgePickupAll(b.dataset.pickupAll));
document.querySelectorAll('[data-foh-tab]').forEach(b=>b.onclick=()=>{saveFields();const next=b.dataset.fohTab;if(next===fohTab&&!(next==='order'&&editingOrder))return;if(configuredCart.length&&!confirm('Discard the current unsent items?'))return;editingOrder='';configuredCart=[];note='';itemDialog=null;pendingKey=crypto.randomUUID();fohTab=next;pos();if(next==='history')loadPosHistory();if(next==='reservations')loadPosReservations();if(next==='platform'){if(platformHistoryOpen)loadPlatformHistory();else loadPlatformWorkspace()}});
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
document.querySelectorAll('[data-edit-ticket]').forEach(b=>b.onclick=()=>openTicketEditor(b.dataset.editTicket));
document.querySelectorAll('[data-void-ticket]').forEach(b=>b.onclick=()=>voidTicket(b.dataset.voidTicket));
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
// Keep successful voids hidden even if an overlapping refresh returns an older snapshot.
const posVoidedTicketIds=new Set();
async function voidTicket(id){
 const order=orders.find(o=>o.id===id);
 if(!order||order.paid_at||order.platform)return notify('Only unpaid regular tickets can be voided');
 if(!confirm('Void the entire ticket? The order will be marked Cancelled and kept in history. This cannot be undone.'))return;
 try{
  await api('/orders/'+encodeURIComponent(id)+'/void','POST',{});
  posVoidedTicketIds.add(id);
  // Update the current snapshot before any asynchronous refresh: the card must disappear now.
  const current=orders.find(o=>o.id===id);
  if(current)current.status='cancelled';
  if(editingOrder===id){editingOrder='';configuredCart=[];itemDialog=null;}
  notify('Ticket voided');
  pos();
  await refresh();
 }catch(e){notify('Void ticket failed: '+e.message)}
}
function openTicketEditor(id){
 const order=orders.find(o=>o.id===id);
 if(!order||order.paid_at||order.kitchen_completed_at||order.platform)return notify('This ticket cannot be edited');
 document.querySelector('#foh-ticket-editor')?.remove();
 const overlay=document.createElement('div');overlay.id='foh-ticket-editor';overlay.className='foh-ticket-editor-overlay';
 const rows=(order.items||[]).map(item=>'<div class="foh-ticket-edit-row"><span>'+esc(item.name)+(item.is_done?' · Done':'')+'</span><label>Qty <input type="number" min="1" max="99" step="1" data-edit-quantity="'+esc(item.id)+'" value="'+Number(item.quantity)+'" '+(item.is_done?'disabled':'')+'></label>'+(!item.is_done&&order.items.length>1?'<button type="button" class="danger" data-edit-remove="'+esc(item.id)+'">Remove</button>':'')+'</div>').join('');
 overlay.innerHTML='<section class="foh-ticket-editor-panel" role="dialog" aria-modal="true" aria-label="Edit Ticket"><h2>Edit Ticket</h2><p>Update quantities of unfinished dishes. Use Add items to add new dishes.</p>'+rows+'<p class="foh-ticket-editor-error" role="alert" hidden></p><div class="row"><button type="button" class="alt" data-edit-close>Cancel</button><button type="button" data-edit-save>Save changes</button></div></section>';
 document.body.append(overlay);
 const close=()=>overlay.remove();overlay.querySelector('[data-edit-close]').onclick=close;
 overlay.onclick=e=>{if(e.target===overlay)close()};
 overlay.querySelectorAll('[data-edit-remove]').forEach(button=>button.onclick=async()=>{
  if(!confirm('Remove this unfinished dish from the ticket?'))return;
  button.disabled=true;
  try{await api('/orders/'+encodeURIComponent(id)+'/items/'+encodeURIComponent(button.dataset.editRemove),'DELETE');close();notify('Dish removed');await refresh()}
  catch(e){const error=overlay.querySelector('.foh-ticket-editor-error');error.hidden=false;error.textContent='Remove failed: '+e.message;button.disabled=false;await refresh()}
 });
 overlay.querySelector('[data-edit-save]').onclick=async()=>{
  const changes=[];
  for(const input of overlay.querySelectorAll('[data-edit-quantity]')){
   const item=order.items.find(i=>i.id===input.dataset.editQuantity),quantity=Number(input.value);
   if(!Number.isInteger(quantity)||quantity<1||quantity>99){const error=overlay.querySelector('.foh-ticket-editor-error');error.hidden=false;error.textContent='Quantity must be 1–99';return;}
   if(item&&quantity!==Number(item.quantity))changes.push({id:item.id,quantity});
  }
  if(!changes.length){close();return;}
  const save=overlay.querySelector('[data-edit-save]');save.disabled=true;
  try{for(const item of changes)await api('/orders/'+encodeURIComponent(id)+'/items/'+encodeURIComponent(item.id)+'/quantity','PATCH',{quantity:item.quantity});close();notify('Ticket updated');await refresh()}
  catch(e){const error=overlay.querySelector('.foh-ticket-editor-error');error.hidden=false;error.textContent='Update failed: '+e.message;save.disabled=false;await refresh()}
 };
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
  '<div class="release-rating"><strong>Final Staff Self-Assessment</strong><p>Review your rating before releasing this table.</p><div class="release-rating-options">'+[[1,'😡','Very Poor'],[2,'☹️','Poor'],[3,'😉','Average'],[4,'😄','Good'],[5,'🥰','Excellent']].map(([v,emoji,label])=>'<button type="button" data-release-rating="'+v+'" aria-pressed="'+(v===3)+'" title="'+label+'">'+emoji+'<small>'+label+'</small></button>').join('')+'</div></div>'+
  '<div class="foh-release-tip"><label>Add tip (PLN)<input id="release-tip" type="text" inputmode="numeric" value="0.00"></label><label>Tip payment method<select id="release-tip-method"><option value="cash">Cash</option><option value="card">Card</option></select></label><p id="release-existing-tips" class="muted">Loading recorded tips…</p></div>'+'<p class="foh-release-note">The table will become available. The order and payment history will be preserved.</p>'+
  '<p class="foh-release-error" id="foh-release-error" role="alert" hidden></p>'+
  '<div class="foh-release-actions"><button type="button" class="foh-release-cancel" id="foh-release-cancel">Cancel</button><button type="button" class="foh-release-confirm" id="foh-release-confirm">✓ Release Table</button></div>'+
  '</section>';
 document.body.appendChild(modal);
 api('/orders/'+id+'/tips').then(data=>{const el=modal.querySelector('#release-existing-tips');if(el)el.textContent='Tips already recorded: '+money(data.total_cents||0)}).catch(()=>{const el=modal.querySelector('#release-existing-tips');if(el)el.textContent='Existing tips unavailable';});
 let releaseRating=3;const ratingButtons=modal.querySelectorAll('[data-release-rating]');ratingButtons.forEach(b=>b.onclick=()=>{releaseRating=Number(b.dataset.releaseRating);ratingButtons.forEach(x=>x.setAttribute('aria-pressed',String(Number(x.dataset.releaseRating)===releaseRating)));});
 const releaseTipKey=crypto.randomUUID();
 if(paid)api('/orders/'+id+'/service-rating').then(data=>{if(!modal.isConnected)return;releaseRating=Number(data.rating)||3;ratingButtons.forEach(x=>x.setAttribute('aria-pressed',String(Number(x.dataset.releaseRating)===releaseRating)));}).catch(()=>{});
  const getReleaseTipCents=bindShiftTipInput(modal.querySelector('#release-tip'));
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
   const releaseStore=currentDeviceStore?.id,releaseEpoch=storeEpoch;
   const tipCents=getReleaseTipCents();if(!Number.isInteger(tipCents)||tipCents<0||tipCents>10000000)throw Error('Enter a valid tip amount');if(tipCents>0&&!paid)throw Error('Checkout the order before adding a tip');
   await api('/orders/'+id+'/release-table','POST',{tip_amount_cents:tipCents,tip_method:modal.querySelector('#release-tip-method').value,tip_request_key:releaseTipKey,service_rating:paid?releaseRating:undefined});
   close();
   // Server has confirmed the release. Update the visible POS state immediately,
   // without blocking on the next full menu/orders/tables network refresh.
   if(releaseEpoch===storeEpoch&&releaseStore===currentDeviceStore?.id){
    o.table_occupied=false;
    const tableRow=tableState.find(t=>t.number===o.table_no);
    if(tableRow){tableRow.occupied=false;tableRow.order_id=null;tableRow.conflict=false;}
    if(editingOrder===id){editingOrder='';configuredCart=[];note='';}
    pos();
   }
   notify('Table '+o.table_no+' released · Now available');
   refresh().catch(e=>console.warn('Post-release sync failed',e));
  }catch(e){
   error.textContent='Unable to release table: '+e.message;error.hidden=false;
   confirmButton.disabled=false;cancel.disabled=false;confirmButton.textContent='✓ Release Table';
  }
 };
 cancel.focus();
}
// POS tip input: each typed digit shifts the amount by one cent (5 -> 0.05 -> 0.55).
function bindShiftTipInput(input,onChange){
 let cents=0;
 const render=()=>{input.value=(cents/100).toFixed(2);if(onChange)onChange(cents);};
 input.type='text';input.inputMode='numeric';input.autocomplete='off';input.setAttribute('aria-label','Tip amount in PLN');
 input.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey||e.key==='Tab'||e.key==='Escape')return;
  if(/^\d$/.test(e.key)){e.preventDefault();cents=Math.min(10000000,cents*10+Number(e.key));render();}
  else if(e.key==='Backspace'||e.key==='Delete'){e.preventDefault();cents=e.key==='Delete'?0:Math.floor(cents/10);render();}
  else if(['ArrowLeft','ArrowRight','Home','End','Enter'].includes(e.key))return;
  else e.preventDefault();
 });
 input.addEventListener('beforeinput',e=>{
  if(e.inputType==='insertText'&&/^\d+$/.test(e.data||'')){e.preventDefault();for(const d of e.data)cents=Math.min(10000000,cents*10+Number(d));render();}
  else if(e.inputType==='deleteContentBackward'){e.preventDefault();cents=Math.floor(cents/10);render();}
  else if(e.inputType==='deleteContentForward'){e.preventDefault();cents=0;render();}
 });
 input.addEventListener('input',()=>{
  // Fallback for mobile keyboards that do not dispatch cancellable beforeinput.
  const raw=input.value.replace(/\D/g,'');cents=Math.min(10000000,Number(raw)||0);render();
 });
 input.addEventListener('focus',()=>{input.setSelectionRange(input.value.length,input.value.length);});
 render();
 return ()=>cents;
}
function showCheckout(id){const o=activeTickets().find(x=>x.id===id);if(!o)return notify('Ticket already closed');checkoutId=id;document.querySelector('#foh-checkout-modal')?.remove();const modal=document.createElement('div');modal.id='foh-checkout-modal';modal.className='item-dialog-backdrop';modal.innerHTML='<section class="item-dialog foh-checkout" role="dialog" aria-modal="true"><div class="row"><h2>Checkout</h2><button class="alt" id="checkout-cancel">✕</button></div><p>'+(o.source==='dinein'?'Table '+esc(o.table_no):esc(sourceName[o.source]))+'</p><h1>'+money(ticketTotal(o))+'</h1><p class="muted">Confirm payment received. Table remains occupied until Release Table is clicked.</p><label>Payment method</label><select id="checkout-method"><option value="card">Card</option><option value="cash">Cash</option><option value="other">Other</option></select><label>Tip amount (PLN)<input id="checkout-tip" type="text" value="0.00" inputmode="numeric"></label><label>Tip payment method<select id="checkout-tip-method"><option value="card">Card</option><option value="cash">Cash</option></select></label><div class="foh-release-details"><div><span>Food &amp; drinks</span><strong>'+money(ticketTotal(o))+'</strong></div><div><span>Tip</span><strong id="checkout-tip-preview">0.00 zł</strong></div><div><span>Total collected</span><strong id="checkout-collected-preview">'+money(ticketTotal(o))+'</strong></div></div><div class="service-self-rating" style="margin:14px 0"><strong>Staff Self-Assessment</strong><p class="muted" style="margin:4px 0 8px">Rate your service for this order</p><div id="checkout-rating-options" style="display:flex;gap:6px;justify-content:space-between">'+[[1,'😡','Very Poor'],[2,'☹️','Poor'],[3,'😉','Average'],[4,'😄','Good'],[5,'🥰','Excellent']].map(([v,emoji,label])=>'<button type="button" class="checkout-rating-option" data-rating="'+v+'" aria-pressed="'+(v===3)+'" title="'+label+'" style="flex:1;min-width:0;padding:8px 2px;font-size:26px;border:2px solid '+(v===3?'#2676d5':'transparent')+';border-radius:10px;background:'+(v===3?'#e8f2ff':'transparent')+'">'+emoji+'<small style="display:block;font-size:10px">'+label+'</small></button>').join('')+'</div></div><button id="checkout-confirm">Confirm payment</button></section>';document.body.append(modal);const tipField=modal.querySelector('#checkout-tip');const getCheckoutTipCents=bindShiftTipInput(tipField,cents=>{modal.querySelector('#checkout-tip-preview').textContent=money(cents);modal.querySelector('#checkout-collected-preview').textContent=money(ticketTotal(o)+cents)});let checkoutRating=3;modal.querySelectorAll('[data-rating]').forEach(el=>el.onclick=()=>{checkoutRating=Number(el.dataset.rating);modal.querySelectorAll('[data-rating]').forEach(b=>{const active=Number(b.dataset.rating)===checkoutRating;b.setAttribute('aria-pressed',String(active));b.style.borderColor=active?'#2676d5':'transparent';b.style.background=active?'#e8f2ff':'transparent';});});document.querySelector('#checkout-cancel').onclick=()=>modal.remove();document.querySelector('#checkout-confirm').onclick=async()=>{const btn=document.querySelector('#checkout-confirm');if(btn.disabled||pendingCheckoutIds.has(id))return;btn.disabled=true;const method=document.querySelector('#checkout-method').value;const tipCents=getCheckoutTipCents();if(!Number.isInteger(tipCents)||tipCents<0||tipCents>10000000){btn.disabled=false;notify('Enter a valid tip amount');return}const tipMethod=document.querySelector('#checkout-tip-method').value;const epoch=storeEpoch,store=currentDeviceStore?.id;const sameStore=()=>epoch===storeEpoch&&store===currentDeviceStore?.id;const target=orders.find(x=>x.id===id);const originalPaidAt=target?.paid_at||null;const previousEditingOrder=editingOrder;pendingCheckoutIds.add(id);if(target)target.paid_at=new Date().toISOString();modal.remove();if(editingOrder===id){editingOrder='';configuredCart=[];fohTab='tickets'}pos();try{await api('/orders/'+id+'/checkout','POST',{method,tip_amount_cents:tipCents,tip_method:tipMethod,service_rating:checkoutRating});pendingCheckoutIds.delete(id);if(!sameStore())return;notify(tipCents>0?'Payment and tip recorded · Table not released':'Payment recorded · Table not released');await refresh()}catch(e){pendingCheckoutIds.delete(id);if(!sameStore())return;const order=orders.find(x=>x.id===id);if(order)order.paid_at=originalPaidAt;if(previousEditingOrder===id)editingOrder=previousEditingOrder;pos();notify('Checkout failed: '+e.message);refresh().catch(err=>console.warn('Checkout recovery sync failed',err))}}}

function saveFields(){const a=document.querySelector('#note'),b=document.querySelector('#table');if(a)note=a.value;if(b)table=b.value;}
async function submit(){
 if(busy)return;
 saveFields();
 const items=configuredCart.map(x=>({menu_id:x.menu_id,quantity:x.quantity,option_ids:x.option_ids,note:x.note,discount_percent:x.discount_percent||0}));
 if(!items.length)return;
 const originalStore=currentDeviceStore?.id,epoch=storeEpoch,key=pendingKey,additional=!!editingOrder;
 busy=true;
 try{
  if(additional){await api('/orders/'+editingOrder+'/items','POST',{items});notify('Additional items sent')}
  else{await api('/orders','POST',{source:type,table_no:type==='dinein'?table:'',note,items,client_key:key,followup_paid_order_id:followupPaidOrderId||undefined});notify(followupPaidOrderId?'Additional order sent · payment remains separate':'Order sent to kitchen')}
  if(epoch!==storeEpoch||originalStore!==currentDeviceStore?.id)return;
  configuredCart=[];note='';editingOrder='';followupPaidOrderId='';pendingKey=crypto.randomUUID();fohTab='tickets';await refresh();
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
 document.querySelectorAll('[data-kitchen-deadline]').forEach(el=>{
  const remaining=Math.ceil((new Date(el.dataset.kitchenDeadline).getTime()-Date.now())/60000);
  if(!Number.isFinite(remaining))return;
  el.textContent=remaining<=0?'OVERDUE '+Math.abs(remaining)+'m':remaining<=60?'DUE IN '+remaining+'m':'DUE IN '+Math.floor(remaining/60)+'h '+remaining%60+'m';
  el.style.cssText='display:block;font-weight:900;font-size:1.25rem;line-height:1.2;padding:8px;border-radius:8px;text-align:center;background:'+(remaining<=0?'#b91c1c':remaining<=10?'#c2410c':remaining<=20?'#a16207':'#0f766e')+';color:white;';
  el.closest('.kds-order')?.setAttribute('data-deadline-urgency',remaining<=0?'overdue':remaining<=10?'urgent':'normal');
 });
}
const kitchenViewKey='ck_kitchen_view_v1';
let kitchenView=(()=>{try{return localStorage.getItem(kitchenViewKey)==='dag'?'dag':'tickets'}catch{return 'tickets'}})();
let kitchenDagMode='dishes',kitchenProduction=null,kitchenProductionStore='',kitchenProductionLoading=false;
let kitchenProductionSnapshot=null,kitchenProductionFlash=new Map();
function resetKitchenProductionChanges(){
 kitchenProductionSnapshot=null;
 kitchenProductionFlash.clear();
}
function acknowledgeKitchenProductionComponent(componentId){
 kitchenProductionFlash.delete(String(componentId));
}
function acknowledgeKitchenProductionItem(itemId){
 const id=String(itemId);
 for(const [componentId,entry] of kitchenProductionFlash){
  if(entry.items.has(id)){
   entry.items.delete(id);
   if(!entry.items.size)kitchenProductionFlash.delete(componentId);
  }
 }
}
function captureKitchenProductionChanges(result,store){
 const next=new Map();
 for(const c of result?.production_components||[]){
  const id=String(c.component_id);
  const sources=new Map();
  for(const source of c.sources||[])sources.set(String(source.order_item_id),Number(source.quantity)||0);
  next.set(id,sources);
 }
 const prior=kitchenProductionSnapshot;
 if(prior&&prior.store!==store)resetKitchenProductionChanges();
 if(prior?.store===store){
  for(const [id,sources] of next){
   const before=prior.components.get(id)||new Map();
   const added=kitchenProductionFlash.get(id)?.items||new Map();
   for(const [itemId,qty] of sources)if(!before.has(itemId)&&qty>0)added.set(itemId,qty);
   for(const itemId of added.keys())if(!sources.has(itemId))added.delete(itemId);
   if(added.size)kitchenProductionFlash.set(id,{items:added});
   else kitchenProductionFlash.delete(id);
  }
  for(const id of kitchenProductionFlash.keys())if(!next.has(id))kitchenProductionFlash.delete(id);
 }
 kitchenProductionSnapshot={store,components:next};
}

async function loadKitchenProduction(){
 if(page!=='kitchen'||kitchenView!=='dag'||!token)return;
 const store=currentDeviceStore?.id||'',epoch=storeEpoch;
 if(kitchenProductionLoading)return;
 kitchenProductionLoading=true;
 try{
  const result=await api('/kitchen/dag');
  if(page!=='kitchen'||kitchenView!=='dag'||epoch!==storeEpoch||store!==(currentDeviceStore?.id||''))return;
  await loadKitchenAssemblyChecked();
  if(page!=='kitchen'||kitchenView!=='dag'||epoch!==storeEpoch||store!==(currentDeviceStore?.id||''))return;
  captureKitchenProductionChanges(result,store);
  kitchenProduction=result;kitchenProductionStore=store;
  kitchen();
 }catch(e){console.warn('Production DAG unavailable',e);if(epoch===storeEpoch&&store===(currentDeviceStore?.id||'')){kitchenProduction=null;kitchenProductionStore=store;}}
 finally{kitchenProductionLoading=false;}
}
function kitchenProductionView(){
 const current=kitchenProductionStore===(currentDeviceStore?.id||'')?kitchenProduction:null;
 if(!current)return '<div class="panel"><p class="muted">Loading production requirements. Finished Dishes remains available.</p><button type="button" id="dag-production-retry" class="alt">Retry</button></div>';
 const groups=current.production_components||[];
 return '<section class="panel kds-dag-view"><div class="kds-dag-heading"><div><h2>Production Requirements</h2><p class="muted small">Shared production components across active tickets. No scheduling estimates yet.</p></div><strong>'+groups.length+' components</strong></div>'+
 (groups.length?groups.map(g=>'<details class="panel" style="margin:10px 0;padding:14px"><summary><strong>'+esc(g.name)+'</strong> · '+Number(g.quantity.toFixed(2))+' '+esc(g.unit)+' · '+g.sources.length+' ticket items</summary>'+
 g.sources.map(src=>'<div style="padding:8px 0"><strong>#'+esc(String(src.order_id).slice(0,8))+'</strong> · '+Number(src.quantity.toFixed(2))+' '+esc(g.unit)+(src.deadline_at?' · Ready by '+esc(warsawClock(src.deadline_at)):'')+'</div>').join('')+'</details>').join(''):'<p class="muted">No mapped production requirements. Unmapped dishes are still visible in Finished Dishes.</p>')+
 '<p class="muted small">Production quantities are estimates from menu mappings; they do not mark tickets complete.</p></section>';
}
function kitchenViewTabs(){
 return '<nav class="kds-view-tabs" aria-label="Kitchen display mode"><button type="button" data-kds-view="tickets" class="'+(kitchenView==='tickets'?'selected':'')+'" aria-pressed="'+(kitchenView==='tickets')+'">Tickets</button><button type="button" data-kds-view="dag" class="'+(kitchenView==='dag'?'selected':'')+'" aria-pressed="'+(kitchenView==='dag')+'">DAG Timeline</button></nav>';
}
let dagRangeMinutes=15,dagSelectedNode='',dagCollapsedCategories=new Set();
function kitchenDagCluster(slots,windowStart,windowEnd){
 const span=windowEnd-windowStart,threshold=42,trackWidth=Math.max(340,Math.min(1200,typeof window!=='undefined'?window.innerWidth*.52:600));
 const visible=slots.filter(x=>Number.isFinite(x.deadline)&&x.deadline>=windowStart&&x.deadline<=windowEnd).sort((a,b)=>a.deadline-b.deadline);
 const clusters=[];
 for(const slot of visible){
  const last=clusters[clusters.length-1],pixel=(slot.deadline-windowStart)/span*trackWidth;
  if(last&&pixel-last.lastPixel<threshold){last.slots.push(slot);last.lastPixel=pixel;last.quantity+=slot.quantity;}
  else clusters.push({slots:[slot],lastPixel:pixel,quantity:slot.quantity,deadline:slot.deadline});
 }
 return clusters;
}
const dagAssemblyExpanded=new Set();
const dagAssemblyArmed=new Set();
let dagAssemblyChecksStore='';
let dagAssemblyChecksLoaded=false;
let dagAssemblyChecksSerial=0;
async function loadKitchenAssemblyChecked(){
 if(page!=='kitchen'||!token)return;
 const store=currentDeviceStore?.id||'',epoch=storeEpoch,serial=++dagAssemblyChecksSerial;
 try{
  const result=await api('/kitchen/assembly-checks');
  if(epoch!==storeEpoch||store!==(currentDeviceStore?.id||'')||serial!==dagAssemblyChecksSerial)return;
  dagAssemblyArmed.clear();
  for(const id of result.ids||[])dagAssemblyArmed.add(String(id));
  dagAssemblyChecksStore=store;dagAssemblyChecksLoaded=true;
  if(page==='kitchen'&&kitchenView==='dag')kitchen();
 }catch(e){console.warn('Shared assembly checks unavailable',e)}
}
function kitchenDagView(active){
 const now=Date.now(),data=kitchenProductionStore===(currentDeviceStore?.id||'')?kitchenProduction:null;
 const components=data?.production_components||[],dineInMinutes=Number(data?.dine_in_minutes)||20;
 const clock=t=>warsawClock(new Date(t).toISOString()).slice(0,5);
 const orderById=new Map(active.map(o=>[String(o.id),o]));
 const itemById=new Map(active.flatMap(o=>(o.items||[]).map(item=>[String(item.id),{item,order:o}])));
 const cutoff=dagRangeMinutes===0?Infinity:now+dagRangeMinutes*60000;
 const rows=components.map(component=>{
  const sources=(component.sources||[]).map(source=>{
   const matched=itemById.get(String(source.order_item_id));
   if(!matched||matched.item.is_done)return null;
   const {item,order}=matched;
   const explicit=order.platform_deadline_at?Date.parse(order.platform_deadline_at):NaN;
   const received=Date.parse(order.created_at);
   const deadline=Number.isFinite(explicit)?explicit:order.platform?null:Number.isFinite(received)?received+dineInMinutes*60000:null;
   return {item,order,quantity:Number(source.quantity)||0,deadline};
  }).filter(Boolean);
  const due=sources.filter(x=>x.deadline!==null&&x.deadline<=cutoff);
  const unscheduled=sources.filter(x=>x.deadline===null);
  const selected=dagRangeMinutes===0?sources:due;
  const total=sources.reduce((n,x)=>n+x.quantity,0);
  const qty=selected.reduce((n,x)=>n+x.quantity,0);
  const late=sources.filter(x=>x.deadline!==null&&x.deadline<now).reduce((n,x)=>n+x.quantity,0);
  const byDish=new Map();
  for(const x of selected){const key=String(x.item.menu_id||x.item.name);const entry=byDish.get(key)||{name:x.item.name,quantity:0};entry.quantity+=x.quantity;byDish.set(key,entry)}
  return {component,sources,due,unscheduled,selected,total,qty,late,byDish};
 }).filter(x=>x.total>0);
 // Items without any component mapping remain visible as dish-level production tasks.
 const mappedItemIds=new Set(rows.flatMap(r=>r.sources.map(x=>String(x.item.id))));
 const fallbackGroups=new Map();
 for(const order of active)for(const item of order.items||[]){
  if(item.is_done||mappedItemIds.has(String(item.id)))continue;
  const key=String(item.menu_id||item.name);
  const explicit=order.platform_deadline_at?Date.parse(order.platform_deadline_at):NaN;
  const received=Date.parse(order.created_at);
  const deadline=Number.isFinite(explicit)?explicit:order.platform?null:Number.isFinite(received)?received+dineInMinutes*60000:null;
  const group=fallbackGroups.get(key)||{component:{component_id:'dish:'+key,name:item.name,unit:'dish',emoji:'🍽️'},sources:[]};
  group.sources.push({item,order,quantity:Number(item.quantity)||1,deadline});
  fallbackGroups.set(key,group);
 }
 for(const group of fallbackGroups.values()){
  const sources=group.sources,selected=dagRangeMinutes===0?sources:sources.filter(x=>x.deadline!==null&&x.deadline<=cutoff);
  const byDish=new Map([[String(group.component.component_id),{name:group.component.name,quantity:selected.reduce((n,x)=>n+x.quantity,0)}]]);
  rows.push({...group,selected,byDish,unscheduled:sources.filter(x=>x.deadline===null),total:sources.reduce((n,x)=>n+x.quantity,0),qty:selected.reduce((n,x)=>n+x.quantity,0),late:sources.filter(x=>x.deadline!==null&&x.deadline<now).reduce((n,x)=>n+x.quantity,0),fallback:true});
 }
 const fmt=n=>Number(n.toFixed(2));
 let removedChecked=false;
 for(const id of dagAssemblyArmed)if(!itemById.has(id)||itemById.get(id).item.is_done){dagAssemblyArmed.delete(id);removedChecked=true}
 // The next server refresh will also prune stale checked rows.
 const visible=rows.filter(r=>r.qty>0||dagRangeMinutes===0);
 const totalDue=visible.reduce((n,r)=>n+r.qty,0);
 const componentEmoji=name=>{
  const n=String(name||'').toLowerCase();
  if(/egg|jaj|鸡蛋|ไข่/.test(n))return '🍳';
  if(/chicken|kurczak|炸鸡|鸡肉/.test(n))return '🍗';
  if(/beef|wołow|牛肉/.test(n))return '🥩';
  if(/rice|ryż|米饭|米饭/.test(n))return '🍚';
  if(/tteokbokki|떡볶이|年糕/.test(n))return '🍢';
  if(/kimchi.*soup|soup.*kimchi|zupa.*kimchi|泡菜汤/.test(n))return '🍲';
  if(/miso|doenjang|味噌/.test(n))return '🥣';
  if(/soup|zupa|汤/.test(n))return '🍜';
  if(/mandu|dumpling|pierog|饺/.test(n))return '🥟';
  if(/tofu|豆腐/.test(n))return '🧈';
  if(/vegetable|warzyw|蔬菜/.test(n))return '🥬';
  return '🍽️';
 };
 const summary=visible.map(r=>{
  const pending=r.selected.filter(x=>dagAssemblyArmed.has(String(x.item.id))).reduce((n,x)=>n+x.quantity,0);
  const fresh=kitchenProductionFlash.get(String(r.component.component_id));
  const added=fresh?[...fresh.items.values()].reduce((n,v)=>n+v,0):0;
  const id=encodeURIComponent(String(r.component.component_id)),open=dagSelectedNode===id;
  const breakdown=[...r.byDish.values()].sort((a,b)=>b.quantity-a.quantity);
  const sorted=r.selected.filter(x=>x.deadline!==null).sort((a,b)=>a.deadline-b.deadline);
  const buckets=new Map();
  for(const x of sorted){const key=x.deadline;const entry=buckets.get(key)||{quantity:0,items:[]};entry.quantity+=x.quantity;entry.items.push(x);buckets.set(key,entry)}
  const detail= '<div class="kds-prod-detail"><strong>Required for dishes</strong>'+
   (breakdown.length?breakdown.map(d=>'<div class="kds-prod-breakdown"><span>'+esc(d.name)+'</span><strong>×'+fmt(d.quantity)+'</strong></div>').join(''):'<p class="muted small">No scheduled requirements in this window.</p>')+
   '<strong>Ready by</strong>'+
   ([...buckets].map(([time,b])=>'<div class="kds-prod-deadline"><strong>'+clock(time)+(time<now?' · Overdue':'')+' · ×'+fmt(b.quantity)+'</strong>'+b.items.map(x=>'<div class="muted small">#'+esc(String(x.order.id).slice(0,8))+' · '+esc(x.item.name)+' ×'+fmt(x.quantity)+'</div>').join('')+'</div>').join('')||'<p class="muted small">No timed deadlines</p>')+
   (dagRangeMinutes===0&&r.unscheduled.length?'<div class="kds-prod-deadline"><strong>Deadline not set · ×'+fmt(r.unscheduled.reduce((n,x)=>n+x.quantity,0))+'</strong>'+r.unscheduled.map(x=>'<div class="muted small">#'+esc(String(x.order.id).slice(0,8))+' · '+esc(x.item.name)+' ×'+fmt(x.quantity)+'</div>').join('')+'</div>':'')+'</div>';
  return '<div class="kds-prod-card'+(open?' is-expanded':'')+'"><button type="button" class="kds-prod-card-head" data-dag-node="'+esc(id)+'" aria-expanded="'+open+'"><span class="kds-prod-main"><span class="kds-prod-name"><span class="kds-prod-emoji" aria-hidden="true">'+esc(String(r.component.emoji||'').trim()||componentEmoji(r.component.name))+'</span><strong>'+esc(r.component.name)+'</strong></span><span class="kds-prod-quantity"><span class="kds-prod-number">'+fmt(added?Math.max(0,r.qty-added):r.qty)+'</span>'+(added?'<span class="kds-prod-new-delta">+'+fmt(added)+'</span>':'')+(pending?'<span class="kds-prod-new-delta" style="color:#ef4444">−'+fmt(pending)+'</span>':'')+((added||pending)?'<span class="kds-prod-new-delta" style="color:inherit">= '+fmt(Math.max(0,r.qty-pending))+'</span>':'')+'<small>'+esc(r.component.unit||'unit')+'</small></span><span class="kds-prod-meta">All orders: '+fmt(r.total)+(r.late?' · '+fmt(r.late)+' overdue':'')+'</span></span><span class="kds-prod-chevron" aria-hidden="true">'+(open?'⌃':'⌄')+'</span></button>'+
  (open?detail:'')+'</div>';
 }).join('');
 const schedule=rows.flatMap(r=>r.sources.filter(x=>x.deadline!==null&&(dagRangeMinutes===0||x.deadline<=cutoff)).map(x=>({name:r.component.name,unit:r.component.unit,quantity:x.quantity,deadline:x.deadline,item:x.item,order:x.order})));
 const timeBuckets=new Map();
 for(const x of schedule){
  const time=Math.floor(x.deadline/(5*60000))*5*60000;
  const key=String(time)+'|'+x.name+'|'+x.unit;
  const entry=timeBuckets.get(key)||{time,name:x.name,unit:x.unit,quantity:0,items:[]};
  entry.quantity+=x.quantity;entry.items.push(x);timeBuckets.set(key,entry);
 }
 const scheduleGroups=new Map();
 for(const entry of timeBuckets.values()){
  const key=String(entry.time);
  if(!scheduleGroups.has(key))scheduleGroups.set(key,{time:entry.time,components:[],quantity:0});
  const group=scheduleGroups.get(key);
  group.components.push(entry);
  group.quantity+=entry.quantity;
 }
 const scheduleRows=[...scheduleGroups.values()].sort((a,b)=>a.time-b.time);
 const dishBuckets=new Map();
 for(const order of active)for(const item of order.items||[]){
  if(item.is_done)continue;
  const explicit=order.platform_deadline_at?Date.parse(order.platform_deadline_at):NaN;
  const received=Date.parse(order.created_at);
  const deadline=Number.isFinite(explicit)?explicit:order.platform?null:Number.isFinite(received)?received+dineInMinutes*60000:null;
  if(deadline===null&&dagRangeMinutes!==0)continue;
  if(deadline!==null&&deadline>cutoff)continue;
  const time=deadline===null?null:Math.floor(deadline/(5*60000))*5*60000;
  const bucketKey=time===null?'unscheduled':String(time);
  if(!dishBuckets.has(bucketKey))dishBuckets.set(bucketKey,{time,dishes:new Map()});
  const bucket=dishBuckets.get(bucketKey);
  const dishKey=String(item.menu_id||item.name);
  if(!bucket.dishes.has(dishKey))bucket.dishes.set(dishKey,{name:item.name,quantity:0,items:[]});
  const dish=bucket.dishes.get(dishKey);
  dish.quantity+=Number(item.quantity)||1;
  dish.items.push({item,order});
 }
 const dishGroups=[...dishBuckets.values()].sort((a,b)=>a.time===null?1:b.time===null?-1:a.time-b.time);
 const dishHtml=dishGroups.map(g=>'<section class="kds-prod-schedule-group kds-dish-assembly-group"><div class="kds-prod-schedule-header"><strong>'+(g.time===null?'No deadline':clock(g.time)+(g.time<now?' · Overdue':''))+'</strong><span>'+g.dishes.size+' dishes</span></div>'+
 [...g.dishes.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(d=>{
  const single=d.items.length===1;
  const armed=single&&dagAssemblyArmed.has(String(d.items[0].item.id));
  const expanded=dagAssemblyExpanded.has(String(g.time)+'|'+d.name);
  const key=encodeURIComponent(String(g.time)+'|'+d.name);
  return '<div class="kds-dish-assembly-entry"><button type="button" class="kds-dish-assembly-row" '+(single?'data-assembly-done="'+esc(d.items[0].item.id)+'"':'data-assembly-expand="'+esc(key)+'"')+'><span>'+esc(d.name)+'</span><span class="kds-dish-assembly-count">×'+fmt(d.quantity)+'</span><span class="kds-dish-assembly-action">'+(single?(armed?'<span data-assembly-cancel="'+esc(d.items[0].item.id)+'" role="button" tabindex="0" aria-label="Cancel pending completion" style="color:#22c55e">✓</span>':'○'):'⌄')+'</span></button>'+
  (!single&&expanded?'<div class="kds-dish-assembly-items">'+d.items.map(x=>'<button type="button" class="kds-dish-assembly-item" data-assembly-done="'+esc(x.item.id)+'"><span>#'+esc(String(x.order.id).slice(0,8))+' · '+esc(x.order.table_no||x.order.platform||x.order.source||'Order')+'</span><strong>×'+fmt(Number(x.item.quantity)||1)+' '+(dagAssemblyArmed.has(String(x.item.id))?'<span data-assembly-cancel="'+esc(x.item.id)+'" role="button" tabindex="0" aria-label="Cancel pending completion" style="color:#22c55e">✓</span>':'○')+'</strong></button>').join('')+'</div>':'')+'</div>';
 }).join('')+'</section>').join('');
 const unscheduledTotal=rows.reduce((n,r)=>n+r.unscheduled.reduce((n,x)=>n+x.quantity,0),0);
 return '<section class="panel kds-dag-view kds-production-board"><div class="kds-dag-heading"><div><h2>Kitchen Production Board</h2><p class="muted small">Unfinished production requirements · components and unmapped dishes</p></div><strong>'+fmt(totalDue)+' due</strong></div>'+
 '<div class="kds-dag-controls"><span>Prepare by</span>'+[5,15,30,0].map(n=>'<button type="button" class="kds-dag-range '+(dagRangeMinutes===n?'selected':'')+'" data-dag-range="'+n+'" aria-pressed="'+(dagRangeMinutes===n)+'">'+(n?'+'+n+'m':'All')+'</button>').join('')+'</div>'+
 '<p class="muted small">Includes overdue requirements. Time windows are measured from now; All includes orders without a deadline.</p>'+
 (visible.length?'<div class="kds-prod-grid">'+summary+'</div>':'<p class="muted">No production requirements in this time window.</p>')+
 '<h3 class="kds-prod-section-title">Dish Assembly · Ready by</h3><p class="muted small">Tap ✓ to complete a dish. Grouped dishes expand to show individual tickets.</p>'+
 (dishGroups.length?'<div class="kds-prod-schedule-groups">'+dishHtml+'</div>':'<p class="muted small">No unfinished dishes in this time window.</p>')+'</section>';
}
function bindKitchenViewTabs(){
 document.querySelectorAll('[data-kds-view]').forEach(button=>button.onclick=()=>{
  const next=button.dataset.kdsView;if(next===kitchenView)return;
  kitchenView=next;try{localStorage.setItem(kitchenViewKey,next)}catch{}
  kitchen();if(next==='dag')loadKitchenProduction();
 });
}
function kitchen(){
 const active=orders.filter(o=>o.status!=='cancelled'&&!o.kitchen_completed_at&&!kitchenCompleting.has(o.id)&&o.items.length).sort((a,b)=>a.created_at.localeCompare(b.created_at));
 const card=o=>{
  const done=o.items.filter(i=>i.is_done).length,ready=done===o.items.length;
  const items=kitchenSortItems(o.items);
  return '<article class="ticket kds-order" data-order-id="'+esc(o.id)+'">'+
   '<div class="kds-order-head" role="button" tabindex="0" aria-label="Mark all dishes done" data-kitchen-mark-all="'+esc(o.id)+'" data-age-band="'+kitchenAgeBand(kitchenAge(o.created_at))+'">'+
    '<div class="kds-head-row"><h3>'+esc(o.table_no||sourceName[o.source])+'</h3><strong class="kds-age" data-kitchen-age="'+esc(o.created_at)+'">'+kitchenDuration(kitchenAge(o.created_at))+'</strong></div>'+
    '<div class="kds-head-row"><span>Received '+warsawClock(o.created_at)+'</span><span>'+done+'/'+o.items.length+' Done</span></div>'+
    '<div class="kds-head-id">#'+esc(o.id.slice(0,8))+(o.paid_at?' · Paid':'')+'</div>'+
    (o.platform?'<div class="kds-head-row"><strong>'+esc(o.platform.replaceAll('_',' ').toUpperCase())+'</strong><span class="kds-platform-order-number">#'+esc(o.external_order_id||'')+'</span></div>':'')+
    (o.platform_deadline_at?'<div class="kds-deadline" style="margin-top:8px;padding:8px;border:2px solid #fbbf24;border-radius:10px"><div style="font-size:0.8rem;font-weight:800">READY BY · '+warsawClock(o.platform_deadline_at)+'</div><strong data-kitchen-deadline="'+esc(o.platform_deadline_at)+'" style="display:block;font-size:1.25rem;font-weight:900">Calculating…</strong></div>':'')+
   '</div>'+
   (o.platform?'<button type="button" class="alt" data-platform-edit="'+esc(o.id)+'">Edit Platform Order</button>':'')+
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
   (o.note?'<p class="kds-order-note">Note: '+esc(o.note)+'</p>':'')+'</article>';
 };
 shell('<div class="kds-command-row">'+kitchenViewTabs()+'<div class="panel toolbar kds-command-actions"><button type="button" id="kds-quick-order">+ Platform Order</button><button type="button" id="kds-courier-queue" class="alt">Courier Collection</button><button id="sound">'+(beepEnabled?'🔊 Sound enabled':'🔇 Enable new-order sound')+'</button><button class="alt" id="sync">Refresh</button><span class="muted small">Tap anywhere on a dish to toggle Done.</span></div></div>'+
 (kitchenView==='dag'?kitchenDagView(active):'<h2>Active Orders · <span class="kds-active-count">'+active.length+'</span></h2><div class="grid kds-active-grid">'+active.map(card).join('')+'</div>'+(active.length?'':'<div class="empty">No active kitchen orders</div>')) +
 '<section class="panel completed-section kds-history"><div class="row"><h3>Completed Orders</h3><button class="alt" id="kds-history-toggle">'+(historyOpen?'Hide history':'View history')+'</button></div>'+
 (historyOpen?'<div class="toolbar"><select id="kds-history-range"><option value="today" '+(historyRange==='today'?'selected':'')+'>Today</option><option value="yesterday" '+(historyRange==='yesterday'?'selected':'')+'>Yesterday</option><option value="all" '+(historyRange==='all'?'selected':'')+'>All</option></select><input id="kds-history-search" placeholder="Table / order ID" value="'+esc(historyQuery)+'"><button class="alt" id="kds-history-search-button">Search</button></div>'+
 '<p class="muted small">'+historyResult.total+' completed'+(historyResult.limited?' (recent history limit)':'')+'</p>'+
 '<div class="kds-history-list">'+historyResult.orders.map(o=>'<div class="kds-history-row"><div><strong>'+esc(o.table_no||sourceName[o.source])+'</strong><small>#'+esc(o.id.slice(0,8))+' · '+warsawClock(o.kitchen_completed_at)+' · '+o.items.length+' dishes</small><details><summary>View dishes</summary>'+o.items.map(i=>'<div>'+i.quantity+' × '+esc(i.name)+'</div>').join('')+'</details></div><button class="alt" data-kitchen-reopen="'+esc(o.id)+'">Reopen</button></div>').join('')+
 (historyResult.orders.length?'':'<p class="muted">No completed orders found</p>')+'</div>'+
 '<div class="toolbar"><button class="alt" id="kds-history-prev" '+(historyPage<=1?'disabled':'')+'>Previous</button><span>Page '+historyPage+'</span><button class="alt" id="kds-history-next" '+(!historyResult.has_more?'disabled':'')+'>Next</button></div>':'<p class="muted small">Completed orders are archived here. Open only when needed.</p>')+'</section>');
 if(kitchenClock)clearInterval(kitchenClock);kitchenClock=setInterval(updateKitchenClock,1000);updateKitchenClock();
 bindKitchenViewTabs();
 document.querySelectorAll('[data-dag-category]').forEach(btn=>btn.onclick=()=>{const category=decodeURIComponent(btn.dataset.dagCategory);if(dagCollapsedCategories.has(category))dagCollapsedCategories.delete(category);else dagCollapsedCategories.add(category);kitchen()});
 document.querySelectorAll('[data-dag-range]').forEach(btn=>btn.onclick=()=>{dagRangeMinutes=Number(btn.dataset.dagRange);dagSelectedNode='';kitchen()});
 document.querySelectorAll('[data-dag-node]').forEach(btn=>btn.onclick=()=>{acknowledgeKitchenProductionComponent(decodeURIComponent(btn.dataset.dagNode));dagSelectedNode=dagSelectedNode===btn.dataset.dagNode?'':btn.dataset.dagNode;kitchen()});
 document.querySelectorAll('[data-assembly-expand]').forEach(btn=>btn.onclick=()=>{const key=decodeURIComponent(btn.dataset.assemblyExpand);if(dagAssemblyExpanded.has(key))dagAssemblyExpanded.delete(key);else dagAssemblyExpanded.add(key);kitchen()});
 document.querySelectorAll('[data-assembly-cancel]').forEach(btn=>{const cancel=async event=>{event.stopPropagation();const id=btn.dataset.assemblyCancel;if(kitchenBusy.has(id))return;kitchenBusy.add(id);try{await api('/kitchen/assembly-checks/'+encodeURIComponent(id),'DELETE');dagAssemblyArmed.delete(id);kitchen();await loadKitchenAssemblyChecked()}catch(e){notify('Could not uncheck dish: '+e.message)}finally{kitchenBusy.delete(id)}};btn.onclick=cancel;btn.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();cancel(event)}}});
 document.querySelectorAll('[data-assembly-done]').forEach(btn=>btn.onclick=async()=>{
  const id=btn.dataset.assemblyDone;
  if(kitchenBusy.has(id))return;
  const order=orders.find(o=>(o.items||[]).some(i=>String(i.id)===id));
  const item=order?.items.find(i=>String(i.id)===id);
  if(!item||item.is_done)return;
  if(!dagAssemblyArmed.has(id)){kitchenBusy.add(id);try{await api('/kitchen/assembly-checks/'+encodeURIComponent(id),'PUT');dagAssemblyArmed.add(id);kitchen();await loadKitchenAssemblyChecked()}catch(e){notify('Could not check dish: '+e.message)}finally{kitchenBusy.delete(id)}return;}
  kitchenBusy.add(id);btn.disabled=true;
  kitchenPending.set(id,true);
  try{
   await api('/order-items/'+id+'/done','PATCH',{});
   const confirmed=await api('/orders');
   const saved=confirmed.flatMap(o=>o.items||[]).find(i=>String(i.id)===id);
   if(!saved||!saved.is_done)throw Error('Completion not confirmed');
   acknowledgeKitchenProductionItem(id);
   dagAssemblyArmed.delete(id);
   await api('/kitchen/assembly-checks/'+encodeURIComponent(id),'DELETE').catch(()=>{});
   kitchenPending.delete(id);
   await refresh();
  }catch(e){
   kitchenPending.delete(id);
   notify('Could not save dish: '+e.message);
   await refresh();
  }finally{kitchenBusy.delete(id)}
 });
 const retry=document.querySelector('#dag-production-retry');if(retry)retry.onclick=()=>loadKitchenProduction();
 document.querySelector('#kds-quick-order').onclick=openQuickOrderDialog;document.querySelector('#kds-courier-queue').onclick=openCourierCollection;
 document.querySelector('#sound').onclick=async()=>{audio=audio||new(window.AudioContext||window.webkitAudioContext)();await audio.resume();beepEnabled=true;sound();kitchen()};
 document.querySelector('#sync').onclick=()=>refresh();
 document.querySelectorAll('[data-kitchen-mark-all]').forEach(head=>{
 const mark=async()=>{
  const id=head.dataset.kitchenMarkAll,order=orders.find(o=>o.id===id);
  if(!order||kitchenCompleting.has(id)||!(order.items||[]).some(i=>!i.is_done))return;
  if(!confirm('Mark all dishes on this ticket as done?'))return;
  head.setAttribute('aria-busy','true');
  try{await api('/kitchen/orders/'+encodeURIComponent(id)+'/mark-all-done','POST',{});await refresh()}
  catch(e){notify('Mark all dishes failed: '+e.message);head.removeAttribute('aria-busy')}
 };
 head.onclick=mark;
 head.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();mark()}};
});
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
    if(next)acknowledgeKitchenProductionItem(id);
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
let adminModifiers={groups:[],options:[],links:[]},adminMenu=[],adminCategories=[],adminEditing=null,adminImage='',adminTab='overview',adminFilter='',adminUploadBusy=false;
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
let v3Stores=[],v3SelectedStore='',v3StoreMenu=[],v3Devices=[],v3StoreError='',v3Loaded=false,v3PairAllowedStores=null,v3RevokedOpen=false,v3StoreMenuOpen=false;
let adminOrders=[],adminOrdersSummary=[],adminOrdersStore='',adminOrdersStatus='',adminOrdersPeriod='current',adminOrdersLimit=50,adminOrdersFrom='',adminOrdersTo='',adminOrdersOffset=0,adminOrdersHasMore=false,adminOrdersLoaded=false,adminOrdersError='',adminOrdersRequest=0,adminOrdersLastSync=null,adminOrdersBusy=false;let adminOrdersType='all',adminOrdersPlatform='all',adminOrdersCollection='all';
async function loadAdminOrders(){if(adminOrdersBusy)return;adminOrdersBusy=true;const request=++adminOrdersRequest;const q=new URLSearchParams({offset:String(adminOrdersOffset),period:adminOrdersPeriod,limit:String(adminOrdersLimit)});if(adminOrdersPeriod==='custom'){if(!adminOrdersFrom||!adminOrdersTo){adminOrdersError='Select a start and end date';adminOrdersLoaded=true;adminOrdersBusy=false;return;}q.set('from',adminOrdersFrom);q.set('to',adminOrdersTo);}q.set('order_type',adminOrdersType);if(adminOrdersPlatform!=='all')q.set('platform',adminOrdersPlatform);if(adminOrdersCollection!=='all')q.set('collection',adminOrdersCollection);if(adminOrdersStore)q.set('store_id',adminOrdersStore);if(adminOrdersStatus)q.set('status',adminOrdersStatus);try{const data=await api('/admin/orders?'+q);if(request!==adminOrdersRequest)return;adminOrders=data.orders||[];adminOrdersSummary=data.summary||[];adminOrdersHasMore=Boolean(data.has_more);adminOrdersLoaded=true;adminOrdersLastSync=new Date();adminOrdersError='';}catch(e){if(request===adminOrdersRequest){adminOrdersError=e.message;adminOrdersLoaded=true;}}finally{adminOrdersBusy=false;}}

async function loadV3Stores(){
 try{const [stores,devices]=await Promise.all([api('/admin/stores'),api('/admin/devices')]);v3Stores=stores.stores||[];v3Devices=devices.devices||[];v3StoreError='';v3Loaded=true;if(!v3Stores.some(x=>x.id===v3SelectedStore))v3SelectedStore=v3Stores[0]?.id||'';if(v3SelectedStore)await loadV3StoreMenu();}
 catch(e){v3StoreError=e.message;v3Loaded=true;}
}
async function loadV3StoreMenu(){if(!v3SelectedStore)return;const data=await api('/admin/stores/'+encodeURIComponent(v3SelectedStore)+'/menu');v3StoreMenu=data.items||[];}

function v3StorePanel(){
 const selected=v3Stores.find(x=>x.id===v3SelectedStore);
 const activeStores=v3Stores.filter(x=>x.active);
 const activeDevices=v3Devices.filter(x=>x.active);
 const revokedDevices=v3Devices.filter(x=>!x.active);
 const storeCards=v3Stores.map(x=>'<button type="button" class="v3-store-tile '+(x.id===v3SelectedStore?'is-selected':'')+'" data-v3-select-store="'+esc(x.id)+'" aria-pressed="'+(x.id===v3SelectedStore)+'"><span class="v3-store-tile-top"><strong>'+esc(x.name)+'</strong><span class="v3-state '+(x.active?'is-active':'is-inactive')+'">'+(x.active?'Active':'Inactive')+'</span></span><small>'+esc(x.code||x.id)+'</small></button>').join('');
 const menuRows=v3StoreMenu.map(m=>{const effectivePrice=m.override_price_cents===null?m.base_price_cents:m.override_price_cents;const effectiveActive=Boolean(m.override_active===null?m.base_active:m.override_active)&&!m.sold_out;return '<div class="v3-menu-row"><div class="v3-menu-info"><strong>'+esc(m.name)+'</strong><small>'+esc(m.category)+' · Master price '+money(m.base_price_cents)+'</small><small>Effective: '+money(effectivePrice)+' · '+(effectiveActive?'Available':'Unavailable')+(m.sold_out?' (sold out)':'')+'</small></div><label>Store price override (PLN)<input type="number" min="0" max="100000" step=".01" data-v3-price="'+esc(m.id)+'" value="'+(m.override_price_cents===null?'':(m.override_price_cents/100).toFixed(2))+'" placeholder="Use master price"></label><label>Availability<select data-v3-active="'+esc(m.id)+'"><option value="inherit" '+(m.override_active===null?'selected':'')+'>Use master status</option><option value="true" '+(m.override_active===1?'selected':'')+'>Available</option><option value="false" '+(m.override_active===0?'selected':'')+'>Unavailable</option></select></label><label class="v3-sold-field"><input type="checkbox" data-v3-sold="'+esc(m.id)+'" '+(m.sold_out?'checked':'')+'> Sold out</label><button type="button" class="alt" data-v3-save="'+esc(m.id)+'">Save</button></div>'}).join('');
 const deviceRow=d=>'<div class="v3-device-card"><div class="v3-device-details"><strong>'+esc(d.label)+'</strong><span class="v3-device-meta">'+(d.role?esc(String(d.role).toUpperCase())+' · ':'')+(d.active?'Active':'Revoked')+'</span><small class="v3-device-id">ID: '+esc(d.id)+'</small></div>'+(d.active?'<div class="v3-device-actions"><button type="button" class="alt" data-v3-grants="'+esc(d.id)+'">Allowed stores</button><button type="button" class="alt" data-v3-attendance="'+esc(d.id)+'">'+(d.attendance_qr_enabled?'Disable Attendance QR':'Enable Attendance QR')+'</button><button type="button" class="alt v3-revoke-button" data-v3-revoke="'+esc(d.id)+'">Revoke</button></div>':'')+'</div>';
 return '<section class="admin-workspace v3-management '+(adminTab==='devices'?'bo-devices-view':'bo-restaurants-view')+'">'+
 '<div class="v3-management-head"><div><p class="v3-eyebrow">MULTI-STORE ADMINISTRATION</p><h2>'+(adminTab==='devices'?'Devices':'Restaurants')+'</h2><p>'+(adminTab==='devices'?'Approve tablets and manage device access.':'Manage restaurants and store-specific menus.')+'</p></div><button type="button" class="alt" id="v3-load-stores">Refresh data</button></div>'+
 (v3StoreError?'<p class="warning" role="alert">'+esc(v3StoreError)+'</p>':'')+
 '<section class="v3-management-section bo-restaurant-section"><div class="v3-section-heading"><div><h3>Restaurants</h3><p>Select a restaurant to manage its settings.</p></div><span class="v3-section-count">'+activeStores.length+' active / '+v3Stores.length+' total</span></div>'+
 '<p class="muted small">'+activeStores.length+' active restaurants · '+v3Stores.length+' total</p><div class="v3-store-tiles">'+(storeCards||'<p>No restaurants configured.</p>')+'</div>'+
 '<label class="v3-store-select-fallback">Selected restaurant <select id="v3-store-select">'+v3Stores.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===v3SelectedStore?'selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select></label>'+
 (selected?'<div class="v3-selected-store"><div><small>SELECTED RESTAURANT</small><strong>'+esc(selected.name)+'</strong><span class="v3-state '+(selected.active?'is-active':'is-inactive')+'">'+(selected.active?'Active':'Inactive')+'</span></div><button type="button" class="'+(selected.active?'alt v3-danger-action':'')+'" id="v3-toggle-store">'+(selected.active?'Deactivate store':'Activate store')+'</button></div>':'<button type="button" id="v3-toggle-store" disabled>Activate store</button>')+
 (!selected?.active?'<p class="v3-inline-note">Inactive restaurants cannot be selected for new device authorizations. Activate the restaurant first.</p>':'')+
 '</section>'+
 '<section class="v3-management-section bo-restaurant-section"><div class="v3-section-heading"><div><h3>Store Menu</h3><p>Effective prices and availability for this restaurant. Overrides do not change other restaurants.</p></div><span class="v3-section-count">'+v3StoreMenu.length+' items</span></div>'+
 '<details class="v3-menu-disclosure" '+(v3StoreMenuOpen?'open':'')+'><summary>Store Menu <span>View and edit restaurant-specific settings</span></summary><div class="v3-menu-list">'+(menuRows||'<p class="v3-empty">No menu items for this restaurant.</p>')+'</div></details></section>'+
 '<section class="v3-management-section bo-device-section"><div class="v3-section-heading"><div><h3>Approve a device</h3><p>Use the six-digit pairing code shown on the restaurant tablet.</p></div></div>'+
 '<form id="v3-pair-approve" class="v3-management-form"><div class="v3-form-grid"><label>Pairing code<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required placeholder="6-digit code"></label><label>Device name<input name="label" required maxlength="100" placeholder="e.g. Kitchen tablet 1"></label><p class="muted small">Access: Front of House + Kitchen Display</p></div>'+
 '<fieldset class="v3-store-grants"><legend>Allowed restaurants</legend>'+(activeStores.map(x=>'<label><input type="checkbox" name="store_ids" value="'+esc(x.id)+'" '+((v3PairAllowedStores===null?x.id===v3SelectedStore:v3PairAllowedStores.has(String(x.id)))?'checked':'')+'><span>'+esc(x.name)+'</span></label>').join('')||'<p class="v3-empty">Activate a restaurant to grant access.</p>')+'</fieldset>'+ 
 '<div class="v3-form-footer"><label>Secondary password<input name="secondary_pin" type="password" autocomplete="off" required></label><button type="submit">Approve device</button></div></form></section>'+
 '<section class="v3-management-section bo-device-section"><div class="v3-section-heading"><div><h3>Registered devices</h3><p>Manage existing devices and their restaurant access.</p></div><span class="v3-section-count">'+activeDevices.length+' active</span></div>'+
 '<p class="muted small">'+activeDevices.length+' registered devices</p><div class="v3-device-list">'+(activeDevices.map(deviceRow).join('')||'<p class="v3-empty">No active devices.</p>')+'</div>'+
 (revokedDevices.length?'<details class="v3-revoked-devices" '+(v3RevokedOpen?'open':'')+'><summary>Revoked devices ('+revokedDevices.length+')</summary><div class="v3-device-list">'+revokedDevices.map(deviceRow).join('')+'</div></details>':'')+
 '</section></section>';
}

function boDuration(start,end){const a=Date.parse(start||''),b=Date.parse(end||'');if(!Number.isFinite(a)||!Number.isFinite(b)||b<a)return '—';const m=Math.floor((b-a)/60000);return m>=60?Math.floor(m/60)+'h '+m%60+'m':m>=1?m+'m':Math.floor((b-a)/1000)+'s';}
function boStamp(v){return v?new Date(v).toLocaleString('en-GB',{timeZone:'Europe/Warsaw',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'—';}
const serviceEmoji=['','😡','☹️','😉','😄','🥰'];
function adminOrderCard(o){
 const items=o.items||[],done=items.filter(i=>Number(i.is_done)===1),picked=items.filter(i=>i.picked_up_at);
 const kitchen=o.status==='cancelled'?'Cancelled':o.kitchen_completed_at||o.status==='done'?'Completed':done.length?'Preparing':'Waiting';
 const kitchenColor=o.status==='cancelled'?'gray':o.kitchen_completed_at||o.status==='done'?'green':done.length?'yellow':'red';
 const pickup=o.platform_info?(o.platform_info.collected_at?'Collected by courier':'Awaiting courier'):items.length&&picked.length===items.length?'Collected':picked.length?'Partially collected':'Not collected';
 const payment=Number(o.unpaid_cents)>0?'Unpaid':Number(o.paid_cents)>0?'Paid':'Not paid';
 const table=o.source!=='dinein'?'N/A':Number(o.table_occupied)?'Occupied':'Released';
 const platformLabels={uber_eats:'Uber Eats',wolt:'Wolt',pyszne:'Pyszne.pl',bolt_food:'Bolt Food',glovo:'Glovo',other:'Other platform'};
 const platformInfo=o.platform_info;
 const source=platformInfo?(platformLabels[platformInfo.platform]||platformInfo.platform):o.source==='dinein'?'Table '+(o.table_no||'—'):(sourceName[o.source]||o.source||'Order');
 return '<article class="bo-order-card bo-monitor-card"><div class="bo-order-head"><div class="bo-monitor-identity"><strong>'+esc(o.store_name||o.store_code||'Restaurant')+'</strong><small>'+esc(source)+(platformInfo&&platformInfo.external_order_id?' · #'+esc(platformInfo.external_order_id):' · #'+esc(String(o.id||'').slice(0,8)))+'</small>'+(platformInfo?'<small>Platform Order · '+(platformInfo.collected_at?'Collected '+esc(warsawClock(platformInfo.collected_at)):'Awaiting courier')+'</small>':'<small>Regular Order</small>')+'</div><b>'+money(Number(o.total_cents||0))+'</b></div>'+
 (o.service_rating?'<div class="bo-service-rating bo-service-rating-top"><span>Staff Self-Assessment</span><strong>'+serviceEmoji[Number(o.service_rating)]+' '+Number(o.service_rating)+'/5</strong></div>':'')+
 '<div class="bo-monitor-financial"><div><small>Original</small><strong>'+money(o.original_total_cents||0)+'</strong></div><div><small>Discount</small><strong class="bo-monitor-discount">−'+money(o.discount_cents||0)+'</strong></div><div><small>Final total</small><strong>'+money(o.total_cents||0)+'</strong></div></div><div class="bo-monitor-payment"><span>Paid <b>'+money(o.paid_cents||0)+'</b></span><span>Outstanding <b>'+money(o.unpaid_cents||0)+'</b></span></div>'+(o.has_unpriced_items?'<p class="bo-monitor-note">Some items have no recorded price.</p>':'')+'<div class="bo-monitor-status"><span class="bo-flag bo-'+kitchenColor+'">Kitchen: '+kitchen+'</span><span class="bo-flag '+(Number(o.unpaid_cents)===0&&Number(o.paid_cents)>0?'bo-green':'bo-yellow')+'">'+payment+'</span><span class="bo-flag">Pickup: '+pickup+'</span></div>'+
 '<div class="bo-monitor-tips"><div class="bo-monitor-tips-title"><span>Tips <small>(excluded from sales)</small></span><strong>'+money(o.tips_total_cents||0)+'</strong></div><div class="bo-monitor-tips-methods"><span>Cash <b>'+money(o.cash_tips_cents||0)+'</b></span><span>Card <b>'+money(o.card_tips_cents||0)+'</b></span></div></div>'+
 '<div class="bo-monitor-timing"><div><small>Ordered</small><strong>'+boStamp(o.created_at)+'</strong></div><div><small>Kitchen completed</small><strong>'+boStamp(o.kitchen_completed_at)+'</strong></div><div><small>Order → Kitchen</small><strong>'+boDuration(o.created_at,o.kitchen_completed_at)+'</strong></div><div><small>Checkout</small><strong>'+boStamp(o.paid_at)+'</strong></div><div><small>Order → Checkout</small><strong>'+boDuration(o.created_at,o.paid_at)+'</strong></div></div>'+
 '<div class="bo-monitor-meta"><span>Table: <strong>'+table+'</strong></span><span>Items ready: <strong>'+done.length+'/'+items.length+'</strong></span><span>Collected: <strong>'+picked.length+'/'+items.length+'</strong></span></div>'+
 (o.note?'<p class="bo-monitor-note">Note: '+esc(o.note)+'</p>':'')+
 '<details class="bo-monitor-details"><summary>View items <span>'+items.length+' lines</span></summary><div class="bo-order-items">'+items.map(i=>'<div class="bo-order-item"><span>'+(Number(i.is_done)?'✓ ':'○ ')+Number(i.quantity)+' × '+esc(i.name)+(i.modifiers?.length?' <small>'+esc(i.modifiers.map(m=>m.name).join(', '))+'</small>':'')+(i.note?' <small>('+esc(i.note)+')</small>':'')+'</span><small class="bo-monitor-item-financial">'+(i.price_cents==null?'Price unavailable':money(Number(i.quantity)*Number(i.price_cents)))+(Number(i.discount_cents)>0?' · −'+money(Number(i.quantity)*Number(i.discount_cents))+' discount':'')+'</small><small>'+(i.picked_up_at?'Collected':i.is_done?'Ready':'Preparing / pending')+' · Done '+boStamp(i.done_at)+' · '+boDuration(i.created_at,i.done_at)+'</small></div>').join('')+'</div></details>'+
 '<div class="bo-order-foot"><small>'+posDetailTime(o.created_at)+'</small><small>Read-only monitoring</small></div></article>';
}

let adminWs=null,adminWsRetry=null,adminWsRefresh=null,adminWsLive=false;
function connectAdminWs(){
 if(page!=='admin'||!token||adminWs)return;
 const proto=location.protocol==='https:'?'wss:':'ws:';
 const socket=new WebSocket(proto+'//'+location.host+'/ws',['ckauth.'+token]);
 adminWs=socket;
 socket.onopen=()=>{if(adminWs!==socket)return;adminWsLive=true;if(adminTab==='orders')admin();};
 socket.onmessage=e=>{if(adminWs!==socket||e.data==='pong')return;let m;try{m=JSON.parse(e.data)}catch{return}
  if(m.type!=='store_event')return;
  clearTimeout(adminWsRefresh);
  adminWsRefresh=setTimeout(async()=>{if(adminWs!==socket)return;if(adminTab==='orders'){await loadAdminOrders();if(adminTab==='orders')admin();}else if(adminTab==='overview'){await loadOverview();if(adminTab==='overview')admin();}},250);
 };
 socket.onclose=()=>{if(adminWs!==socket)return;adminWs=null;adminWsLive=false;clearTimeout(adminWsRetry);if(page==='admin'&&token)adminWsRetry=setTimeout(connectAdminWs,4000);};
 socket.onerror=()=>{try{socket.close()}catch{}};
}
let overviewData=null,overviewError='',overviewBusy=false;
const warsawToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let boWorkloadDate=warsawToday();
const shiftWorkloadDay=(date,days)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
async function loadOverview(){if(overviewBusy)return;overviewBusy=true;try{overviewData=await api('/admin/overview?workload_date='+encodeURIComponent(boWorkloadDate));overviewError='';}catch(e){overviewError=e.message;}finally{overviewBusy=false;}}
let boWorkloadMetrics=['orders','dishes','avg'],boWorkloadStores=null;
const boWorkloadDefs={orders:{label:'Orders',unit:'orders',dash:''},dishes:{label:'Dishes',unit:'dishes',dash:'9 5'},avg:{label:'Kitchen time',unit:'min',dash:'2 6'}};
function boWorkloadValue(r,key){if(!r)return key==='avg'?null:0;if(key==='avg')return r.completed?Number(r.total_kitchen_minutes)/Number(r.completed):null;return Number(r[key])||0;}
function boWorkloadPanel(data){
 const rows=data?.workload||[],stores=data?.workload_stores||data?.stores||[],colors=['#3183ce','#d18a30','#43a58a','#8b6ac9','#d35e76'];
 if(boWorkloadStores===null)boWorkloadStores=stores.map(s=>s.store_id);
 const active=stores.filter(s=>boWorkloadStores.includes(s.store_id)),metrics=boWorkloadMetrics;
 const byStore=new Map(stores.map(s=>[s.store_id,new Map(rows.filter(r=>r.store_id===s.store_id).map(r=>[Number(r.slot),r]))]));
 const maxCount=Math.max(1,...active.flatMap(st=>rows.filter(r=>r.store_id===st.store_id).flatMap(r=>metrics.filter(k=>k!=='avg').map(k=>boWorkloadValue(r,k)||0))));
 const maxMinutes=Math.max(5,Math.ceil(Math.max(1,...active.flatMap(st=>rows.filter(r=>r.store_id===st.store_id).map(r=>boWorkloadValue(r,'avg')||0)))/5)*5);
 const x=i=>60+(i-40)*760/56,y=(v,max)=>205-v/max*155;
 const lines=active.map(st=>{
  const si=stores.findIndex(s=>s.store_id===st.store_id),data=byStore.get(st.store_id);
  return metrics.map(k=>{
   const parts=[];let part=[];
   for(let i=40;i<96;i++){const v=boWorkloadValue(data.get(i),k);if(v===null){if(part.length)parts.push(part);part=[];}else part.push([x(i),y(v,k==='avg'?maxMinutes:maxCount)]);}
   if(part.length)parts.push(part);
   return parts.map(p=>'<polyline points="'+p.map(pt=>pt.join(',')).join(' ')+'" fill="none" stroke="'+colors[si%colors.length]+'" stroke-width="2.8" stroke-dasharray="'+(boWorkloadDefs[k].dash||'none')+'" stroke-linejoin="round" stroke-linecap="round"/>').join('');
  }).join('');
 }).join('');
 const ticks=[0,.25,.5,.75,1].map(f=>'<line x1="60" x2="820" y1="'+y(maxCount*f,maxCount)+'" y2="'+y(maxCount*f,maxCount)+'" stroke="#e5ebf2" stroke-dasharray="3 5"/><text x="48" y="'+(y(maxCount*f,maxCount)+4)+'" text-anchor="end" font-size="12" fill="#64748b">'+Math.round(maxCount*f)+'</text>'+(metrics.includes('avg')?'<text x="832" y="'+(y(maxCount*f,maxCount)+4)+'" font-size="12" fill="#64748b">'+Math.round(maxMinutes*f)+'</text>':'')).join('');
 const hours=[10,12,14,16,18,20,22,24].map(h=>'<text x="'+(h===24?820:x(h*4))+'" y="230" text-anchor="'+(h===10?'start':h===24?'end':'middle')+'" font-size="12" fill="#64748b">'+String(h%24).padStart(2,'0')+':00</text>').join('');
 const choices=Object.entries(boWorkloadDefs).map(([k,d])=>'<label class="bo-workload-choice"><input type="checkbox" data-bo-metric="'+k+'" '+(metrics.includes(k)?'checked':'')+'>'+d.label+'</label>').join('');
 const storeChoices=stores.map((st,i)=>'<label class="bo-workload-choice"><input type="checkbox" data-bo-store="'+esc(st.store_id)+'" '+(boWorkloadStores.includes(st.store_id)?'checked':'')+'><i style="background:'+colors[i%colors.length]+'"></i>'+esc(st.name)+'</label>').join('');
 const samples=Object.entries(boWorkloadDefs).map(([k,d])=>'<span class="bo-workload-sample'+(metrics.includes(k)?'':' muted')+'"><svg viewBox="0 0 44 12" width="44" height="12" aria-hidden="true"><line x1="2" x2="42" y1="6" y2="6" stroke="#3183ce" stroke-width="3" stroke-dasharray="'+(d.dash||'none')+'" stroke-linecap="round"/></svg>'+d.label+'</span>').join('');
 return '<section class="bo-workload"><h3>Kitchen workload</h3><div class="bo-workload-datebar"><label for="bo-workload-date">Date</label><button type="button" data-bo-date-step="-1" aria-label="Previous day">‹</button><input id="bo-workload-date" type="date" value="'+boWorkloadDate+'" max="'+warsawToday()+'"><button type="button" data-bo-date-step="1" aria-label="Next day" '+(boWorkloadDate>=warsawToday()?'disabled':'')+'>›</button><button type="button" data-bo-date-today>Today</button><span>Europe/Warsaw · 10:00–00:00 · 15-minute intervals</span></div><div class="bo-workload-chart"><div class="bo-workload-controls"><div><strong>Metrics</strong><div class="bo-workload-options">'+choices+'</div></div><div><strong>Restaurants</strong><div class="bo-workload-options">'+storeChoices+'</div></div></div><div class="bo-workload-chart-heading"><strong>Restaurant workload comparison</strong><span>Counts (left) · Minutes (right)</span></div><div id="bo-workload-mobile-detail" class="bo-workload-mobile-detail" hidden></div><div class="bo-workload-plot"><svg id="bo-workload-svg" viewBox="0 0 870 252" role="img" aria-label="Workload by restaurant and metric" preserveAspectRatio="xMidYMid meet">'+ticks+lines+'<line id="bo-workload-cursor" x1="60" x2="60" y1="50" y2="205" stroke="#64748b" stroke-dasharray="3 3" visibility="hidden"/><rect x="60" y="50" width="760" height="155" fill="transparent"/>'+hours+'<text x="60" y="18" font-size="12" fill="#64748b">Orders / Dishes</text>'+(metrics.includes('avg')?'<text x="820" y="18" text-anchor="end" font-size="12" fill="#64748b">Kitchen min</text>':'')+'</svg></div><div id="bo-workload-tooltip" class="bo-workload-tooltip" hidden></div><div class="bo-workload-samples">'+samples+'</div><div class="bo-workload-legend">'+active.map(st=>{const i=stores.findIndex(s=>s.store_id===st.store_id);return '<span><i style="background:'+colors[i%colors.length]+'"></i>'+esc(st.name)+'</span>';}).join('')+'</div></div><p class="muted small">Kitchen time: order creation to kitchen completion. Cancelled orders excluded.</p></section>';
}
function bindBoWorkload(){
 const setDay=async day=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>warsawToday()||day===boWorkloadDate)return;boWorkloadDate=day;await loadOverview();admin();};
 const dateInput=document.querySelector('#bo-workload-date');if(dateInput)dateInput.onchange=()=>setDay(dateInput.value);
 document.querySelectorAll('[data-bo-date-step]').forEach(el=>el.onclick=()=>setDay(shiftWorkloadDay(boWorkloadDate,Number(el.dataset.boDateStep))));
 const todayButton=document.querySelector('[data-bo-date-today]');if(todayButton)todayButton.onclick=()=>setDay(warsawToday());
 document.querySelectorAll('[data-bo-metric]').forEach(el=>el.onchange=()=>{const k=el.dataset.boMetric;boWorkloadMetrics=el.checked?[...new Set([...boWorkloadMetrics,k])]:boWorkloadMetrics.filter(v=>v!==k);admin();});
 document.querySelectorAll('[data-bo-store]').forEach(el=>el.onchange=()=>{const k=el.dataset.boStore;boWorkloadStores=el.checked?[...new Set([...boWorkloadStores,k])]:boWorkloadStores.filter(v=>v!==k);admin();});
 const svg=document.querySelector('#bo-workload-svg'),tip=document.querySelector('#bo-workload-tooltip'),mobile=document.querySelector('#bo-workload-mobile-detail');if(!svg||!tip||!overviewData)return;
 const rows=overviewData.workload||[],stores=overviewData.workload_stores||overviewData.stores||[],map=new Map(rows.map(r=>[r.store_id+':'+r.slot,r])),cursor=svg.querySelector('#bo-workload-cursor');
 const isMobile=()=>window.matchMedia('(max-width:700px)').matches;
 const xFromSlot=slot=>60+(slot-40)*760/56;
 const show=e=>{
  const ctm=svg.getScreenCTM();if(!ctm)return;const point=svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;const px=point.matrixTransform(ctm.inverse()).x;
  if(px<60||px>820)return;
  const slot=Math.max(40,Math.min(95,Math.floor((px-60)/(760/56)+40))),start=String(Math.floor(slot/4)).padStart(2,'0')+':'+String(slot%4*15).padStart(2,'0');
  const end=String((Math.floor(slot/4)+(slot%4===3?1:0))%24).padStart(2,'0')+':'+String((slot%4+1)%4*15).padStart(2,'0');
  const selected=stores.filter(st=>(boWorkloadStores||[]).includes(st.store_id));
  const details=selected.map(st=>({st,r:map.get(st.store_id+':'+slot)}));
  {
   tip.hidden=true;
   if(mobile){
    const header='<div class="bo-workload-mobile-head"><strong>'+start+' – '+end+'</strong><button type="button" data-workload-close aria-label="Close details">×</button></div>';
    const head='<div class="bo-workload-mobile-grid bo-workload-mobile-label"><span>Restaurant</span><span>Orders</span><span>Dishes</span><span>Min</span></div>';
    const body=details.map(({st,r})=>{const i=stores.findIndex(x=>x.store_id===st.store_id),v=boWorkloadValue(r,'avg');return '<div class="bo-workload-mobile-grid"><span><i style="background:'+['#3183ce','#d18a30','#43a58a','#8b6ac9','#d35e76'][i%5]+'"></i>'+esc(st.name)+'</span><b>'+(boWorkloadValue(r,'orders')||0)+'</b><b>'+(boWorkloadValue(r,'dishes')||0)+'</b><b>'+(v===null?'—':v.toFixed(1))+'</b></div>';}).join('');
    mobile.innerHTML=header+head+body;mobile.hidden=false;
    mobile.querySelector('[data-workload-close]').onclick=()=>{mobile.hidden=true;cursor.setAttribute('visibility','hidden');};
   }
  }

  cursor.setAttribute('x1',String(xFromSlot(slot)));cursor.setAttribute('x2',String(xFromSlot(slot)));cursor.setAttribute('visibility','visible');
 };
 const plot=svg.closest('.bo-workload-plot');
 let touchStart=null,suppressClick=false;
 if(plot){
  plot.addEventListener('touchstart',e=>{if(e.touches.length===1)touchStart={x:e.touches[0].clientX,y:e.touches[0].clientY,moved:false};},{passive:true});
  plot.addEventListener('touchmove',e=>{if(!touchStart||e.touches.length!==1)return;const dx=e.touches[0].clientX-touchStart.x,dy=e.touches[0].clientY-touchStart.y;if(Math.abs(dx)>8||Math.abs(dy)>8){touchStart.moved=true;suppressClick=true;}},{passive:true});
  plot.addEventListener('touchend',()=>{if(touchStart?.moved)suppressClick=true;touchStart=null;},{passive:true});
 }
 svg.onpointermove=e=>{if(!isMobile()&&e.pointerType!=='touch')show(e);};
 svg.onclick=e=>{if(suppressClick){suppressClick=false;return;}show(e);};
 svg.onpointerleave=()=>{};

}
function overviewPanel(){
 const t=overviewData?.total||{paid_cents:0,unpaid_cents:0,total_cents:0,orders:0,unpriced_orders:0};
 const storeCard=x=>{
  const orders=Number(x.orders)||0,average=orders?Math.round(Number(x.total_cents||0)/orders):0;
  const field=(label,value)=>'<div class="bo-store-field"><small>'+label+'</small><strong>'+money(value)+'</strong></div>';
  return '<article class="bo-store-card"><div class="bo-store-card-header"><div><small>RESTAURANT</small><h4>'+esc(x.name)+'</h4></div><div class="bo-store-orders"><strong>'+orders+'</strong><small>orders</small></div></div>'+
   '<div class="bo-store-main"><div><small>Total sales</small><strong>'+money(x.total_cents)+'</strong></div><div><small>Average order</small><strong>'+money(average)+'</strong></div></div>'+
   '<div class="bo-store-section"><h5>Payment status</h5><div class="bo-store-fields">'+field('Paid',x.paid_cents)+field('Unpaid',x.unpaid_cents)+'</div></div>'+
   '<div class="bo-store-section"><h5>Paid by method</h5><div class="bo-store-fields three">'+field('Cash',x.cash_cents)+field('Card',x.card_cents)+field('Others',x.others_cents)+'</div></div>'+
   '<div class="bo-store-section"><h5>Tips <small>(excluded from sales)</small></h5><div class="bo-store-fields three">'+field('Cash',x.cash_tips_cents)+field('Card',x.card_tips_cents)+field('Total',x.tip_cents)+'</div></div>'+
   '<div class="bo-store-footer"><span>Item discounts</span><strong>'+money(x.discount_cents)+'</strong></div>'+
   (Number(x.unpriced_orders)?'<p class="bo-store-warning">'+Number(x.unpriced_orders)+' orders contain unpriced items</p>':'')+'</article>';
 };
 const metric=(label,value)=>'<div class="admin-metric"><strong>'+money(value)+'</strong><span>'+label+'</span></div>';
 return '<section class="admin-workspace"><div class="admin-section-head"><div><h2>Today\'s performance</h2><p>Today · '+esc(overviewData?.date||'Europe/Warsaw')+' · PLN gross (incl. VAT)</p></div><button type="button" class="alt" id="bo-overview-refresh">Refresh</button></div>'+
 (overviewError?'<p class="warning" role="alert">'+esc(overviewError)+'</p>':'')+
 (!overviewData?'<p>Loading sales overview…</p>':'<div class="bo-mobile-summary"><div class="bo-mobile-sales"><div class="bo-mobile-sales-top"><span>Today\'s Sales</span><span class="bo-mobile-sales-date">'+esc(overviewData?.date||'')+'</span></div><strong class="bo-mobile-sales-total">'+money(t.total_cents)+'</strong><div class="bo-mobile-sales-split"><div><small>Paid</small><strong>'+money(t.paid_cents)+'</strong></div><div><small>Unpaid</small><strong>'+money(t.unpaid_cents)+'</strong></div></div><div class="bo-mobile-payment-split"><div><small>Cash</small><strong>'+money(t.cash_cents||0)+'</strong></div><div><small>Card</small><strong>'+money(t.card_cents||0)+'</strong></div><div><small>Others</small><strong>'+money(t.others_cents||0)+'</strong></div></div></div><div class="bo-mobile-tips"><div class="bo-mobile-tips-top"><span>Tips <small>(excluded from sales)</small></span><strong>'+money(t.tip_cents||0)+'</strong></div><div class="bo-mobile-tips-split"><div><small>Cash</small><strong>'+money(t.cash_tips_cents||0)+'</strong></div><div><small>Card</small><strong>'+money(t.card_tips_cents||0)+'</strong></div></div></div><div class="bo-mobile-order-count"><span>Today\'s orders</span><strong>'+Number(t.orders)+'</strong></div><p class="bo-mobile-discounts">Item discounts: '+money(t.discount_cents||0)+' · Excluded from net sales totals</p></div><div class="bo-desktop-overview"><div class="admin-overview">'+metric('Total Sales',t.total_cents)+metric('Paid',t.paid_cents)+metric('Unpaid',t.unpaid_cents)+metric('Cash',t.cash_cents||0)+metric('Card',t.card_cents||0)+metric('Others',t.others_cents||0)+'</div><p class="muted small">Item discounts granted today: '+money(t.discount_cents||0)+' (excluded from net sales totals).</p><h3>Tips (excluded from sales)</h3><div class="admin-overview">'+metric('Cash Tips',t.cash_tips_cents||0)+metric('Card Tips',t.card_tips_cents||0)+metric('Total Tips',t.tip_cents||0)+'</div>'+
 '<p class="muted small">'+t.orders+' orders today · Excludes cancelled orders and TEST restaurant'+(t.unpriced_orders?' · '+t.unpriced_orders+' orders contain unpriced items':'')+'</p>'+
 '</div><h3>Restaurant performance</h3><div class="bo-store-cards">'+overviewData.stores.map(storeCard).join('')+'</div><div class="bo-sales-table bo-store-legacy-table"><table><thead><tr><th>Restaurant</th><th>Orders</th><th>Total Sales</th><th>Paid</th><th>Unpaid</th><th>Cash Tips</th><th>Card Tips</th><th>Total Tips</th><th>Discounts</th></tr></thead><tbody>'+
 overviewData.stores.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+Number(x.orders)+'</td><td>'+money(x.total_cents)+'</td><td>'+money(x.paid_cents)+'</td><td>'+money(x.unpaid_cents)+'</td><td>'+money(x.cash_tips_cents||0)+'</td><td>'+money(x.card_tips_cents||0)+'</td><td>'+money(x.tip_cents||0)+'</td><td>'+money(x.discount_cents||0)+'</td></tr>').join('')+'</tbody></table></div>')+
 boWorkloadPanel(overviewData)+
 '<p class="muted small">Sales reflect orders created today in Warsaw time. Paid amounts come from recorded payments; Unpaid is the outstanding order value. Payments for earlier orders are not included.</p></section>';
}
let reservations=[],reservationError='',reservationBusy=false,reservationStore='',reservationDay='',reservationEditing='';
async function loadReservations(){
 if(reservationBusy)return;reservationBusy=true;
 try{const q=new URLSearchParams();if(reservationStore)q.set('store_id',reservationStore);if(reservationDay){q.set('from',reservationDay);q.set('to',reservationDay)}const data=await api('/admin/reservations?'+q);reservations=data.reservations||[];reservationError=''}
 catch(e){reservationError=e.message}finally{reservationBusy=false}
}
function reservationPanel(){
 const options=v3Stores.filter(s=>s.active).map(s=>'<option value="'+esc(s.id)+'" '+(reservationStore===s.id?'selected':'')+'>'+esc(s.name)+'</option>').join('');
 return '<section class="admin-workspace"><div class="admin-section-head"><div><h2>Reservations</h2><p>Bookings are separate from sales orders and do not occupy tables.</p></div><button type="button" class="alt" id="reservation-refresh">Refresh</button></div>'+
 '<div class="toolbar"><label>Restaurant<select id="reservation-store"><option value="">All restaurants</option>'+options+'</select></label><label>Date<input type="date" id="reservation-day" value="'+esc(reservationDay)+'"></label></div>'+
 (reservationError?'<p class="warning">'+esc(reservationError)+'</p>':'')+
 '<form id="reservation-form" class="panel"><h3>'+(reservationEditing?'Edit reservation':'New reservation')+'</h3><div class="menu-form-grid"><label>Restaurant<select id="reservation-new-store" required>'+v3Stores.filter(s=>s.active).map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join('')+'</select></label><label>Date and time<input id="reservation-start" type="datetime-local" required></label><label>Guests<input id="reservation-party" type="number" min="1" max="50" value="2" required></label><label>Guest name<input id="reservation-guest" maxlength="120"></label><label>Phone<input id="reservation-phone" maxlength="80"></label><label>Notes<input id="reservation-note" maxlength="500"></label></div><button type="submit">Save reservation</button> <button type="button" class="alt" id="reservation-clear">Clear</button></form>'+
 '<div class="bo-sales-table"><table><thead><tr><th>Date &amp; time</th><th>Restaurant</th><th>Guest</th><th>Guests</th><th>Phone</th><th>Notes</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+
 reservations.map(r=>'<tr><td>'+esc(r.starts_at.replace('T',' '))+'</td><td>'+esc(r.store_name||'')+'</td><td>'+esc(r.guest_name)+'</td><td>'+Number(r.party_size)+'</td><td>'+esc(r.phone)+'</td><td>'+esc(r.note)+'</td><td>'+esc(r.status)+'</td><td><button type="button" class="alt" data-reservation-edit="'+esc(r.id)+'">Edit</button> <button type="button" class="alt" data-reservation-status="'+esc(r.id)+'" data-status-value="arrived">Arrived</button> <button type="button" class="alt" data-reservation-status="'+esc(r.id)+'" data-status-value="no_show">No-show</button> <button type="button" class="alt" data-reservation-status="'+esc(r.id)+'" data-status-value="cancelled">Cancel</button></td></tr>').join('')+
 '</tbody></table></div></section>';
}
function bindReservations(){
 const form=document.querySelector('#reservation-form');if(!form)return;
 const existing=reservations.find(r=>r.id===reservationEditing);
 if(existing){form.querySelector('#reservation-new-store').value=existing.store_id;form.querySelector('#reservation-start').value=existing.starts_at;form.querySelector('#reservation-party').value=existing.party_size;form.querySelector('#reservation-guest').value=existing.guest_name;form.querySelector('#reservation-phone').value=existing.phone;form.querySelector('#reservation-note').value=existing.note}
 else if(reservationStore)form.querySelector('#reservation-new-store').value=reservationStore;
 document.querySelector('#reservation-refresh').onclick=()=>loadReservations().then(admin);
 document.querySelector('#reservation-store').onchange=e=>{reservationStore=e.target.value;loadReservations().then(admin)};
 document.querySelector('#reservation-day').onchange=e=>{reservationDay=e.target.value;loadReservations().then(admin)};
 document.querySelector('#reservation-clear').onclick=()=>{reservationEditing='';admin()};
 form.onsubmit=async e=>{e.preventDefault();const payload={store_id:form.querySelector('#reservation-new-store').value,starts_at:form.querySelector('#reservation-start').value,party_size:Number(form.querySelector('#reservation-party').value),guest_name:form.querySelector('#reservation-guest').value,phone:form.querySelector('#reservation-phone').value,note:form.querySelector('#reservation-note').value};const btn=form.querySelector('button[type="submit"]');btn.disabled=true;try{await api('/admin/reservations'+(reservationEditing?'/'+reservationEditing:''),reservationEditing?'PATCH':'POST',payload);reservationEditing='';await loadReservations();admin();notify('Reservation saved')}catch(err){btn.disabled=false;notify(err.message)}};
 document.querySelectorAll('[data-reservation-edit]').forEach(b=>b.onclick=()=>{reservationEditing=b.dataset.reservationEdit;admin()});
 document.querySelectorAll('[data-reservation-status]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('/admin/reservations/'+b.dataset.reservationStatus,'PATCH',{status:b.dataset.statusValue});await loadReservations();admin()}catch(e){b.disabled=false;notify(e.message)}});
}
let superStore='',superMenu=[],superLinks=[],superOptions=[],superCart=[],superSource='takeaway',superTable='01',superCustomer='',superPhone='',superNote='',superBusy=false,superError='',superLoaded=false,superKey=crypto.randomUUID();
let superMobileTab='order';
let superMenuRequest=0;
const superMenuCache=new Map();
async function loadSuperMenu(){
 const storeId=superStore,request=++superMenuRequest;
 superLoaded=false;superError='';superMenu=[];superLinks=[];superOptions=[];
 if(!storeId)return;
 const cached=superMenuCache.get(storeId);
 if(cached){superMenu=cached.items;superLinks=cached.links;superOptions=cached.options;superLoaded=true;return;}
 try{
  const data=await api('/admin/super-pos/menu?store_id='+encodeURIComponent(storeId));
  if(request!==superMenuRequest||superStore!==storeId)return;
  const entry={items:data.items||[],links:data.links||[],options:data.options||[]};
  superMenuCache.set(storeId,entry);
  superMenu=entry.items;superLinks=entry.links;superOptions=entry.options;superLoaded=true;
 }catch(e){
  if(request!==superMenuRequest||superStore!==storeId)return;
  superError=e.message==='Failed to fetch'?'Network unavailable. Check connection and retry loading the menu.':e.message;
  superLoaded=true;
 }
}
let superCategory='All',superSearch='';
let superReservationRows=[],superReservationError='',superReservationLoading=false;
async function loadSuperReservations(){
 if(!superStore||superReservationLoading)return;
 const store=superStore;superReservationLoading=true;
 try{const data=await api('/admin/reservations?store_id='+encodeURIComponent(store));if(store!==superStore)return;superReservationRows=data.reservations||[];superReservationError=''}
 catch(e){if(store===superStore)superReservationError=e.message}
 finally{superReservationLoading=false;if(adminTab==='superpos'&&store===superStore)admin()}
}
function superReservationPanel(){
 const today=warsawDay(),rows=superReservationRows.filter(r=>r.status==='booked'&&r.starts_at.slice(0,10)>=today).sort((a,b)=>a.starts_at.localeCompare(b.starts_at));
 return '<section class="panel super-reservation-panel"><div class="row"><h2>Restaurant reservations</h2><button type="button" class="alt" id="super-reservation-refresh">Refresh</button></div><p class="muted">Adjust a booking for the selected restaurant.</p>'+(superReservationError?'<p role="alert">'+esc(superReservationError)+'</p>':'')+
 (rows.length?'<div class="reservation-table-wrap"><table class="reservation-table"><thead><tr><th>Date & time</th><th>Guest</th><th>Party</th><th>Change time</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.starts_at.replace('T',' '))+'</td><td>'+esc(r.guest_name||'Guest')+'</td><td>'+Number(r.party_size)+'</td><td><div class="super-reschedule-controls"><button type="button" class="alt" data-super-shift="'+esc(r.id)+'" data-shift-minutes="-60">−1 hour</button><input type="datetime-local" data-super-time="'+esc(r.id)+'" value="'+esc(r.starts_at.slice(0,16))+'"><button type="button" data-super-reschedule="'+esc(r.id)+'">Save time</button><button type="button" class="alt" data-super-shift="'+esc(r.id)+'" data-shift-minutes="60">+1 hour</button></div></td></tr>').join('')+'</tbody></table></div>':'<p>No upcoming booked reservations.</p>')+'</section>';
}
function superPosPanel(){
 const stores=v3Stores.filter(x=>x.active),selected=stores.find(x=>x.id===superStore);
 const storeOptions=stores.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===superStore?'selected':'')+'>'+esc(x.name)+'</option>').join('');
 const linePrice=line=>Number(superMenu.find(m=>m.id===line.menu_id)?.price_cents||0)+line.option_ids.reduce((sum,id)=>sum+Number(superOptions.find(o=>o.id===id)?.price_cents||0),0);
 const pending=superCart.find(x=>x.configuring),pendingItem=pending&&superMenu.find(m=>m.id===pending.menu_id);
 const total=superCart.filter(x=>!x.configuring).reduce((sum,line)=>sum+linePrice(line)*line.quantity,0);
 const categories=['All',...new Set(superMenu.map(m=>m.category))];
 const chips='<div class="chips">'+categories.map(c=>'<button type="button" data-super-category="'+esc(c)+'" class="'+(superCategory===c?'selected':'')+'">'+esc(c)+'</button>').join('')+'</div>';
 const dishes=superMenu.filter(m=>(superCategory==='All'||m.category===superCategory)&&(!superSearch||m.name.toLowerCase().includes(superSearch.toLowerCase()))).map(m=>'<button type="button" data-super-add="'+esc(m.id)+'">'+(m.image_url?'<img class="dish-photo" src="'+esc(m.image_url)+'" alt="" loading="lazy">':'')+'<strong>'+esc(m.name)+'</strong><span class="muted">'+money(m.price_cents)+'</span></button>').join('');
 const lines=superCart.filter(x=>!x.configuring).map(line=>{const i=superCart.indexOf(line),m=superMenu.find(x=>x.id===line.menu_id);return '<div class="foh-ticket-item"><div style="flex:1;min-width:0"><strong>'+esc(m?.name||'Dish')+'</strong><small>'+money(linePrice(line))+' each'+(line.option_ids.length?' · '+esc(line.option_ids.map(id=>superOptions.find(o=>o.id===id)?.name||'').join(', ')):'')+'</small><label>Instructions <input data-super-line-note="'+i+'" maxlength="300" placeholder="Optional" value="'+esc(line.note||'')+'"></label></div><div class="toolbar"><button type="button" class="alt" data-super-dec="'+i+'">−</button><b>'+line.quantity+'</b><button type="button" class="alt" data-super-inc="'+i+'">+</button><button type="button" class="alt" data-super-remove="'+i+'">×</button></div></div>';}).join('');
 const modifierForm=pendingItem?'<div class="item-dialog-backdrop"><section class="item-dialog" role="dialog" aria-modal="true"><div class="row"><h2>'+esc(pendingItem.name)+'</h2><button type="button" class="alt" id="super-config-cancel">✕</button></div><p class="muted">Base price '+money(pendingItem.price_cents)+'</p>'+superLinks.filter(x=>x.menu_id===pendingItem.id).map(g=>'<fieldset class="modifier-fieldset"><legend>'+esc(g.name)+' <small class="muted">'+g.min_select+'–'+g.max_select+'</small></legend>'+superOptions.filter(o=>o.group_id===g.group_id).map(o=>'<label class="modifier-choice"><input type="checkbox" data-super-option="'+esc(o.id)+'" '+(pending.option_ids.includes(o.id)?'checked':'')+'><span>'+esc(o.name)+'</span><b>'+(o.price_cents?'+'+money(o.price_cents):'Included')+'</b></label>').join('')+'</fieldset>').join('')+'<button type="button" id="super-config-done">Add to order</button></section></div>':'';
 return '<section class="admin-workspace"><div class="admin-section-head"><div><h2>Super POS</h2><p>Send orders to a restaurant’s Kitchen and Front of House.</p></div></div>'+
 '<div class="toolbar"><label>Restaurant <select id="super-store"><option value="">Select restaurant</option>'+storeOptions+'</select></label><label>Order type <select id="super-source">'+['takeaway','delivery','dinein'].map(x=>'<option value="'+x+'" '+(superSource===x?'selected':'')+'>'+esc(sourceName[x])+'</option>').join('')+'</select></label>'+(superSource==='dinein'?'<label>Table <select id="super-table">'+Array.from({length:20},(_,i)=>String(i+1).padStart(2,'0')).map(x=>'<option '+(superTable===x?'selected':'')+'>'+x+'</option>').join('')+'</select></label>':'')+'</div>'+
 '<div class="super-mobile-tabs" role="group"><button type="button" data-super-mobile-tab="order" class="'+(superMobileTab==='order'?'active':'')+'">New Order</button><button type="button" data-super-mobile-tab="cart" class="'+(superMobileTab==='cart'?'active':'')+'">Cart ('+superCart.filter(x=>!x.configuring).reduce((n,x)=>n+x.quantity,0)+')</button><button type="button" data-super-mobile-tab="reservations" class="'+(superMobileTab==='reservations'?'active':'')+'">Reservations</button></div><div class="layout foh-order super-mobile-layout" data-super-active="'+superMobileTab+'"><section class="super-mobile-order"><div class="panel"><div class="foh-title"><div><h2>New order'+(selected?' · '+esc(selected.name):'')+'</h2><p>Choose dishes to add to the ticket.</p></div></div><label>Search dishes <input id="super-search" placeholder="Search menu..." value="'+esc(superSearch)+'"></label>'+chips+'<div class="menu">'+(selected?(superLoaded?(superError?'':dishes):'<p>Loading menu…</p>'):'<p>Select a restaurant first.</p>')+'</div>'+(selected&&superError?'<p role="alert">'+esc(superError)+'</p><button type="button" class="alt" id="super-retry-menu">Retry loading menu</button>':'')+'</div></section>'+
 '<aside class="super-mobile-cart"><div class="panel foh-cart-panel"><h3>Current order</h3><div class="foh-ticket-items">'+(lines||'<p class="muted">No dishes selected.</p>')+'</div><label>Customer name <input id="super-customer" maxlength="100" value="'+esc(superCustomer)+'"></label><label>Phone <input id="super-phone" maxlength="60" value="'+esc(superPhone)+'"></label><label>Order note <textarea id="super-note" rows="3" maxlength="300">'+esc(superNote)+'</textarea></label><div class="row"><b>Total</b><b>'+money(total)+'</b></div>'+(superError?'<p role="alert">'+esc(superError)+'</p>':'')+'<button type="button" id="super-submit" '+(!selected||!superCart.length||!!pending||superBusy?'disabled':'')+'>'+(superBusy?'Submitting…':'Send to kitchen')+'</button><button type="button" class="alt" id="super-clear">Clear order</button></div></aside></div>'+'<div class="super-mobile-reservations">'+superReservationPanel()+'</div>'+modifierForm+'</section>';
}
function adminOrderPanel(){
 const labels={new:'Pending',cooking:'In progress',done:'Done',cancelled:'Cancelled'};
 const count=(id,k)=>Number(adminOrdersSummary.find(x=>x.store_id===id&&x.status===k)?.count||0);
 const selected=v3Stores.find(x=>x.id===adminOrdersStore);
 const storeCards=v3Stores.map(store=>{
  const total=['new','cooking','done','cancelled'].reduce((n,k)=>n+count(store.id,k),0);
  return '<article class="bo-monitor-store'+(adminOrdersStore===store.id?' selected':'')+'"><div class="bo-monitor-store-head"><div><h3>'+esc(store.name)+'</h3><small>'+total+' orders in selected period</small></div><span class="bo-monitor-store-tag">'+(store.active?'Restaurant':'Inactive')+'</span></div><div class="bo-monitor-store-statuses">'+['new','cooking','done','cancelled'].map(k=>'<button type="button" class="bo-monitor-status-button bo-monitor-'+k+(adminOrdersStore===store.id&&adminOrdersStatus===k?' selected':'')+'" data-monitor-store="'+esc(store.id)+'" data-monitor-status="'+k+'" aria-pressed="'+(adminOrdersStore===store.id&&adminOrdersStatus===k?'true':'false')+'"><strong>'+count(store.id,k)+'</strong><span>'+labels[k]+'</span></button>').join('')+'</div>'+(adminOrdersStore===store.id?'<button type="button" class="bo-monitor-show-all" data-monitor-store="'+esc(store.id)+'" data-monitor-status="">'+(adminOrdersStatus?'Show all statuses':'Hide orders')+'</button>':'<small class="bo-monitor-hint">Tap a status to view orders</small>')+'</article>';
 }).join('');
 const period=[['current','Today + Active'],['today','Today'],['yesterday','Yesterday'],['7days','Last 7 days'],['custom','Custom range']].map(x=>'<option value="'+x[0]+'" '+(adminOrdersPeriod===x[0]?'selected':'')+'>'+x[1]+'</option>').join('');
 const details=adminOrdersStore?'<div class="bo-monitor-results"><div class="bo-monitor-results-head"><div><h3>'+esc(selected?.name||'Restaurant')+' · '+(adminOrdersStatus?labels[adminOrdersStatus]:'All statuses')+'</h3><small>'+adminOrders.length+' orders on this page'+(adminOrdersHasMore?' · more available':'')+'</small></div><button type="button" class="alt" id="admin-orders-close">Close</button></div>'+
 (!adminOrdersLoaded?'<p>Loading orders…</p>':adminOrders.length?'<div class="bo-monitor-grid">'+adminOrders.map(adminOrderCard).join('')+'</div>':'<p class="bo-monitor-empty">No orders in this selection.</p>')+
 '<div class="toolbar bo-monitor-pagination"><button type="button" class="alt" id="admin-orders-prev" '+(adminOrdersOffset===0?'disabled':'')+'>Previous</button><span>Page '+(Math.floor(adminOrdersOffset/adminOrdersLimit)+1)+'</span><button type="button" class="alt" id="admin-orders-next" '+(!adminOrdersHasMore?'disabled':'')+'>Next</button></div></div>':'';
 return '<section class="admin-workspace bo-monitor-workspace"><div class="admin-section-head"><div><h2>Orders Monitor</h2><p>All restaurants · Live read-only monitoring</p></div><button type="button" class="alt" id="admin-orders-refresh">Refresh</button></div>'+
 '<div class="bo-monitor-simple-filter"><label>Period <select id="admin-orders-period">'+period+'</select></label><label>Order type <select id="admin-orders-type">'+[['all','All orders'],['regular','Regular'],['platform','Platform']].map(x=>'<option value="'+x[0]+'" '+(adminOrdersType===x[0]?'selected':'')+'>'+x[1]+'</option>').join('')+'</select></label><label>Platform <select id="admin-orders-platform">'+[['all','All platforms'],['uber_eats','Uber Eats'],['wolt','Wolt'],['pyszne','Pyszne.pl'],['bolt_food','Bolt Food'],['glovo','Glovo'],['other','Other']].map(x=>'<option value="'+x[0]+'" '+(adminOrdersPlatform===x[0]?'selected':'')+'>'+x[1]+'</option>').join('')+'</select></label><label>Collection <select id="admin-orders-collection">'+[['all','Any status'],['awaiting','Awaiting courier'],['collected','Collected']].map(x=>'<option value="'+x[0]+'" '+(adminOrdersCollection===x[0]?'selected':'')+'>'+x[1]+'</option>').join('')+'</select></label>'+(adminOrdersPeriod==='custom'?'<label>From <input type="date" id="admin-orders-from" value="'+esc(adminOrdersFrom)+'"></label><label>To <input type="date" id="admin-orders-to" value="'+esc(adminOrdersTo)+'"></label>':'')+'<label>Page size <select id="admin-orders-limit"><option value="50" '+(adminOrdersLimit===50?'selected':'')+'>50</option><option value="100" '+(adminOrdersLimit===100?'selected':'')+'>100</option></select></label></div>'+
 '<p class="bo-monitor-updated">'+(adminOrdersLastSync?'Last updated '+adminOrdersLastSync.toLocaleTimeString('en-GB',{timeZone:'Europe/Warsaw'}):'Waiting for first update')+'</p>'+
 (adminOrdersError?'<p class="warning" role="alert">'+esc(adminOrdersError)+'</p>':'')+
 '<div class="bo-monitor-store-grid">'+(storeCards||'<p>No restaurants available.</p>')+'</div>'+details+'</section>';
}

let serviceQualityOrders=[],serviceQualitySelectedRating=0;let serviceQualityRows=[],serviceQualityError='',serviceQualityStore='',serviceQualityFrom='',serviceQualityTo='';
async function loadServiceQuality(){
 try{const q=new URLSearchParams();if(serviceQualityStore)q.set('store_id',serviceQualityStore);if(serviceQualityFrom)q.set('from',serviceQualityFrom);if(serviceQualityTo)q.set('to',serviceQualityTo);const data=await api('/admin/service-quality?'+q);serviceQualityRows=data.rows||[];serviceQualityOrders=data.orders||[];serviceQualityError='';}catch(e){serviceQualityError=e.message;}
}
function serviceQualityPanel(){
 const total=serviceQualityRows.reduce((n,r)=>n+Number(r.count),0);
 const average=total?(serviceQualityRows.reduce((n,r)=>n+Number(r.rating)*Number(r.count),0)/total).toFixed(2):'—';
 const stores=[...new Map(serviceQualityRows.map(r=>[r.store_id,r.store_name])).entries()];
 const distribution=[1,2,3,4,5].map((rating)=>{const n=serviceQualityRows.filter(r=>Number(r.rating)===rating).reduce((sum,r)=>sum+Number(r.count),0);return '<button type="button" data-sq-rating="'+rating+'" style="display:flex;width:100%;align-items:center;gap:10px;margin:9px 0;border:'+(serviceQualitySelectedRating===rating?'2px solid #3b82f6':'1px solid #e5e7eb')+';background:transparent;border-radius:9px;padding:8px;text-align:left"><span style="min-width:105px">'+['','😡 Very Poor','☹️ Poor','😉 Average','😄 Good','🥰 Excellent'][rating]+'</span><div style="height:12px;background:#e9edf2;flex:1;border-radius:8px;overflow:hidden"><div style="width:'+(total?100*n/total:0)+'%;height:100%;background:#3b82f6"></div></div><strong>'+n+'</strong></button>'}).join('');
 const perStore=stores.map(([id,name])=>{const rows=serviceQualityRows.filter(r=>r.store_id===id),count=rows.reduce((n,r)=>n+Number(r.count),0),avg=count?(rows.reduce((n,r)=>n+Number(r.rating)*Number(r.count),0)/count).toFixed(2):'—';return '<tr><td>'+esc(name)+'</td><td>'+count+'</td><td>'+avg+'/5</td></tr>'}).join('');
 return '<section class="admin-workspace"><h2>Staff Self-Assessment</h2><p class="muted">Employee-reported service quality at manual POS checkout. Not customer-submitted feedback.</p><div class="row" style="gap:10px;flex-wrap:wrap"><label>Store<select id="sq-store"><option value="">All restaurants</option>'+v3Stores.map(x=>'<option value="'+esc(x.id)+'" '+(serviceQualityStore===x.id?'selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select></label><label>From<input type="date" id="sq-from" value="'+esc(serviceQualityFrom)+'"></label><label>To<input type="date" id="sq-to" value="'+esc(serviceQualityTo)+'"></label><button type="button" id="sq-apply">Apply</button></div>'+(serviceQualityError?'<p class="warning">'+esc(serviceQualityError)+'</p>':'')+'<div class="row" style="gap:24px;margin:20px 0"><div><small>Average rating</small><h2>'+average+'/5</h2></div><div><small>Rated checkouts</small><h2>'+total+'</h2></div></div>'+distribution+'<h3>Rated orders '+(serviceQualitySelectedRating?'· '+serviceEmoji[serviceQualitySelectedRating]:'')+'</h3><div class="sq-orders">'+(serviceQualityOrders.filter(o=>!serviceQualitySelectedRating||Number(o.rating)===serviceQualitySelectedRating).map(o=>'<div class="sq-order"><strong>'+serviceEmoji[Number(o.rating)]+' '+Number(o.rating)+'/5</strong><span>'+esc(o.store_name)+' · '+esc(o.source==='dinein'?'Table '+(o.table_no||'—'):o.source)+'</span><span>'+boStamp(o.rated_at)+'</span><code title="Full order ID">'+esc(o.order_id)+'</code></div>').join('')||'<p>No rated orders in this selection.</p>')+'</div><h3>By restaurant</h3><table style="width:100%"><thead><tr><th>Restaurant</th><th>Rated checkouts</th><th>Average</th></tr></thead><tbody>'+perStore+'</tbody></table></section>';
}
async function openPlatformMenuManager(){
 const overlay=document.createElement('div');overlay.style.cssText='position:fixed;inset:0;z-index:1100;background:#000a;display:flex;align-items:center;justify-content:center;padding:12px';
 const panel=document.createElement('div');panel.style.cssText='background:var(--surface,#fff);color:var(--text,#222);border-radius:14px;padding:20px;width:min(900px,100%);max-height:94vh;overflow:auto';
 panel.innerHTML='<div class="row" style="justify-content:space-between"><h2>Platform Menus</h2><button class="alt" id="pm-close">Close</button></div><p class="muted small">Configure each store and platform independently. Blank name or price uses the regular store menu. Kitchen always uses the master dish.</p><div class="row" style="gap:10px;flex-wrap:wrap"><label>Restaurant <select id="pm-store"></select></label><label>Platform <select id="pm-platform">'+[['wolt','Wolt'],['uber_eats','Uber Eats'],['pyszne','Pyszne.pl'],['glovo','Glovo'],['bolt_food','Bolt Food'],['other','Other']].map(([v,n])=>'<option value="'+v+'">'+n+'</option>').join('')+'</select></label></div><div id="pm-list">Loading...</div>';
 overlay.append(panel);document.body.append(overlay);const close=()=>overlay.remove();panel.querySelector('#pm-close').onclick=close;overlay.onclick=e=>{if(e.target===overlay)close()};
 const store=panel.querySelector('#pm-store'),platform=panel.querySelector('#pm-platform'),list=panel.querySelector('#pm-list');
 let loadSeq=0;
 const load=async()=>{const seq=++loadSeq;if(!store.value)return;list.textContent='Loading...';try{const rows=await api('/admin/stores/'+encodeURIComponent(store.value)+'/platform-menu?platform='+encodeURIComponent(platform.value));if(seq!==loadSeq)return;list.innerHTML=rows.map(m=>'<div class="admin-inline-form" data-pm-id="'+esc(m.id)+'" style="margin:10px 0"><strong>'+esc(m.kitchen_name)+'</strong><small class="muted"> · Store price '+money(m.base_price_cents)+'</small><div class="row" style="gap:8px;flex-wrap:wrap"><label>Platform name<input data-pm-name maxlength="150" placeholder="Use master name" value="'+esc(m.platform_name||'')+'"></label><label>Platform price (PLN)<input data-pm-price type="number" min="0" max="100000" step=".01" placeholder="Use store price" value="'+(m.platform_price_cents===null?'':(m.platform_price_cents/100).toFixed(2))+'"></label><label>Available <input type="checkbox" data-pm-active '+(m.platform_active?'checked':'')+'></label><button type="button" data-pm-save="'+esc(m.id)+'">Save</button></div></div>').join('')||'<p>No dishes available.</p>';
 list.querySelectorAll('[data-pm-save]').forEach(button=>button.onclick=async()=>{const row=button.closest('[data-pm-id]');const name=row.querySelector('[data-pm-name]').value.trim(),price=row.querySelector('[data-pm-price]').value.trim();const cents=price===''?null:Math.round(Number(price)*100);if(price!==''&&(!Number.isFinite(Number(price))||cents<0||cents>10000000)){notify('Invalid price');return}button.disabled=true;try{await api('/admin/stores/'+encodeURIComponent(store.value)+'/platform-menu/'+encodeURIComponent(button.dataset.pmSave),'PUT',{platform:platform.value,platform_name:name||null,price_cents:cents,active:row.querySelector('[data-pm-active]').checked});notify('Platform menu saved');}catch(e){notify(e.message)}finally{button.disabled=false}});
 }catch(e){if(seq===loadSeq)list.textContent='Could not load platform menu: '+e.message;}};
 store.onchange=load;platform.onchange=load;
 try{const result=await api('/admin/stores');store.innerHTML=(result.stores||[]).map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join('');await load();}catch(e){list.textContent='Could not load restaurants: '+e.message;}
}
document.addEventListener('click',e=>{if(e.target.closest('#open-platform-menu'))openPlatformMenuManager();});
let productionStore='global',productionData={components:[],mappings:[]};
async function loadProduction(){
 if(!v3Loaded)await loadV3Stores();
 if(!productionStore)productionStore='global';
 if(productionStore)productionData=await api('/production-components?store_id='+encodeURIComponent(productionStore));
 else productionData={components:[],mappings:[]};
 pcTiming=productionStore==='global'?null:await api('/production-timing?store_id='+encodeURIComponent(productionStore));
}
let pcOpenComponent='',pcCategory='All',pcSearch='',pcEditComponent='',pcTiming=null;
function productionPanel(){
 const stores='<option value="global" '+(productionStore==='global'?'selected':'')+'>Global — All Restaurants</option>'+v3Stores.filter(x=>x.active).map(x=>'<option value="'+esc(x.id)+'" '+(x.id===productionStore?'selected':'')+'>'+esc(x.name)+'</option>').join('');
 const categories=['All',...new Set(adminMenu.map(m=>m.category||'Other'))];
 return '<section class="admin-workspace"><div class="admin-section-head"><div><h2>Production Components</h2><p>Choose a component, then assign dishes using the same category and search workflow as Modifiers.</p></div></div>'+
 '<label>Restaurant<select id="pc-store">'+stores+'</select></label>'+
 (productionStore!=='global'?'<form id="pc-timing" class="admin-inline-form"><h3>Kitchen Timeline Settings</h3><div class="menu-form-grid"><label>Dine-in Default Ready Time (minutes)<input name="dine_in_minutes" type="number" min="1" max="240" required value="'+Number(pcTiming?.dine_in_minutes??20)+'"></label></div><button type="submit">Save timeline settings</button><p class="muted small">Delivery orders use the deadline selected by kitchen staff.</p></form>':'')+
 '<form id="pc-create" class="admin-inline-form"><div class="menu-form-grid"><label>Component Name<input name="name" placeholder="e.g. Fried Chicken" required maxlength="100"></label><label>Unit<input name="unit" value="portion" required></label><label>Emoji (optional)<input name="emoji" maxlength="24" placeholder="🍗"></label><label>Estimated Preparation Time (min)<input name="prep_minutes" type="number" min="0" max="1440" value="0"></label></div><button type="submit">+ Add component</button></form>'+
 productionData.components.map(c=>{
 const links=productionData.mappings.filter(m=>m.component_id===c.id);
 const inherited=c.scope==='global'&&productionStore!=='global';
 const open=pcOpenComponent===c.id;
 const visible=adminMenu.filter(m=>(pcCategory==='All'||(m.category||'Other')===pcCategory)&&(!pcSearch||m.name.toLowerCase().includes(pcSearch.toLowerCase())));
 const mapped=new Set(links.filter(m=>!m.modifier_option_id).map(m=>m.menu_id));
 const editing=pcEditComponent===c.id;
 return '<section class="panel" style="margin:12px 0;padding:16px"><div class="admin-section-head"><div><h3>'+esc(c.name)+'</h3><p>'+esc(c.unit)+' · '+c.prep_minutes+' min · '+(c.active?'Active':'Inactive')+' · '+links.length+' assignments'+(inherited?' · Inherited':'')+'</p></div><div class="toolbar"><button type="button" class="alt" data-pc-edit="'+esc(c.id)+'">'+(editing?'Cancel edit':'Edit')+'</button><button type="button" class="alt" data-pc-open="'+esc(c.id)+'">'+(open?'Close':'Apply to dishes')+'</button></div></div>'+
 (editing?'<form class="admin-inline-form" data-pc-edit-form="'+esc(c.id)+'"><div class="menu-form-grid"><label>Component Name<input name="name" required maxlength="100" value="'+esc(c.name)+'" '+(inherited?'readonly':'')+'></label><label>Unit<input name="unit" required maxlength="30" value="'+esc(c.unit)+'" '+(inherited?'readonly':'')+'></label><label>Emoji (optional)<input name="emoji" maxlength="24" placeholder="🍗" value="'+esc(c.emoji||'')+'"></label><label>Estimated Preparation Time (min)<input name="prep_minutes" type="number" min="0" max="1440" required value="'+Number(c.prep_minutes)+'"></label><label>Status<select name="active"><option value="1" '+(c.active?'selected':'')+'>Active</option><option value="0" '+(!c.active?'selected':'')+'>Inactive</option></select></label></div><button type="submit">Save component</button>'+(inherited?'<p class="muted small">Name and unit are inherited from Global; this restaurant can override emoji, time and status.</p>':'')+'</form>':'')+
 (open?'<div class="admin-inline-form"><div class="toolbar"><label>Category<select id="pc-category">'+categories.map(cat=>'<option value="'+esc(cat)+'" '+(cat===pcCategory?'selected':'')+'>'+esc(cat==='All'?'All categories':cat)+'</option>').join('')+'</select></label><label>Search dishes<input id="pc-search" placeholder="Search by dish name" value="'+esc(pcSearch)+'"></label></div>'+
 '<p class="muted small">'+links.length+' assignments · '+visible.length+' dishes shown'+(inherited?' · Manage assignments in Global':'')+'</p>'+
 '<div class="modifier-dish-list">'+visible.map(m=>'<label class="modifier-link"><input type="checkbox" data-pc-dish="'+esc(m.id)+'" '+(mapped.has(m.id)?'checked':'')+' '+(inherited?'disabled':'')+'><span>'+esc(m.name)+'</span><small class="muted">'+esc(m.category||'Other')+'</small></label>').join('')+'</div>'+
 (inherited?'':'<div class="toolbar"><label>Quantity per selected dish<input id="pc-quantity" type="number" min="0.01" step="0.01" value="1"></label><button type="button" id="pc-save-dishes" data-component="'+esc(c.id)+'">Save dish assignments</button></div>')+
 '<div class="admin-inline-form"><h4>Modifier-specific components</h4><p class="muted small">Expand a dish to choose one or more modifier options. Each option has its own Component Quantity. These conditions count only when the option is selected in a ticket.</p>'+
 visible.filter(m=>adminModifiers.links.some(l=>l.menu_id===m.id)).map(m=>{
  const groups=adminModifiers.groups.filter(g=>adminModifiers.links.some(l=>l.menu_id===m.id&&l.group_id===g.id));
  const conditions=links.filter(l=>l.menu_id===m.id&&l.modifier_option_id);
  return '<details class="panel" style="padding:10px;margin:8px 0" data-pc-condition-dish="'+esc(m.id)+'"><summary><strong>'+esc(m.name)+'</strong> · '+conditions.length+' modifier conditions'+(mapped.has(m.id)?' · Always required also enabled':'')+'</summary>'+
  (mapped.has(m.id)?'<p class="muted small">Note: Always required is enabled above. Modifier conditions will add to that quantity.</p>':'')+
  groups.map(g=>'<div class="admin-inline-form"><strong>'+esc(g.name)+'</strong>'+
   adminModifiers.options.filter(o=>o.group_id===g.id&&o.active).map(o=>{
    const existing=conditions.find(l=>l.modifier_option_id===o.id);
    return '<div class="modifier-link" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><label style="display:flex;align-items:center;gap:8px;flex:1;min-width:180px"><input type="checkbox" data-pc-option="'+esc(o.id)+'" '+(existing?'checked':'')+' '+(inherited?'disabled':'')+'><span>'+esc(o.name)+'</span></label><label style="display:flex;align-items:center;gap:6px">Component Quantity<input type="number" data-pc-option-qty="'+esc(o.id)+'" min="0.01" max="100000" step="0.01" value="'+Number(existing?.quantity_per_dish||1)+'" style="width:88px" '+(inherited?'disabled':'')+'></label></div>';
   }).join('')+'</div>').join('')+
 (inherited?'<p class="muted small">Manage inherited assignments in Global.</p>':'<button type="button" class="alt" data-pc-save-conditions="'+esc(m.id)+'" data-component="'+esc(c.id)+'">Save modifier options</button>')+
 '</details>';
 }).join('')+'</div>'+
 '</div>':'')+'</section>';
 }).join('')+'</section>';
}
function bindProductionPanel(){
 const store=document.querySelector('#pc-store');if(!store)return;
 const timingForm=document.querySelector('#pc-timing');if(timingForm)timingForm.onsubmit=async e=>{e.preventDefault();const mins=Number(new FormData(timingForm).get('dine_in_minutes'));try{await api('/production-timing','PUT',{store_id:productionStore,dine_in_minutes:mins});await loadProduction();admin();notify('Timeline settings saved')}catch(err){notify(err.message)}};

 store.onchange=()=>{productionStore=store.value;loadProduction().then(admin).catch(e=>notify(e.message))};
 document.querySelector('#pc-create').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/production-components','POST',{store_id:productionStore,name:f.get('name'),unit:f.get('unit'),prep_minutes:Number(f.get('prep_minutes')),emoji:String(f.get('emoji')||'').trim()});await loadProduction();admin()}catch(e){notify(e.message)}};
 document.querySelectorAll('[data-pc-open]').forEach(el=>el.onclick=()=>{pcOpenComponent=pcOpenComponent===el.dataset.pcOpen?'':el.dataset.pcOpen;pcCategory='All';pcSearch='';admin()});
 const category=document.querySelector('#pc-category');if(category)category.onchange=()=>{pcCategory=category.value;admin()};
 const search=document.querySelector('#pc-search');if(search)search.oninput=()=>{pcSearch=search.value;const component=pcOpenComponent;const checked=new Set([...document.querySelectorAll('[data-pc-dish]:checked')].map(x=>x.dataset.pcDish));document.querySelectorAll('[data-pc-dish]').forEach(el=>{const dish=adminMenu.find(m=>m.id===el.dataset.pcDish);el.parentElement.hidden=!!dish&&!dish.name.toLowerCase().includes(pcSearch.toLowerCase());});};
 const save=document.querySelector('#pc-save-dishes');if(save)save.onclick=async()=>{const component=save.dataset.component;const quantity=Number(document.querySelector('#pc-quantity')?.value);if(!(quantity>0)){notify('Enter a positive quantity');return}const visibleInputs=[...document.querySelectorAll('[data-pc-dish]')].filter(x=>!x.parentElement.hidden);const selected=new Set(visibleInputs.filter(x=>x.checked).map(x=>x.dataset.pcDish));const visible=new Set(visibleInputs.map(x=>x.dataset.pcDish));const existing=productionData.mappings.filter(m=>m.component_id===component&&!m.modifier_option_id&&visible.has(m.menu_id));save.disabled=true;try{for(const m of existing){if(!selected.has(m.menu_id))await api('/production-mappings/'+encodeURIComponent(m.id)+'?store_id='+encodeURIComponent(productionStore),'DELETE');}const mapped=new Set(existing.map(m=>m.menu_id));for(const id of selected){if(!mapped.has(id))await api('/production-mappings','POST',{store_id:productionStore,component_id:component,menu_id:id,quantity_per_dish:quantity,modifier_option_id:null});}await loadProduction();admin();notify('Dish assignments saved')}catch(e){notify(e.message);save.disabled=false}};
 document.querySelectorAll('[data-pc-edit]').forEach(el=>el.onclick=()=>{pcEditComponent=pcEditComponent===el.dataset.pcEdit?'':el.dataset.pcEdit;admin()});
 document.querySelectorAll('[data-pc-edit-form]').forEach(form=>form.onsubmit=async e=>{e.preventDefault();const c=productionData.components.find(x=>x.id===form.dataset.pcEditForm);if(!c)return;const f=new FormData(form);const payload={store_id:productionStore,name:f.get('name'),unit:f.get('unit'),prep_minutes:Number(f.get('prep_minutes')),emoji:String(f.get('emoji')||'').trim(),active:Number(f.get('active'))};if(c.scope==='global'&&productionStore!=='global'){payload.name=c.name;payload.unit=c.unit;}try{await api('/production-components/'+encodeURIComponent(c.id),'PATCH',payload);pcEditComponent='';await loadProduction();admin();notify('Component updated')}catch(err){notify(err.message)}});
 document.querySelectorAll('[data-pc-save-conditions]').forEach(button=>button.onclick=async()=>{
  const dishId=button.dataset.pcSaveConditions,componentId=button.dataset.component;
  const panel=button.closest('[data-pc-condition-dish]');
  const options=[...panel.querySelectorAll('[data-pc-option]')];
  const desired=new Map();
  for(const input of options){
   if(!input.checked)continue;
   const qty=Number(panel.querySelector('[data-pc-option-qty="'+input.dataset.pcOption+'"]')?.value);
   if(!(qty>0&&qty<=100000)){notify('Component Quantity must be between 0.01 and 100000');return}
   desired.set(input.dataset.pcOption,qty);
  }
  const existing=productionData.mappings.filter(m=>m.component_id===componentId&&m.menu_id===dishId&&m.modifier_option_id);
  button.disabled=true;
  try{
   for(const mapping of existing){
    const wanted=desired.get(mapping.modifier_option_id);
    if(wanted===undefined||Number(mapping.quantity_per_dish)!==wanted){
     await api('/production-mappings/'+encodeURIComponent(mapping.id)+'?store_id='+encodeURIComponent(productionStore),'DELETE');
    }
   }
   for(const [optionId,quantity] of desired){
    if(existing.some(m=>m.modifier_option_id===optionId&&Number(m.quantity_per_dish)===quantity))continue;
    await api('/production-mappings','POST',{store_id:productionStore,component_id:componentId,menu_id:dishId,modifier_option_id:optionId,quantity_per_dish:quantity});
   }
   await loadProduction();admin();notify('Modifier options saved');
  }catch(err){notify(err.message);button.disabled=false}
 });

}
function admin(){
 const filtered=adminMenu.filter(m=>!adminFilter||m.category===adminFilter);
 const cats=adminCategories.map(c=>'<option value="'+esc(c.name)+'">'+esc(c.name)+'</option>').join('');
 const categoryCards=adminCategories.map(c=>'<div class="category-card"><div><strong>'+esc(c.name)+'</strong><small>'+c.item_count+' dishes · Position '+c.sort_order+'</small></div><div class="toolbar"><button type="button" class="alt" data-cat-edit="'+esc(c.id)+'">Edit</button><button type="button" class="alt" data-cat-delete="'+esc(c.id)+'" '+(c.item_count?'disabled title="Move dishes before deleting"':'')+'>Delete</button></div></div>').join('');
 const menuRows=filtered.map(m=>'<div class="admin-dish"><div class="admin-dish-media">'+(m.image_url?'<img src="'+esc(m.image_url)+'" loading="lazy" alt="">':'🍽️')+'</div><div class="admin-dish-info"><strong>'+esc(m.name)+'</strong><small>'+esc(m.category)+' · VAT '+m.vat_rate+'% · Sort '+m.sort_order+'</small><span class="admin-pill '+(m.active?'':'inactive')+'">'+(m.active?'Active':'Inactive')+'</span></div><b>'+((m.price_cents||0)/100).toFixed(2)+' zł</b><button type="button" class="alt" data-menu-edit="'+esc(m.id)+'">Edit</button><button type="button" class="alt admin-delete-dish" data-menu-delete="'+esc(m.id)+'">Delete</button></div>').join('');
 shell('<div class="bo-layout"><div class="bo-mobile-header"><button type="button" id="bo-mobile-menu" aria-label="Open Back Office menu">☰ Menu</button><strong>'+esc(({overview:'Overview',orders:'Orders',superpos:'Super POS',reservations:'Reservations',menu:'Menu',stores:'Restaurants',devices:'Devices','service-quality':'Service Quality',categories:'Categories',modifiers:'Modifiers'})[adminTab])+'</strong></div><aside class="bo-sidebar" aria-label="Back Office navigation"><div class="bo-brand"><strong>CHICKEN i KIMCHI</strong><small>BACK OFFICE</small></div><nav class="bo-nav">'+
 [['overview','Overview'],['orders','Orders'],['superpos','Super POS'],['reservations','Reservations'],['menu','Menu'],['stores','Restaurants'],['devices','Devices'],['service-quality','Service Quality'],['categories','Categories'],['modifiers','Modifiers'],['production','Production Components']].map(([id,label])=>'<button type="button" data-admin-tab="'+id+'" class="'+(adminTab===id?'selected':'')+'" aria-current="'+(adminTab===id?'page':'false')+'">'+label+'</button>').join('')+
 '</nav></aside><div class="bo-content"><div class="admin-head"><div><span class="admin-eyebrow">RESTAURANT CONTROL CENTER</span><h1>'+esc(({overview:'Overview',orders:'Orders',superpos:'Super POS',reservations:'Reservations',menu:'Menu',stores:'Restaurants',devices:'Devices',categories:'Categories',modifiers:'Modifiers'})[adminTab]||'Back Office')+'</h1><p>Chicken i Kimchi · Back Office</p></div></div>'+
 (adminTab==='overview'?overviewPanel():'')+(adminTab==='service-quality'?serviceQualityPanel():'')+(adminTab==='production'?productionPanel():'')+
 '<section class="admin-workspace" '+(adminTab==='menu'?'':'hidden')+'><div class="admin-section-head"><div><h2>Master Menu</h2><p>Edit dishes, photos, prices and availability.</p></div><div class="row"><button type="button" class="alt" id="open-platform-menu">Platform Menus</button><button id="addmenu">+ Add dish</button></div></div><div class="admin-filter"><label>Filter by category <select id="admin-category-filter"><option value="">All categories</option>'+cats+'</select></label><span>'+filtered.length+' dishes</span></div><div class="admin-dish-list">'+(menuRows||'<div class="admin-empty">No dishes in this category.</div>')+'</div></section>'+
 '<section class="admin-workspace" '+(adminTab==='categories'?'':'hidden')+'><div class="admin-section-head"><div><h2>Categories</h2><p>Changes to a category name update its dishes automatically.</p></div><button id="addcategory">+ Add category</button></div><div class="admin-category-list">'+(categoryCards||'<div class="admin-empty">No categories yet.</div>')+'</div><form id="category-form" class="admin-inline-form" hidden><h3 id="category-title">New category</h3><div class="menu-form-grid"><label>Category name<input id="category-name" maxlength="50" required></label><label>Display position<input id="category-sort" type="number" value="0" step="1" required></label></div><div class="toolbar"><button type="submit" id="category-save">Save category</button><button type="button" class="alt" id="category-cancel">Cancel</button></div></form></section>'+
 '<section class="admin-workspace" '+(adminTab==='modifiers'?'':'hidden')+'><div class="admin-section-head"><div><h2>Modifiers</h2><p>Manage groups, options and dish assignments.</p></div><button id="mod-new-group">+ Add group</button></div><div id="mod-group-list">'+adminModifiers.groups.map(g=>'<div class="modifier-group-card"><div class="row"><strong>'+esc(g.name)+'</strong><button class="alt" data-mod-edit-group="'+esc(g.id)+'">Edit</button></div><p class="muted small">Choose '+g.min_select+' to '+g.max_select+' · '+(g.active?'Active':'Inactive')+'</p>'+adminModifiers.options.filter(o=>o.group_id===g.id).map(o=>'<div class="row"><span>'+esc(o.name)+' · +'+(o.price_cents/100).toFixed(2)+' zł '+(o.active?'':'(Inactive)')+'</span><button class="alt" data-mod-edit-option="'+esc(o.id)+'">Edit</button></div>').join('')+'<button class="alt" data-mod-new-option="'+esc(g.id)+'">+ Add option</button></div>').join('')+'</div><div class="admin-inline-form"><h3>Apply modifier group to dishes</h3><p class="muted">Choose a modifier group, then select all applicable dishes. Saving changes only this group.</p><label>Modifier group<select id="mod-assign-group"><option value="">Choose a group</option>'+adminModifiers.groups.map(g=>'<option value="'+esc(g.id)+'">'+esc(g.name)+'</option>').join('')+'</select></label><div class="toolbar"><input id="mod-search" placeholder="Search dishes" aria-label="Search dishes"><select id="mod-category-filter"><option value="">All categories</option>'+adminCategories.map(c=>'<option value="'+esc(c.name)+'">'+esc(c.name)+'</option>').join('')+'</select></div><div class="row"><span id="mod-selected-count" class="muted">Choose a group</span><div class="toolbar"><button class="alt" type="button" id="mod-select-all" disabled>Select all visible</button><button class="alt" type="button" id="mod-clear-visible" disabled>Clear visible</button></div></div><div id="mod-dish-list" class="modifier-dish-list"></div><button id="mod-save-links" disabled>Save dish assignments</button></div><form id="mod-group-form" class="admin-inline-form" hidden><h3>Modifier group</h3><div class="menu-form-grid"><label>Name<input id="mod-group-name" required maxlength="100"></label><label>Minimum selections<input id="mod-group-min" type="number" min="0" max="20" required></label><label>Maximum selections<input id="mod-group-max" type="number" min="1" max="20" required></label><label>Status<select id="mod-group-active"><option value="1">Active</option><option value="0">Inactive</option></select></label></div><button type="submit">Save group</button><button type="button" class="alt" id="mod-cancel-group">Cancel</button></form><form id="mod-option-form" class="admin-inline-form" hidden><h3>Modifier option</h3><div class="menu-form-grid"><label>Name<input id="mod-option-name" required maxlength="100"></label><label>Extra price PLN<input id="mod-option-price" type="number" min="0" step=".01" required></label><label>Status<select id="mod-option-active"><option value="1">Active</option><option value="0">Inactive</option></select></label></div><button type="submit">Save option</button><button type="button" class="alt" id="mod-cancel-option">Cancel</button></form></section>'+'<div '+(adminTab==='orders'?'':'hidden')+'>'+adminOrderPanel()+'</div>'+'<div '+(adminTab==='superpos'?'':'hidden')+'>'+superPosPanel()+'</div>'+'<div '+(adminTab==='reservations'?'':'hidden')+'>'+reservationPanel()+'</div>'+ 
 '<div '+(['stores','devices'].includes(adminTab)?'':'hidden')+'>'+v3StorePanel()+'</div>'+'</div></div>'+ '<div id="menu-editor-backdrop" class="admin-modal-backdrop" hidden><section id="menu-editor" class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title"><div class="admin-modal-head"><div><span class="admin-eyebrow">MENU EDITOR</span><h2 id="editor-title">Add dish</h2></div><button type="button" class="alt" id="menu-cancel">Close</button></div><form id="menu-form"><div class="menu-form-grid"><label>Dish name<input id="menu-name" required maxlength="100"></label><label>Category<select id="menu-category" required><option value="">Select category</option>'+cats+'</select></label><label>Gross price (PLN)<input id="menu-price" required type="number" min="0" max="100000" step=".01"></label><label>VAT rate<select id="menu-vat"><option value="8">8%</option><option value="23">23%</option><option value="5">5%</option><option value="0">0%</option></select></label><label>DAG Group (optional)<input id="menu-dag-group" maxlength="100" placeholder="e.g. Fried Chicken / Yangnyeom"></label><label>Sort order<input id="menu-sort" type="number" step="1" value="0"></label><label>Availability<select id="menu-active"><option value="1">Active</option><option value="0">Inactive</option></select></label></div><div class="menu-upload"><label>Dish photo · converted to WebP<input id="menu-image-file" type="file" accept="image/*,.heic,.heif,.avif"></label><img id="menu-image-preview" class="admin-preview" hidden alt="Dish preview"><button type="button" class="alt" id="menu-image-remove">Remove photo</button><p class="muted small" id="menu-upload-status"></p></div><div class="admin-modal-actions"><button id="menu-save" type="submit">Save dish</button><button type="button" class="alt" id="menu-cancel-bottom">Cancel</button></div></form></section></div>');
 const mobileMenu=document.querySelector('#bo-mobile-menu');if(mobileMenu)mobileMenu.onclick=()=>document.querySelector('.bo-layout')?.classList.toggle('bo-mobile-open');
 if(adminTab==='reservations')bindReservations();
 if(adminTab==='service-quality'){document.querySelectorAll('[data-sq-rating]').forEach(b=>b.onclick=()=>{serviceQualitySelectedRating=serviceQualitySelectedRating===Number(b.dataset.sqRating)?0:Number(b.dataset.sqRating);admin()});document.querySelector('#sq-apply')?.addEventListener('click',async()=>{serviceQualityStore=document.querySelector('#sq-store').value;serviceQualityFrom=document.querySelector('#sq-from').value;serviceQualityTo=document.querySelector('#sq-to').value;await loadServiceQuality();admin();});}

 document.querySelectorAll('[data-admin-tab]').forEach(el=>el.onclick=()=>{adminTab=el.dataset.adminTab;if(['stores','devices','orders','overview','superpos','reservations'].includes(adminTab)&&!v3Loaded)loadV3Stores().then(()=>admin()).catch(e=>notify(e.message));if(adminTab==='orders')loadAdminOrders().then(()=>admin());if(adminTab==='service-quality'){loadV3Stores().then(loadServiceQuality).then(()=>{if(adminTab==='service-quality')admin()}).catch(e=>notify(e.message));}if(adminTab==='reservations')Promise.resolve(v3Loaded?null:loadV3Stores()).then(loadReservations).then(()=>{if(adminTab==='reservations')admin()}).catch(e=>notify(e.message));if(adminTab==='superpos'){if(!superStore)superStore=v3Stores.find(x=>x.active)?.id||'';loadSuperMenu().then(()=>{if(adminTab==='superpos')admin()});loadSuperReservations()}if(adminTab==='production')Promise.resolve(v3Loaded?null:loadV3Stores()).then(loadProduction).then(()=>{if(adminTab==='production')admin()}).catch(e=>notify(e.message));if(adminTab==='overview')loadOverview().then(()=>{if(adminTab==='overview')admin()});admin()});
 bindProductionPanel();
 const superRefresh=document.querySelector('#super-reservation-refresh');if(superRefresh)superRefresh.onclick=()=>loadSuperReservations();
 document.querySelectorAll('[data-super-shift]').forEach(btn=>btn.onclick=()=>{
 const input=document.querySelector('[data-super-time="'+btn.dataset.superShift+'"]');if(!input?.value)return;
 const date=new Date(input.value);date.setMinutes(date.getMinutes()+Number(btn.dataset.shiftMinutes));
 const pad=n=>String(n).padStart(2,'0');input.value=date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+'T'+pad(date.getHours())+':'+pad(date.getMinutes());
 });
 document.querySelectorAll('[data-super-reschedule]').forEach(btn=>btn.onclick=async()=>{
 const id=btn.dataset.superReschedule,r=superReservationRows.find(x=>x.id===id),input=document.querySelector('[data-super-time="'+id+'"]');
 if(!r||!input?.value||input.value===r.starts_at.slice(0,16))return;
 if(!confirm('Change reservation from '+r.starts_at.replace('T',' ')+' to '+input.value.replace('T',' ')+'?'))return;
 btn.disabled=true;try{await api('/admin/reservations/'+encodeURIComponent(id),'PATCH',{starts_at:input.value});notify('Reservation time updated');await loadSuperReservations()}catch(e){btn.disabled=false;notify(e.message)}
 });
 document.querySelectorAll('[data-super-mobile-tab]').forEach(b=>b.onclick=()=>{superMobileTab=b.dataset.superMobileTab;admin()});
 const superStoreEl=document.querySelector('#super-store');
 if(superStoreEl)superStoreEl.onchange=e=>{superStore=e.target.value;superCart=[];superCategory='All';superSearch='';superKey=crypto.randomUUID();superLoaded=false;superReservationRows=[];loadSuperMenu().then(()=>{if(adminTab==='superpos')admin()});loadSuperReservations();admin()};
 const superRetry=document.getElementById('super-retry-menu');if(superRetry)superRetry.onclick=()=>{superMenuCache.delete(superStore);loadSuperMenu().then(()=>{if(adminTab==='superpos')admin()});admin()};
 const superSourceEl=document.querySelector('#super-source');if(superSourceEl)superSourceEl.onchange=e=>{superSource=e.target.value;admin()};
 const superTableEl=document.querySelector('#super-table');if(superTableEl)superTableEl.onchange=e=>{superTable=e.target.value};
 for(const [id,set] of [['super-customer',v=>superCustomer=v],['super-phone',v=>superPhone=v],['super-note',v=>superNote=v]]){const el=document.getElementById(id);if(el)el.oninput=e=>set(e.target.value);}
 document.querySelectorAll('[data-super-category]').forEach(el=>el.onclick=()=>{superCategory=el.dataset.superCategory;admin()});
 const searchEl=document.getElementById('super-search');if(searchEl)searchEl.oninput=e=>{superSearch=e.target.value;const buttons=document.querySelectorAll('[data-super-add]');buttons.forEach(btn=>{const dish=superMenu.find(m=>m.id===btn.dataset.superAdd);btn.hidden=!!superSearch&&!dish?.name.toLowerCase().includes(superSearch.toLowerCase())})};
 document.querySelectorAll('[data-super-dec]').forEach(el=>el.onclick=()=>{const line=superCart[Number(el.dataset.superDec)];if(line){line.quantity=Math.max(1,line.quantity-1);admin()}});
 document.querySelectorAll('[data-super-inc]').forEach(el=>el.onclick=()=>{const line=superCart[Number(el.dataset.superInc)];if(line){line.quantity=Math.min(99,line.quantity+1);admin()}});
 const clearSuper=document.getElementById('super-clear');if(clearSuper)clearSuper.onclick=()=>{if(superCart.length&&!confirm('Clear this order?'))return;superCart=[];superKey=crypto.randomUUID();superError='';admin()};
 document.querySelectorAll('[data-super-add]').forEach(el=>el.onclick=()=>{const id=el.dataset.superAdd;const hasGroups=superLinks.some(x=>x.menu_id===id);superCart.push({menu_id:id,quantity:1,option_ids:[],note:'',configuring:hasGroups});admin()});
 document.querySelectorAll('[data-super-remove]').forEach(el=>el.onclick=()=>{superCart.splice(Number(el.dataset.superRemove),1);admin()});
 document.querySelectorAll('[data-super-qty]').forEach(el=>el.onchange=e=>{superCart[Number(el.dataset.superQty)].quantity=Math.max(1,Math.min(99,Number(e.target.value)||1));admin()});
 document.querySelectorAll('[data-super-line-note]').forEach(el=>el.oninput=e=>{superCart[Number(el.dataset.superLineNote)].note=e.target.value});
 document.querySelectorAll('[data-super-option]').forEach(el=>el.onchange=e=>{const line=superCart.find(x=>x.configuring);if(!line)return;const id=el.dataset.superOption;line.option_ids=e.target.checked?[...line.option_ids,id]:line.option_ids.filter(x=>x!==id)});
 const done=document.getElementById('super-config-done');if(done)done.onclick=()=>{const line=superCart.find(x=>x.configuring);if(!line)return;for(const g of superLinks.filter(x=>x.menu_id===line.menu_id)){const count=line.option_ids.filter(id=>superOptions.some(o=>o.id===id&&o.group_id===g.group_id)).length;if(count<g.min_select||count>g.max_select){notify('Select '+g.min_select+' to '+g.max_select+' options for '+g.name);return;}}delete line.configuring;admin()};
 const cancel=document.getElementById('super-config-cancel');if(cancel)cancel.onclick=()=>{superCart=superCart.filter(x=>!x.configuring);admin()};
 const submit=document.getElementById('super-submit');if(submit)submit.onclick=async()=>{if(superBusy||!superStore||!superCart.length||superCart.some(x=>x.configuring))return;superBusy=true;submit.disabled=true;try{const result=await api('/admin/super-pos/orders','POST',{store_id:superStore,source:superSource,table_no:superSource==='dinein'?superTable:'',customer_name:superCustomer,customer_phone:superPhone,note:superNote,client_key:superKey,items:superCart.map(x=>({menu_id:x.menu_id,quantity:x.quantity,option_ids:x.option_ids,note:x.note}))});superCart=[];superKey=crypto.randomUUID();superCustomer='';superPhone='';superNote='';superError='';notify('Order sent to restaurant · '+result.id.slice(0,8));}catch(e){superError=e.message;}finally{superBusy=false;admin()}};
 if(adminTab==='overview')bindBoWorkload();
 const overviewRefresh=document.querySelector('#bo-overview-refresh');if(overviewRefresh)overviewRefresh.onclick=async()=>{await loadOverview();if(adminTab==='overview')admin();};
 const reloadOrders=()=>{adminOrdersOffset=0;adminOrdersLoaded=false;loadAdminOrders().then(()=>{if(adminTab==='orders')admin()})};
 document.querySelector('#admin-orders-limit').onchange=e=>{adminOrdersLimit=Number(e.target.value);reloadOrders()};
 document.querySelector('#admin-orders-period').onchange=e=>{adminOrdersPeriod=e.target.value;reloadOrders();};
 document.querySelector('#admin-orders-type').onchange=e=>{adminOrdersType=e.target.value;if(adminOrdersType==='regular'){adminOrdersPlatform='all';adminOrdersCollection='all';}reloadOrders()};
 document.querySelector('#admin-orders-platform').onchange=e=>{adminOrdersPlatform=e.target.value;if(adminOrdersPlatform!=='all')adminOrdersType='platform';reloadOrders()};
 document.querySelector('#admin-orders-collection').onchange=e=>{adminOrdersCollection=e.target.value;if(adminOrdersCollection!=='all')adminOrdersType='platform';reloadOrders()};
 if(adminOrdersPeriod==='custom'){document.querySelector('#admin-orders-from').onchange=e=>{adminOrdersFrom=e.target.value;reloadOrders()};document.querySelector('#admin-orders-to').onchange=e=>{adminOrdersTo=e.target.value;reloadOrders()};}
 document.querySelectorAll('[data-monitor-store][data-monitor-status]').forEach(btn=>btn.onclick=()=>{const store=btn.dataset.monitorStore,status=btn.dataset.monitorStatus;if(adminOrdersStore===store&&adminOrdersStatus===status){adminOrdersStore='';adminOrdersStatus='';}else{adminOrdersStore=store;adminOrdersStatus=status;}reloadOrders()});
 document.querySelector('#admin-orders-close')?.addEventListener('click',()=>{adminOrdersStore='';adminOrdersStatus='';reloadOrders()});
 document.querySelector('#admin-orders-refresh').onclick=()=>loadAdminOrders().then(()=>admin());
 if(document.querySelector('#admin-orders-prev'))document.querySelector('#admin-orders-prev').onclick=()=>{adminOrdersOffset=Math.max(0,adminOrdersOffset-adminOrdersLimit);loadAdminOrders().then(()=>admin())};
 if(document.querySelector('#admin-orders-next'))document.querySelector('#admin-orders-next').onclick=()=>{if(!adminOrdersHasMore)return;adminOrdersOffset+=adminOrdersLimit;loadAdminOrders().then(()=>admin())};
 document.querySelector('#v3-toggle-store').onclick=async()=>{
  const store=v3Stores.find(x=>x.id===v3SelectedStore);if(!store)return;
  if(!confirm((store.active?'Deactivate ':'Activate ')+store.name+'?'))return;
  try{await api('/admin/stores/'+encodeURIComponent(store.id)+'/config','PATCH',{active:!store.active});await loadV3Stores();admin();notify('Store status updated')}catch(err){notify(err.message)}
 };
 const menuDisclosure=document.querySelector('.v3-menu-disclosure');if(menuDisclosure)menuDisclosure.ontoggle=()=>{v3StoreMenuOpen=menuDisclosure.open};
 const revokedDisclosure=document.querySelector('.v3-revoked-devices');if(revokedDisclosure)revokedDisclosure.ontoggle=()=>{v3RevokedOpen=revokedDisclosure.open};
 document.querySelectorAll('#v3-pair-approve input[name="store_ids"]').forEach(box=>box.onchange=()=>{if(v3PairAllowedStores===null)v3PairAllowedStores=new Set(v3SelectedStore?[String(v3SelectedStore)]:[]);if(box.checked)v3PairAllowedStores.add(box.value);else v3PairAllowedStores.delete(box.value)});
 document.querySelector('#v3-pair-approve').onsubmit=async e=>{
  e.preventDefault();const f=e.currentTarget,btn=f.querySelector('button[type=submit]');btn.disabled=true;
  try{
   const formData=new FormData(f);
   const store_ids=formData.getAll('store_ids').map(String);
   if(!store_ids.length)throw Error('Select at least one active store');
   const data=Object.fromEntries(formData);
   await api('/admin/device-pairings/approve','POST',{...data,store_ids});
   f.reset();v3PairAllowedStores=null;v3Devices=(await api('/admin/devices')).devices||[];
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
   overlay.innerHTML='<section class="v3-grants-dialog" role="dialog" aria-modal="true"><h2>Allowed stores</h2><p class="v3-grants-device">Device: <strong>'+esc(v3Devices.find(d=>d.id===id)?.label||id)+'</strong></p><p class="muted">Choose the stores this device can access.</p><form id="v3-grants-editor"><div class="v3-grants-options">'+v3Stores.filter(x=>x.active).map(x=>'<label class="v3-grant-option"><input type="checkbox" name="store_ids" value="'+esc(x.id)+'" '+(granted.has(x.id)?'checked':'')+'><span>'+esc(x.name)+'</span></label>').join('')+'</div><label class="v3-grants-password">Secondary password<input type="password" name="secondary_pin" autocomplete="off" required></label><div class="toolbar"><button type="button" id="v3-grants-cancel" class="alt">Cancel</button><button type="submit">Save access</button></div></form></section>';
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
 document.querySelectorAll('[data-v3-attendance]').forEach(btn=>btn.onclick=async()=>{
  const id=btn.dataset.v3Attendance,device=v3Devices.find(d=>d.id===id);if(!device)return;
  const enabled=!Boolean(device.attendance_qr_enabled);
  btn.disabled=true;
  try{await api('/admin/devices/'+encodeURIComponent(id)+'/attendance-qr','PATCH',{enabled});v3Devices=(await api('/admin/devices')).devices||[];admin();notify(enabled?'Attendance QR enabled for device.':'Attendance QR disabled for device.');}
  catch(err){notify('Unable to update attendance QR: '+err.message);btn.disabled=false;}
 });
 document.querySelectorAll('[data-v3-revoke]').forEach(btn=>btn.onclick=async()=>{
  if(!confirm('Revoke this device? Existing sessions will stop working.'))return;
  btn.disabled=true;try{await api('/admin/devices/'+encodeURIComponent(btn.dataset.v3Revoke)+'/revoke','POST');v3Devices=(await api('/admin/devices')).devices||[];admin();notify('Device revoked')}catch(err){notify(err.message);btn.disabled=false}
 });
 document.querySelector('#v3-load-stores').onclick=async()=>{await loadV3Stores();admin()};
 document.querySelector('#v3-store-select').onchange=async e=>{v3SelectedStore=e.target.value;try{await loadV3StoreMenu();admin()}catch(err){notify(err.message)}};
 document.querySelectorAll('[data-v3-select-store]').forEach(button=>button.onclick=async()=>{v3SelectedStore=button.dataset.v3SelectStore;try{await loadV3StoreMenu();admin()}catch(err){notify(err.message)}});
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
 function openEditor(m){adminEditing=m?.id||null;adminImage=m?.image_url||'';document.querySelector('#menu-editor-backdrop').hidden=false;document.querySelector('#editor-title').textContent=m?'Edit dish':'Add dish';document.querySelector('#menu-name').value=m?.name||'';document.querySelector('#menu-category').value=m?.category||adminCategories[0]?.name||'';document.querySelector('#menu-price').value=m?(m.price_cents/100).toFixed(2):'';document.querySelector('#menu-vat').value=String(m?.vat_rate??8);document.querySelector('#menu-sort').value=m?.sort_order??0;document.querySelector('#menu-dag-group').value=m?.dag_group||'';document.querySelector('#menu-active').value=String(m?.active??1);const preview=document.querySelector('#menu-image-preview');preview.hidden=!adminImage;preview.src=adminImage||'';document.querySelector('#menu-image-file').value='';document.querySelector('#menu-upload-status').textContent='';document.querySelector('#menu-name').focus()}
 document.querySelector('#addmenu').onclick=()=>{if(!adminCategories.length){adminTab='categories';admin();notify('Create a category first');return}openEditor(null)};
 document.querySelectorAll('[data-menu-edit]').forEach(el=>el.onclick=()=>openEditor(adminMenu.find(m=>m.id===el.dataset.menuEdit)));
 document.querySelectorAll('[data-menu-delete]').forEach(el=>el.onclick=async()=>{const dish=adminMenu.find(m=>m.id===el.dataset.menuDelete);if(!dish)return;if(!confirm('Delete "'+dish.name+'"?\\n\\nDishes with historical orders will be archived (hidden from POS) to preserve order records. This cannot be undone for dishes without order history.'))return;el.disabled=true;try{const result=await api('/menu/'+dish.id,'DELETE');await loadAdminMenu();admin();notify(result.archived?'Dish archived and hidden from POS':'Dish deleted')}catch(err){notify('Delete failed: '+err.message);el.disabled=false}});
 document.querySelector('#menu-cancel').onclick=closeEditor;
 document.querySelector('#menu-cancel-bottom').onclick=closeEditor;
 document.querySelector('#menu-image-remove').onclick=()=>{adminImage='';document.querySelector('#menu-image-preview').hidden=true;document.querySelector('#menu-image-file').value=''};
 document.querySelector('#menu-image-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;adminUploadBusy=true;const save=document.querySelector('#menu-save');save.disabled=true;const label=document.querySelector('#menu-upload-status');label.textContent='Uploading photo…';try{const url=await uploadAdminImage(file);adminImage=url;const preview=document.querySelector('#menu-image-preview');preview.src=url;preview.hidden=false;label.textContent='Photo uploaded'}catch(err){label.textContent='Upload failed: '+err.message;notify(err.message)}finally{adminUploadBusy=false;save.disabled=false}};
 document.querySelector('#menu-form').onsubmit=async e=>{e.preventDefault();if(adminUploadBusy)return;const btn=document.querySelector('#menu-save');btn.disabled=true;try{const price=Number(document.querySelector('#menu-price').value),sort=Number(document.querySelector('#menu-sort').value);if(!Number.isFinite(price)||price<0||!Number.isInteger(sort))throw Error('Invalid price or sort order');const data={name:document.querySelector('#menu-name').value.trim(),category:document.querySelector('#menu-category').value,price_cents:Math.round(price*100),vat_rate:Number(document.querySelector('#menu-vat').value),sort_order:sort,dag_group:document.querySelector('#menu-dag-group').value.trim(),active:Number(document.querySelector('#menu-active').value),image_url:adminImage};if(!data.name||!data.category)throw Error('Name and category are required');await api(adminEditing?'/menu/'+adminEditing:'/menu',adminEditing?'PATCH':'POST',data);await loadAdminMenu();adminEditing=null;adminImage='';admin();notify('Dish saved')}catch(err){notify('Save failed: '+err.message)}finally{btn.disabled=false}};
}
function chooseInitialStore(){
 if(!storeSelectionPending||deviceStores.length<2)return false;
 disconnect();
 document.body.className='role-login-body';
 app.innerHTML='<div class="role-login-screen"><section class="role-login-box"><div class="role-brand"><div class="role-brand-mark">C<span>&</span>K</div><h1>Chicken i Kimchi</h1></div><h2>Choose your store</h2><p class="role-subtitle">Select the restaurant for this device. You can switch later.</p><form id="v3-first-store-form"><label>Authorized store<select name="store_id" required><option value="">Select a store</option>'+deviceStores.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('')+'</select></label><button type="submit">Continue</button></form></section></div>';
 app.querySelector('#v3-first-store-form').onsubmit=async e=>{
  e.preventDefault();const selected=String(new FormData(e.currentTarget).get('store_id')||'');
  if(!deviceStores.some(x=>x.id===selected))return;
  const button=app.querySelector('#v3-first-store-form button[type="submit"]');button.disabled=true;
  try{
   const response=await fetch('/api/device/renew',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({role:page,store_id:selected})});
   if(!response.ok)throw Error('Store access expired. Ask Back Office to check this device.');
   const result=await response.json();
   if(result.store?.id!==selected||result.role!==page)throw Error('Store authorization could not be verified.');
   localStorage.setItem(lastStoreKey,selected);
   sessionStorage.removeItem('ck_token_'+page);
   location.reload();
  }catch(error){notify(error.message);button.disabled=false}
 };
 return true;
}
async function start(){if(chooseInitialStore())return;try{await refresh(true);if(page==='admin'){if(adminTab==='overview'){await loadOverview();admin();}connectAdminWs();}else connect()}catch(e){notify(e.message)}}
(async()=>{if(['pos','kitchen'].includes(page))await renewDeviceSession();if(storeSelectionPending)chooseInitialStore();else if(token)start();else login()})();
setInterval(async()=>{if(deviceMode()&&!storeSelectionPending)await renewDeviceSession()},15*60*1000);setInterval(()=>{if(token&&connected&&ws?.readyState===1)ws.send('ping')},25000);// Kitchen must never depend solely on WebSocket delivery.
// Poll every 5s as a fallback; WebSocket still refreshes immediately.
let kitchenSyncBusy=false;
setInterval(()=>{if(token&&page==='pos'&&!document.hidden)loadPosReservations()},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&token&&page==='pos')loadPosReservations()});
setInterval(async()=>{if(!token||page!=='kitchen'||document.hidden||kitchenSyncBusy)return;kitchenSyncBusy=true;try{await refresh()}finally{kitchenSyncBusy=false}},5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&token&&page==='kitchen')refresh()});
window.addEventListener('focus',()=>{if(token&&page==='kitchen')refresh()});
setInterval(()=>{if(token&&page!=='kitchen')refresh()},60000);

// Back Office order monitoring uses a read-only poll; POS/Kitchen sockets are unchanged.
setInterval(async()=>{if(page!=='admin'||!token||adminTab!=='orders'||document.hidden||adminOrdersBusy||adminWsLive)return;const before=JSON.stringify([adminOrders,adminOrdersSummary,adminOrdersHasMore,adminOrdersError]);await loadAdminOrders();if(page==='admin'&&adminTab==='orders'&&before!==JSON.stringify([adminOrders,adminOrdersSummary,adminOrdersHasMore,adminOrdersError]))admin();},10000);

// Lightweight overview refresh only while the dashboard is visible.
setInterval(async()=>{if(page!=='admin'||!token||adminTab!=='overview'||document.hidden||overviewBusy)return;await loadOverview();if(adminTab==='overview')admin();},60000);

// Kitchen view selector styling (shared by Tickets and DAG Timeline).
const kitchenViewStyle=document.createElement('style');kitchenViewStyle.textContent=`.kds-command-row{display:flex;align-items:stretch;gap:10px;margin-bottom:14px;min-width:0}.kds-command-row .kds-view-tabs{flex:0 0 auto;margin:0;align-self:stretch;align-items:center}.kds-command-row .kds-command-actions{flex:1 1 auto;min-width:0;margin:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 12px}.kds-command-row .kds-command-actions button{white-space:nowrap}.kds-command-row .kds-command-actions .muted{flex:1 1 130px}@media(max-width:1050px){.kds-command-row{gap:6px}.kds-command-row .kds-view-tabs{gap:3px;padding:4px}.kds-command-row .kds-view-tabs button{padding:10px 12px}.kds-command-row .kds-command-actions{gap:6px;padding:6px 8px}.kds-command-row .kds-command-actions button{padding:10px 9px}.kds-command-row .kds-command-actions .muted{display:none}}@media(max-width:760px){.kds-command-row{flex-wrap:wrap}.kds-command-row .kds-view-tabs{width:100%;justify-content:stretch}.kds-command-row .kds-view-tabs button{flex:1}.kds-command-row .kds-command-actions{flex-basis:100%}}.kds-view-tabs{display:flex;gap:8px;margin:0 0 14px;padding:6px;background:#1d2638;border:1px solid #39465e;border-radius:14px;width:max-content;max-width:100%}.kds-view-tabs button{border:0;border-radius:10px;padding:12px 24px;background:transparent;color:#cbd5e1;font-weight:800;cursor:pointer}.kds-view-tabs button.selected{background:#397de3;color:white}.kds-dag-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.kds-dag-scroll{overflow-x:auto}.kds-dag-axis,.kds-dag-row{display:grid;grid-template-columns:minmax(160px,25%) minmax(450px,1fr);align-items:center}.kds-dag-axis{margin:20px 0 10px;color:#aebcd3}.kds-dag-ticks{display:flex;justify-content:space-between;font-size:12px}.kds-dag-row{min-height:70px;border-top:1px solid #39465e}.kds-dag-label{display:flex;justify-content:space-between;padding-right:18px;gap:8px}.kds-dag-track{height:36px;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(11.111% - 1px),#475569 calc(11.111% - 1px),#475569 11.111%);position:relative}.kds-dag-bar{position:absolute;top:7px;height:22px;background:linear-gradient(90deg,#3285e6,#4fc6bb);border-radius:12px;min-width:5px}.kds-dag-now{position:absolute;left:33.333%;top:-9px;bottom:-9px;border-left:2px solid #fb7185}.kds-dag-detail{padding:5px 12px 14px;border-bottom:1px solid #39465e}.kds-dag-detail summary{cursor:pointer;color:#9bc5ff}.kds-dag-detail div{padding:6px 0}.kds-dag-heading h2{margin-bottom:4px}@media(max-width:600px){.kds-view-tabs{width:100%}.kds-view-tabs button{flex:1;padding:12px 8px}.kds-dag-axis,.kds-dag-row{grid-template-columns:145px minmax(420px,1fr)}}`;document.head.appendChild(kitchenViewStyle);

if(page==='pos'||page==='kitchen'){
 document.documentElement.style.touchAction='manipulation';
 document.addEventListener('gesturestart',e=>e.preventDefault(),{passive:false});
 document.addEventListener('gesturechange',e=>e.preventDefault(),{passive:false});
}
