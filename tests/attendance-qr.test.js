import test from 'node:test';
import assert from 'node:assert/strict';
import {attendanceQrToken,verifyAttendanceQr,qrSlot} from '../src/attendance-qr.js';
const store='12345678-1234-1234-1234-123456789abc';
test('same secret, store and UTC slot produce deterministic token',async()=>{
 const a=await attendanceQrToken('test-secret',store,qrSlot(30000));
 assert.equal(a,await attendanceQrToken('test-secret',store,2));
 assert.deepEqual(await verifyAttendanceQr('test-secret',a,30000),{storeId:store,slot:2});
 assert.equal(await verifyAttendanceQr('test-secret',a,45000),null);
 assert.equal(await verifyAttendanceQr('wrong',a,30000),null);
});
test('tokens are scoped to store',async()=>{
 const a=await attendanceQrToken('test-secret',store,2);
 assert.notEqual(a,await attendanceQrToken('test-secret','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',2));
});
