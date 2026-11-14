import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('revoked grant response initiates recovery without bypassing server authorization',()=>{
 assert.match(app,/\(r\.status===401\|\|r\.status===403\)&&deviceMode\(\)&&await renewDeviceSession\(\)/);
 assert.match(app,/r=await request\(\)/);
});
test('permission-close socket can reconnect after onclose clears ws reference',()=>{
 assert.match(app,/socket\.onclose=async event=>/);
 assert.match(app,/if\(event\.code===1008&&deviceMode\(\)\)/);
 assert.match(app,/if\(generation!==wsGeneration\)return/);
 assert.doesNotMatch(app,/if\(!current\(\)\)return;\s*if\(!recovered\)/);
});
