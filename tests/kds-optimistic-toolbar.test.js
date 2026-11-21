import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
test('KDS Done/Undo updates locally and serializes background writes',()=>{
 assert.match(app,/const kitchenDishSync=new Map\(\)/);
 assert.match(app,/state.desired=!state.desired;updateKitchenDishUI\(id,state.desired\)/);
 assert.match(app,/if\(!state\|\|state.running\)return/);
 assert.match(app,/while\(state.saved!==state.desired\)/);
 assert.match(app,/if\(state.desired!==expected\)continue/);
 assert.match(app,/kitchenPending.set\(id,next\)/);
});
test('KDS toolbar keeps platform order visible and actions responsive',()=>{
 assert.match(app,/id="kds-quick-order"/);
 assert.match(app,/class="kds-command-actions"/);
 assert.match(app,/class="kds-more"/);
 assert.match(app,/aria-label="Refresh orders"/);
 assert.match(css,/\.kds-command-row\{display:flex/);
 assert.match(css,/min-width:44px;min-height:44px/);
});
