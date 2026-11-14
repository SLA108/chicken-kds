import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
test('V3.1 store sessions check allowlist rather than original device store',()=>{
 assert.match(source,/const device=await allowedDeviceStore\(env,session\.deviceId,session\.storeId\)/);
});
test('V3.1 admin grant changes require admin and same-origin request',()=>{
 assert.match(source,/if\(\/\^\\\/api\\\/admin\\\/devices\\\/\[\^\/\]\+\\\/stores\$\/\.test\(path\)/);
 assert.match(source,/if\(req\.headers\.get\('origin'\)!==url\.origin\)return json\(\{error:'Invalid origin'\},403\)/);
 assert.match(source,/new Set\(ids\)\.size!==ids\.length/);
 assert.match(source,/await env\.DB\.batch\(\[/);
});
