import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('revoking current store never silently redirects a multi-store device',()=>{
 const renewal=app.slice(app.indexOf('async function renewDeviceSession(){'),app.indexOf('async function api('));
 assert.match(renewal,/if\(oldStoreId&&currentDeviceStore\?\.id!==oldStoreId\)/);
 assert.match(renewal,/if\(deviceStores\.length>1\)\{[\s\S]*?localStorage\.removeItem\(lastStoreKey\);[\s\S]*?storeSelectionPending=true;[\s\S]*?chooseInitialStore\(\)/);
 assert.match(renewal,/token='';sessionStorage\.removeItem\('ck_token_'\+page\)/);
});
test('single remaining authorized store may be entered after clean reload',()=>{
 const renewal=app.slice(app.indexOf('async function renewDeviceSession(){'),app.indexOf('async function api('));
 assert.match(renewal,/if\(!currentDeviceStore\)\{login\(\);return false\}/);
 assert.match(renewal,/localStorage\.setItem\(lastStoreKey,currentDeviceStore\.id\);\s*location\.reload\(\)/);
});
