import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('permission socket closure cannot replace the store chooser with login or stale data',()=>{
 const socket=app.slice(app.indexOf('socket.onclose=async event=>'),app.indexOf('socket.onerror='));
 assert.match(socket,/if\(storeSelectionPending\)return/);
 assert.match(socket,/menu=\[\];orders=\[\];tableState=\[\];login\(\)/);
 assert.match(socket,/if\(generation!==wsGeneration\)return/);
});
test('first-use store selection verifies the selected grant with the server',()=>{
 const chooser=app.slice(app.indexOf('function chooseInitialStore(){'),app.indexOf('async function start(){'));
 assert.match(chooser,/fetch\('\/api\/device\/renew'/);
 assert.match(chooser,/JSON\.stringify\(\{store_id:selected\}\)/);
 assert.match(chooser,/if\(!response\.ok\)throw Error/);
 assert.match(chooser,/if\(result\.store\?\.id!==selected\|\|result\.role!==page\)/);
 assert.ok(chooser.indexOf('if(!response.ok)')<chooser.indexOf('localStorage.setItem(lastStoreKey,selected)'));
});
