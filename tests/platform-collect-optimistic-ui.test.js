import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const client=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('courier pickup hides card before waiting for the API',()=>{
 const start=client.indexOf("overlay.querySelector('.platform-collect-submit').onclick=async()=>");
 assert.ok(start>=0);
 const handler=client.slice(start,client.indexOf("overlay.querySelector('.platform-collect-cancel').focus()",start));
 assert.ok(handler.indexOf('platformCollectPending.add(id)')<handler.indexOf("await api('/platform-orders/'"));
 assert.ok(handler.indexOf('renderPlatformWorkspace()')<handler.indexOf("await api('/platform-orders/'"));
 assert.ok(handler.indexOf('cancel()')<handler.indexOf("await api('/platform-orders/'"));
 assert.match(handler,/finally\s*\{[\s\S]*platformCollectPending\.delete\(id\);[\s\S]*await loadPlatformWorkspace\(\)/);
});
test('pending courier collection is hidden from active, preparing and ready cards',()=>{
 assert.match(client,/const active=orders\.filter\(o=>o\.platform&&!o\.collected_at&&o\.status!=='cancelled'&&!platformCollectPending\.has\(o\.id\|\|o\.order_id\)\)/);
});
