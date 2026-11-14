import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('first-use store choice cannot poll or expose an arbitrary default store',()=>{
 const renewal=app.slice(app.indexOf('async function renewDeviceSession(){'),app.indexOf('async function api('));
 assert.match(renewal,/if\(storeSelectionPending\)\{[\s\S]*?token='';sessionStorage\.removeItem/);
 assert.match(app,/if\(storeSelectionPending\)chooseInitialStore\(\);else if\(token\)start\(\)/);
 assert.match(app,/if\(deviceMode\(\)&&!storeSelectionPending\)await renewDeviceSession\(\)/);
});
test('store switching verifies active server grant before changing local store preference',()=>{
 const banner=app.slice(app.indexOf('function storeBanner(){'),app.indexOf('function render(){'));
 assert.match(banner,/fetch\('\/api\/device\/renew'/);
 assert.match(banner,/JSON\.stringify\(\{store_id:selected\}\)/);
 assert.match(banner,/if\(!response\.ok\)throw Error/);
 assert.match(banner,/if\(result\.store\?\.id!==selected\|\|result\.role!==page\)/);
 assert.ok(banner.indexOf("if(!response.ok)")<banner.indexOf("localStorage.setItem(lastStoreKey,selected)"));
});
