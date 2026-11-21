import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('successful void removes POS card immediately, before refresh',()=>{
 const start=app.indexOf('async function voidTicket(id)'),end=app.indexOf('function openTicketEditor(id)',start);
 assert.ok(start>0&&end>start);
 const body=app.slice(start,end);
 assert.match(body,/await api\('\/orders\/'\+encodeURIComponent\(id\)\+'\/void','POST'/);
 assert.match(body,/current.status='cancelled'/);
 assert.ok(body.indexOf('pos();')<body.indexOf('await refresh();'));
 assert.match(body,/posVoidedTicketIds.add\(id\)/);
});
test('older POS fetches cannot resurrect a successfully voided ticket',()=>{
 assert.match(app,/if\(posVoidedTicketIds.has\(order.id\)\)order.status='cancelled'/);
 assert.match(app,/function activeTickets\(\)\{return orders.filter\(o=>!o.platform&&o.status!=='cancelled'/);
});
