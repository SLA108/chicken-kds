// V3 store-scoped session primitives. No client-supplied store identifier is trusted.
// HMAC signed, expiring bearer tokens. Server must verify store/device active in D1.
const enc=new TextEncoder();
const dec=new TextDecoder();
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const bytesFromHex=hexString=>{if(!/^(?:[0-9a-f]{2})+$/.test(hexString))return null;return Uint8Array.from(hexString.match(/.{2}/g),x=>parseInt(x,16));};
const b64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
const unb64url=value=>{if(!/^[A-Za-z0-9_-]+$/.test(value))return null;try{return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));}catch{return null;}};
async function signingKey(secret){if(typeof secret!=='string'||secret.length<32)throw Error('AUTH_SECRET must contain at least 32 characters');return crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function issueStoreSession(secret,{role,storeId,deviceId},now=Date.now(),ttlMs=8*60*60*1000){
 if(!['pos','kitchen','scanner'].includes(role)||!storeId||!deviceId||!Number.isSafeInteger(now)||ttlMs<=0||ttlMs>24*60*60*1000)throw Error('Invalid store session');
 const payload=b64url(enc.encode(JSON.stringify({v:1,role,store_id:storeId,device_id:deviceId,iat:now,exp:now+ttlMs})));
 const signature=new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(secret),enc.encode(payload)));
 return 'cks1.'+payload+'.'+hex(signature);
}
export async function verifyStoreSession(secret,token,now=Date.now()){
 if(typeof token!=='string'||token.length>2048)return null;
 const match=/^cks1\\.([A-Za-z0-9_-]+)\\.([0-9a-f]{64})$/.exec(token);
 if(!match)return null;
 const signature=bytesFromHex(match[2]),key=await signingKey(secret);
 const valid=await crypto.subtle.verify('HMAC',key,signature,enc.encode(match[1]));
 if(!valid)return null;
 const bytes=unb64url(match[1]);if(!bytes||bytes.length>1024)return null;
 let data;try{data=JSON.parse(dec.decode(bytes));}catch{return null;}
 if(data?.v!==1||!['pos','kitchen','scanner'].includes(data.role)||typeof data.store_id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(data.store_id)||typeof data.device_id!=='string'||!Number.isSafeInteger(data.iat)||!Number.isSafeInteger(data.exp)||data.iat>now||data.exp<=now||data.exp-data.iat>86400000)return null;
 return {role:data.role,storeId:data.store_id,deviceId:data.device_id,expiresAt:data.exp};
}
export async function sha256Hex(value){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value))));}
export async function activeDeviceStore(env,deviceId,storeId){
 return env.DB.prepare('SELECT d.id,d.store_id,s.code,s.name FROM pos_devices d JOIN stores s ON s.id=d.store_id WHERE d.id=? AND d.store_id=? AND d.active=1 AND s.active=1').bind(deviceId,storeId).first();
}
