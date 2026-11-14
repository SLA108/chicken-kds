import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('order reconciliation is limited to the authorized store',()=>{
 assert.match(worker,/orderLookup=path\.match/);
 assert.match(worker,/WHERE client_key=\? AND store_id=\?/);
 assert.match(worker,/\.bind\(key,session\.storeId\)\.first\(\)/);
});
test('failed new-order submissions query the original key and preserve it when uncertain',()=>{
 const submit=client.slice(client.indexOf('async function submit(){'),client.indexOf('\nfunction ticket('));
 assert.match(submit,/key=pendingKey/);
 assert.match(submit,/api\('\/orders\/by-client-key\/'\+encodeURIComponent\(key\)\)/);
 assert.match(submit,/if\(check\.found\)/);
 assert.match(submit,/Draft preserved/);
 assert.match(submit,/pendingKey=crypto\.randomUUID\(\)/);
 assert.match(submit,/epoch!==storeEpoch\|\|originalStore!==currentDeviceStore\?\.id/);
});
