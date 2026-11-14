import test from 'node:test';
import assert from 'node:assert/strict';
import {isPairingCode,isDeviceRole,pairingExpired,approvalAttemptPolicy,parseDeviceCookie} from '../src/device-pairing.js';

test('pairing code must be exactly six digits',()=>{
 assert.equal(isPairingCode('000123'),true);
 for(const code of ['12345','1234567','123 56','abcdef',123456,''])assert.equal(isPairingCode(code),false);
});
test('only store device roles can be paired',()=>{
 assert.equal(isDeviceRole('pos'),true);
 assert.equal(isDeviceRole('kitchen'),true);
 assert.equal(isDeviceRole('scanner'),true);
 assert.equal(isDeviceRole('admin'),false);
});
test('expiry is fail closed',()=>{
 assert.equal(pairingExpired('2026-01-01T00:10:00Z',Date.parse('2026-01-01T00:09:59Z')),false);
 assert.equal(pairingExpired('2026-01-01T00:10:00Z',Date.parse('2026-01-01T00:10:00Z')),true);
 assert.equal(pairingExpired('invalid'),true);
});
test('fifth failed password locks code; resets after window',()=>{
 const now=Date.parse('2026-01-01T12:00:00Z');
 let state=null;
 for(let i=1;i<=5;i++){const p=approvalAttemptPolicy(state,now+i*1000);assert.equal(p.attempts,i);state={attempts:p.attempts,window_started_at:p.windowStartedAt};if(i===5)assert.ok(p.blockedUntil);else assert.equal(p.blockedUntil,null);}
 const reset=approvalAttemptPolicy(state,now+16*60*1000);
 assert.equal(reset.attempts,1);
});
test('persistent cookie requires a full secret',()=>{
 const value='ck_device='+'a'.repeat(36)+'.'+'b'.repeat(64);
 assert.deepEqual(parseDeviceCookie(value),{deviceId:'a'.repeat(36),credential:'b'.repeat(64)});
 assert.equal(parseDeviceCookie(value.slice(0,-1)),null);
});
