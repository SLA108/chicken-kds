import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const api=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');

test('device POS pickup paths map to backend scoped pickup routes',()=>{
 assert.match(ui,/path==='\/pos\/pickups'\|\|path\.startsWith\('\/pos\/pickups\/'\)/);
 assert.match(ui,/path\.slice\('\/pos'\.length\)/);
 for(const path of ['/api/store/pickups','/api/store/pickups/orders/'])assert.ok(api.includes(path),path);
});

test('device mode rejects unknown API routes rather than falling back to legacy',()=>{
 assert.match(ui,/throw Error\('Device mode does not permit this endpoint:/);
 assert.match(api,/STORE_API_NOT_READY/);
});

test('admin V3 store configuration requires explicit feature flag',()=>{
 assert.match(api,/ENABLE_V3_STORE_ADMIN!=='true'/);
 assert.match(api,/Store configuration is disabled until V3 staging verification/);
});

test('store-specific paid order detail scopes all lookups',()=>{
 assert.match(api,/\/api\\\/store\\\/pos\\\/history/);
 assert.match(api,/Payment store mismatch/);
});
