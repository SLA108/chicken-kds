import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('mutations are never automatically retried after a 401 or 403 response',()=>{
 const api=app.slice(app.indexOf("async function api(path,method='GET',data){"),app.indexOf('function notify('));
 assert.match(api,/if\(renewed&&method==='GET'\)r=await request\(\)/);
 assert.doesNotMatch(api,/if\(renewed\)r=await request\(\)/);
 assert.match(api,/if\(!valid\(\)\)throw Error\('Store changed; request discarded'\)/);
});
test('device API requests stay within the store-scoped routes',()=>{
 const scope=app.slice(app.indexOf('function scopedApiPath(path){'),app.indexOf('let deviceStores='));
 assert.match(scope,/return '\/store'\+path/);
 assert.match(scope,/throw Error\('Device mode does not permit this endpoint:/);
});
