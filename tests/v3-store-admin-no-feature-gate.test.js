import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
test('store administration no longer requires staging feature flag',()=>{
 assert.ok(!src.includes('ENABLE_V3_STORE_ADMIN'));
 assert.ok(!src.includes('disabled until V3 staging verification'));
});
test('store inventory reports multi-store management enabled',()=>{
 assert.match(src,/multistore_enabled:true/);
});
test('store activation and menu editing still require admin role',()=>{
 for(const route of ['storeConfigMatch','storeMenuItemMatch']){
  const pos=src.indexOf('if('+route+'&&req.method=');
  assert.ok(pos>=0,route);
  assert.match(src.slice(pos,pos+220),/allowed\(role,'admin'\)/);
 }
});
