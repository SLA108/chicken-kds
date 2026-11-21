import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
test('Collected workspace uses Warsaw business day based on created_at',()=>{
 const start=server.indexOf("if(path==='/api/store/platform-orders/history'&&req.method==='GET')");
 const end=server.indexOf("if(path==='/api/store/platform-orders/collection'",start);
 assert.ok(start>=0&&end>start);
 const handler=server.slice(start,end);
 assert.match(handler,/timeZone:'Europe\/Warsaw'/);
 assert.match(handler,/Number\(part\('hour'\)\)<10/);
 assert.match(handler,/warsawUtc\(localDate,10\)/);
 assert.match(handler,/warsawUtc\(nextDate,3\)/);
 assert.match(handler,/o\.created_at>=\? AND o\.created_at<\?/);
 assert.match(handler,/ORDER BY pm\.collected_at DESC LIMIT \?/);
 assert.doesNotMatch(handler,/pm\.collected_at>=\?/);
});
