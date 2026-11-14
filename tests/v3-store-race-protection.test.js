import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('store change and socket disconnect invalidate pending UI refreshes',()=>{
 assert.match(app,/function disconnect\(\)\{storeEpoch\+\+;kitchenRefreshSerial\+\+/);
 assert.match(app,/const stale=\(\)=>epoch!==storeEpoch\|\|store!==currentDeviceStore\?\.id\|\|serial!==kitchenRefreshSerial/);
 assert.match(app,/const \[m,o,mods\]=await Promise\.all\([\s\S]*?if\(stale\(\)\)return;menu=m/);
 assert.match(app,/const nextTables=await api\('\/tables'\);if\(stale\(\)\)return;tableState=nextTables/);
});
test('API responses from prior store epochs are discarded before consumption',()=>{
 assert.match(app,/const valid=\(\)=>epoch===storeEpoch&&store===currentDeviceStore\?\.id/);
 assert.match(app,/if\(!valid\(\)\)throw Error\('Store changed; request discarded'\)/);
 assert.match(app,/const out=await r\.json\(\);if\(!valid\(\)\)/);
});
