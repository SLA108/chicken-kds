import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
test('POS void preserves ticket and blocks paid, completed and platform orders',()=>{
 const begin=server.indexOf('const scopedVoid=path.match('),end=server.indexOf('const scopedEditDish=path.match(',begin);
 assert.ok(begin>0&&end>begin);
 const handler=server.slice(begin,end);
 assert.match(handler,/session.role!=='pos'/);
 assert.match(handler,/order.paid_at\|\|order.kitchen_completed_at/);
 assert.match(handler,/SELECT order_id FROM order_platform_metadata/);
 assert.match(handler,/UPDATE orders SET status='cancelled'/);
 assert.match(handler,/ticket_voided/);
 assert.doesNotMatch(handler,/DELETE FROM orders/);
});
test('POS editing only changes unfinished, unpaid, non-platform item quantities',()=>{
 const begin=server.indexOf('const scopedEditDish=path.match('),end=server.indexOf('const scopedItemDone=path.match(',begin);
 assert.ok(begin>0&&end>begin);
 const handler=server.slice(begin,end);
 assert.match(handler,/quantity<1\|\|quantity>99/);
 assert.match(handler,/UPDATE order_items SET quantity=\?/);
 assert.match(handler,/is_done=0/);
 assert.match(handler,/o.paid_at IS NULL AND o.kitchen_completed_at IS NULL/);
 assert.match(handler,/NOT EXISTS\(SELECT 1 FROM order_platform_metadata/);
 assert.match(app,/function openTicketEditor\(id\)/);
 assert.match(app,/function voidTicket\(id\)/);
});
test('kitchen header mark-all is separate from kitchen completion',()=>{
 const begin=server.indexOf('const scopedMarkAll=path.match('),end=server.indexOf('const scopedVoid=path.match(',begin);
 assert.ok(begin>0&&end>begin);
 const handler=server.slice(begin,end);
 assert.match(handler,/UPDATE order_items SET is_done=1/);
 assert.match(handler,/UPDATE orders SET status='done'/);
 assert.doesNotMatch(handler,/kitchen_completed_at=\?/);
 assert.match(app,/data-kitchen-mark-all/);
 assert.match(app,/Mark all dishes on this ticket as done\?/);
 assert.match(css,/kds-platform-order-number/);
});
test('iPad touch protection is scoped to POS and Kitchen',()=>{
 assert.match(app,/if\(page==='pos'\|\|page==='kitchen'\)/);
 assert.match(app,/gesturestart/);
 assert.match(css,/touch-action:manipulation/);
});

test('POS removal preserves the ticket and disallows removing finished or final dish',()=>{
 const begin=server.indexOf('const scopedRemoveDish=path.match('),end=server.indexOf('const scopedItemDone=path.match(',begin);
 assert.ok(begin>0&&end>begin);
 const handler=server.slice(begin,end);
 assert.match(handler,/req.method==='DELETE'/);
 assert.match(handler,/items.length<2/);
 assert.match(handler,/!i.is_done/);
 assert.match(handler,/DELETE FROM order_item_modifiers/);
 assert.match(handler,/DELETE FROM order_items/);
 assert.match(handler,/NOT EXISTS\(SELECT 1 FROM order_platform_metadata/);
 assert.match(app,/data-edit-remove/);
});
