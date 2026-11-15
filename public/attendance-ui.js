// Attendance QR is inactive until an authorized restaurant device requests it.
(() => {
 const role=location.pathname.slice(1);
 if(!['pos','kitchen'].includes(role))return;
 let permitted=false,storeId='',busy=false,modal=null,ticker=null,autoClose=null,clockOffset=0,batch=null;
 const auth=()=>sessionStorage.getItem('ck_token_'+role)||'';
 const activeSession=()=>auth().startsWith('cks1.');
 function close(){if(ticker)clearInterval(ticker);if(autoClose)clearTimeout(autoClose);ticker=autoClose=null;modal?.remove();modal=null;batch=null;}
 async function request(path,method='GET'){
  const response=await fetch('/api'+path,{method,credentials:'same-origin',headers:{authorization:'Bearer '+auth(),...(method==='POST'?{'content-type':'application/json'}:{})}});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'Request failed');return data;
 }
 function currentStore(){return window.__attendanceStoreId||storeId;}
 function renderQr(){
  if(!modal||!batch)return;
  const now=Date.now()+clockOffset,slot=Math.floor(now/15000);
  const entry=batch.tokens.find(x=>x.slot===slot);
  const qr=modal.querySelector('#ck-attendance-svg'),remaining=modal.querySelector('#ck-attendance-remaining');
  if(!entry){qr.textContent='QR expired. Close and reopen.';remaining.textContent='';return;}
  if(qr.dataset.slot!==String(slot)){qr.innerHTML=entry.svg;qr.dataset.slot=String(slot);}
  remaining.textContent=Math.ceil((15000-now%15000)/1000)+'s until next code';
 }
 async function open(){
  if(busy||modal)return;busy=true;
  modal=document.createElement('div');modal.id='ck-attendance-modal';modal.style.cssText='position:fixed;inset:0;z-index:99999;background:#101827eF;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML='<section style="background:white;color:#111827;border-radius:18px;padding:22px;max-width:380px;width:100%;text-align:center"><h2>Staff Attendance</h2><p id="ck-attendance-status">Preparing QR…</p><div id="ck-attendance-svg" style="min-height:280px;display:grid;place-items:center"></div><p id="ck-attendance-remaining"></p><button id="ck-attendance-close" type="button" style="width:100%;padding:14px;border-radius:12px">Close</button></section>';
  document.body.append(modal);modal.querySelector('#ck-attendance-close').onclick=close;
  try{
   const requestedStore=currentStore(),data=await request('/device/attendance-qr','POST');
   if(!modal)return;
   if(requestedStore!==currentStore()||data.store_id!==currentStore()){close();return;}
   batch=data;clockOffset=data.server_time-Date.now();
   modal.querySelector('#ck-attendance-status').textContent='Scan with your paired staff phone';
   renderQr();ticker=setInterval(renderQr,250);
   autoClose=setTimeout(close,60000);
  }catch(e){if(modal){modal.querySelector('#ck-attendance-status').textContent=e.message;modal.querySelector('#ck-attendance-svg').textContent='QR unavailable';}}
  finally{busy=false;}
 }
 async function refreshPermission(){
  if(!activeSession()){permitted=false;storeId='';close();return;}
  try{const data=await request('/device/me');permitted=data.attendance_qr_enabled===true;storeId=data.store?.id||'';}
  catch{permitted=false;storeId='';close();}
 }
 let previousToken='',previousStore='';
 async function sync(){
  const token=auth(),selected=window.__attendanceStoreId||'';
  if(token!==previousToken||selected!==previousStore){previousToken=token;previousStore=selected;close();await refreshPermission();}
  const header=document.querySelector('header .toolbar')||document.querySelector('header');
  const existing=document.querySelector('#ck-attendance-open');
  if(!permitted||!activeSession()||!header){existing?.remove();return;}
  if(!existing){const button=document.createElement('button');button.type='button';button.id='ck-attendance-open';button.textContent='Staff Attendance';button.onclick=open;header.prepend(button);}
 }
 setInterval(sync,1200);sync();
})();
