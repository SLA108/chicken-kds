// Pure pairing policy helpers shared by the Worker and unit tests.
export const isPairingCode=value=>typeof value==='string'&&/^[0-9]{6}$/.test(value);
export const isDeviceRole=value=>['pos','kitchen','scanner'].includes(value);
export const pairingExpired=(expiresAt,now=Date.now())=>!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=now;
export const approvalAttemptPolicy=(previous,now=Date.now())=>{
 const windowMs=15*60*1000;
 const active=previous&&Number.isFinite(Date.parse(previous.window_started_at))&&Date.parse(previous.window_started_at)>now-windowMs;
 const attempts=(active?Number(previous.attempts)||0:0)+1;
 return {attempts,windowStartedAt:active?previous.window_started_at:new Date(now).toISOString(),blockedUntil:attempts>=5?new Date(now+windowMs).toISOString():null};
};
export const parseDeviceCookie=value=>{
 const m=/^ck_device=([0-9a-f-]{36})\.([0-9a-f]{64})$/.exec(value||'');
 return m?{deviceId:m[1],credential:m[2]}:null;
};
