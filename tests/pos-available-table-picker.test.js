import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('New Order only offers unoccupied tables in the button grid',()=>{
 assert.match(app,/const availableTables=Array\.from\(\{length:20\}/);
 assert.match(app,/\.filter\(no=>!occupied\.has\(no\)\)/);
 assert.match(app,/availableTables\.map\(no=>'<button type="button" data-select-table="'/);
 assert.match(app,/No available tables/);
});
test('existing ticket locks its own table when adding items',()=>{
 assert.match(app,/selected\?'Table '\+esc\(selected\.table_no\)/);
 assert.match(app,/selected\|\|!availableTables\.length\?'disabled'/);
 assert.match(app,/selected\?'': '<div id="foh-table-grid"/);
});

test('ticket edits apply optimistic changes while protecting pending data from refresh',()=>{
 assert.match(app,/const pendingPosItemEdits=new Map\(\)/);
 assert.match(app,/if\(page==='pos'\)applyPendingPosItemEdits\(o\)/);
 assert.match(app,/pendingPosItemEdits\.set\(id,\{removed:new Set\(\[itemId\]\),quantities:new Map\(\)\}\)/);
 assert.match(app,/pendingPosItemEdits\.set\(id,\{removed:new Set\(\),quantities:new Map\(changes\.map/);
 assert.match(app,/finally\{pendingPosItemEdits\.delete\(id\)/);
});
