import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const client=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('first multi-store use requires an explicit store choice',()=>{
 assert.match(client,/storeSelectionPending=!localStorage\.getItem\(lastStoreKey\)&&deviceStores\.length>1/);
 assert.match(client,/if\(storeSelectionPending\)\{[\s\S]*?token='';sessionStorage\.removeItem/);
 assert.match(client,/if\(currentDeviceStore\)localStorage\.setItem/);
 assert.match(client,/if\(storeSelectionPending\)chooseInitialStore\(\)/);
 assert.match(client,/Select the restaurant for this device/);
});
test('initial selection is limited to authorized stores and restarts with clean session',()=>{
 assert.match(client,/if\(!deviceStores\.some\(x=>x\.id===selected\)\)return/);
 assert.match(client,/localStorage\.setItem\(lastStoreKey,selected\);\s*sessionStorage\.removeItem\('ck_token_'\+page\);\s*location\.reload\(\)/);
});
