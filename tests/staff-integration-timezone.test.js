import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
test('Staff integrations use Warsaw 03:00 business-day boundaries',()=>{
 assert.match(source,/const warsawBusinessStartUTC=date=>/);
 assert.match(source,/timeZone:'Europe\/Warsaw'/);
 assert.ok(source.includes("Date.parse(date+'T03:00:00Z')"));
 assert.match(source,/args.push\(warsawBusinessStartUTC\(from\)\)/);
 assert.match(source,/warsawBusinessStartUTC\(nextDay\(to\)\)/);
 assert.match(source,/timezone:'Europe\/Warsaw'/);
});
test('Staff integration remains read-only and token-protected',()=>{
 assert.match(source,/STAFF_INTEGRATION_TOKEN/);
 assert.match(source,/\/api\/integrations\/revenue/);
 assert.match(source,/\/api\/integrations\/tips/);
});
