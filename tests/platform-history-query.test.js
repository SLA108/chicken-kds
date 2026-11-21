import test from 'node:test';
import assert from 'node:assert/strict';
import {collectedHistoryQuery,collectedHistoryDetailSql} from '../src/platform-history-query.js';
test('history queries require both store scopes and collected state',()=>{
 const x=collectedHistoryQuery('store-A');
 assert.match(x.countSql,/pm.store_id=\?/);assert.match(x.countSql,/o.store_id=\?/);assert.match(x.countSql,/pm.collected_at IS NOT NULL/);
 assert.deepEqual(x.args,['store-A','store-A']);assert.match(collectedHistoryDetailSql,/o.store_id=\?/);assert.match(collectedHistoryDetailSql,/pm.collected_at IS NOT NULL/);
});
test('platform, order number and Warsaw date filters are bound parameters',()=>{
 const x=collectedHistoryQuery('store-A',{from:'2026-11-16',to:'2026-11-16',platform:'wolt',q:'W-17'});
 assert.deepEqual(x.args,['store-A','store-A','2026-11-15T23:00:00.000Z','2026-11-16T23:00:00.000Z','wolt','%W-17%','%W-17%']);
 assert.match(x.listSql,/pm.platform=\?/);assert.match(x.listSql,/pm.external_order_id LIKE \?/);
});
test('pages use deterministic ordering and limit/offset bindings',()=>{
 const x=collectedHistoryQuery('store-B',{page:3,size:15});
 assert.deepEqual(x.listArgs,['store-B','store-B',15,30]);
 assert.match(x.listSql,/ORDER BY pm.collected_at DESC,pm.order_id DESC LIMIT \? OFFSET \?/);
});
test('SQL injection input never interpolates into SQL',()=>{
 const x=collectedHistoryQuery('store-A',{q:"' OR 1=1 --"});
 assert.ok(!x.listSql.includes('1=1'));assert.equal(x.args.at(-1),"%' OR 1=1 --%");
});
test('invalid dates and missing store are rejected',()=>{
 assert.throws(()=>collectedHistoryQuery(''));assert.throws(()=>collectedHistoryQuery('A',{from:'2026-02-30'}));
});
